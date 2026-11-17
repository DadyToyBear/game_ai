import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function resolveSafe(baseDir, relPath) {
  const target = path.resolve(baseDir, '.' + relPath);
  if (!target.startsWith(path.resolve(baseDir))) return null;
  return target;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(urlObj.pathname);

  let filePath = null;
  if (pathname === '/' || pathname === '/index.html' || pathname === '/game' || pathname === '/game.html') {
    filePath = path.join(__dirname, 'viewer', 'game.html');
  } else if (pathname === '/animations' || pathname === '/animations.html') {
    filePath = path.join(__dirname, 'viewer', 'animations.html');
  } else if (pathname === '/squad' || pathname === '/squad-demo.html') {
    filePath = path.join(__dirname, 'viewer', 'squad-demo.html');
  } else if (pathname.startsWith('/assets/')) {
    filePath = resolveSafe(path.join(__dirname, 'assets'), pathname.slice('/assets'.length));
  } else if (pathname.startsWith('/data/')) {
    filePath = resolveSafe(path.join(__dirname, 'data'), pathname.slice('/data'.length));
  } else {
    filePath = resolveSafe(path.join(__dirname, 'viewer'), pathname);
  }

  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Strategy game server listening on http://0.0.0.0:${PORT}`);
});
