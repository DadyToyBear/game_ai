#!/usr/bin/env node
/**
 * Editor-friendly asynchronous wrapper around build_project.mjs.
 *
 * The Redot dock starts this process without blocking the editor and polls an
 * atomically-written JSON status file. The normal CLI remains available for
 * terminals and CI.
 */
import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildProject, parseArgs } from "./build_project.mjs";

const argv = process.argv.slice(2);
const statusIndex = argv.indexOf("--status-file");
const statusArg = statusIndex >= 0 ? argv[statusIndex + 1] : "";
const statusPath = statusArg ? resolve(statusArg) : "";
if (!statusPath) {
  console.error("--status-file <path> обязателен для асинхронного запуска");
  process.exit(2);
}
const buildArgs = argv.filter((_, i) => i !== statusIndex && i !== statusIndex + 1);

function writeStatus(status) {
  mkdirSync(dirname(statusPath), { recursive: true });
  const tempPath = `${statusPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(status, null, 2) + "\n");
  renameSync(tempPath, statusPath);
}

writeStatus({ state: "running", output: "Node.js запущен; выполняется сборка проекта…" });

try {
  const { report } = buildProject({ ...parseArgs(buildArgs), log: () => {} });
  const summary = report.summary;
  const lines = [
    `Экранов: ${summary.screens}, модулей: ${summary.modules}, GDScript: ${summary.gdLines} строк`,
    `Ассетов: ${summary.assetsCopied} (${summary.assetsMB} МБ), данных: ${summary.dataFiles}`,
    `Замечаний: ${summary.todo} (ручных: ${summary.manual}), предупреждений: ${summary.warnings}`,
  ];
  if (report.lint.available) lines.push(`Линтер GDScript: проверено ${report.lint.checked}, ошибок ${report.lint.errors}`);
  lines.push(`Отчёт: ${resolve(report.out, "webport/REPORT.md")}`);
  writeStatus({ state: "done", output: lines.join("\n"), summary, out: report.out });
} catch (error) {
  writeStatus({ state: "failed", output: error?.stack ?? String(error), error: error?.message ?? String(error) });
  process.exitCode = 1;
}
