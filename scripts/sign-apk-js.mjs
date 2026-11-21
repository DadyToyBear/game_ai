#!/usr/bin/env node
// Подписывает APK без Android SDK: apk_sign_ts (JAR v1 + APK Signature Scheme v2).
//
// Использование:
//   node scripts/sign-apk-js.mjs --in app-unsigned.apk --out app-signed.apk \
//        --keystore release.p12 --password ПАРОЛЬ [--alias ministudio]
//
// Ключ читается из PKCS#12 (его делает scripts/gen-keystore.sh или
// scripts/make-signing-key.py). Приватный ключ форматируется в PKCS#8,
// потому что этого требует WebCrypto внутри apk_sign_ts.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inFile = arg('in');
const outFile = arg('out');
const keystore = arg('keystore');
const password = process.env.MS_KEYSTORE_PASSWORD || arg('password');
const alias = arg('alias', '');

if (!inFile || !outFile || !keystore || !password) {
  console.error('нужны --in, --out, --keystore и пароль (--password или MS_KEYSTORE_PASSWORD)');
  process.exit(2);
}

// apk_sign_ts и его зависимости живут в tools/signer (см. scripts/install-toolchain.sh)
function loadPackage(name) {
  const repoRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));
  const candidates = [
    process.env.MS_SIGNER_DIR && path.join(process.env.MS_SIGNER_DIR, 'node_modules'),
    path.join(process.cwd(), 'tools/signer/node_modules'),
    path.join(repoRoot, 'tools/signer/node_modules'),
  ].filter(Boolean);
  const errors = [];
  for (const dir of candidates) {
    try {
      return require(require.resolve(name, { paths: [dir] }));
    } catch (err) {
      errors.push(`${dir}: ${err.code || err.message}`);
    }
  }
  throw new Error(`не найден модуль ${name}. Запустите: bash scripts/install-toolchain.sh\n${errors.join('\n')}`);
}

const jks = loadPackage('jks-js');
const forge = loadPackage('node-forge');
const signerPkg = loadPackage('apk_sign_ts');

// PKCS#1 → PKCS#8: apk_sign_ts импортирует ключ через WebCrypto и понимает только PKCS#8.
function pkcs1ToPkcs8(pkcs1Pem) {
  const asn1 = forge.asn1;
  const der = forge.util.decode64(pkcs1Pem.replace(/-----[^-]+-----|\s/g, ''));
  const rsaPrivateKey = asn1.fromDer(der);
  const privateKeyInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(0).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
        asn1.oidToDer(forge.pki.oids.rsaEncryption).getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    ]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false,
      asn1.toDer(rsaPrivateKey).getBytes()),
  ]);
  const b64 = forge.util.encode64(asn1.toDer(privateKeyInfo).getBytes(), 64);
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

const entries = Object.values(jks.parsePkcs12(fs.readFileSync(keystore), password));
const keyEntry = entries.find((e) => e.key);
const certEntry = entries.find((e) => e.cert);
if (!keyEntry || !certEntry) throw new Error('в хранилище нет пары «ключ + сертификат»');

const privateKeyPem = pkcs1ToPkcs8(forge.pki.privateKeyToPem(keyEntry.key));
const certificatePem = forge.pki.certificateToPem(certEntry.cert);

const { ApkSigner, SigningKey } = signerPkg;
const signingKey = SigningKey.fromPEM(privateKeyPem, certificatePem, password);
const { signedApk } = await new ApkSigner({ signingKey }).sign(fs.readFileSync(inFile));
fs.writeFileSync(outFile, signedApk);

const cert = forge.pki.certificateFromPem(certificatePem);
const sha256 = forge.md.sha256.create();
sha256.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
const fp = sha256.digest().toHex().match(/.{2}/g).join(':').toUpperCase();
console.log(`подписано: ${outFile} (${signedApk.length} байт, v1+v2)`);
console.log(`сертификат SHA-256: ${fp}`);
if (alias) console.log(`alias: ${alias}`);
