#!/usr/bin/env python3
"""Генерирует RSA-ключ и JKS/PKCS12-хранилище для подписи Android-приложения.

Нужен, когда под рукой нет keytool (нет JDK), но есть Python + OpenSSL.
Результат совместим с `keytool -list` и с Gradle (PKCS12).

    python3 scripts/make-signing-key.py --out ~/.mini-studio-keys \
        --alias ministudio --password 'пароль' --dname 'CN=Mini Studio, O=Mini Studio, C=CZ'

Создаёт:
  release.p12          — хранилище ключа (PKCS#12, как JKS для Gradle: storeType=PKCS12)
  certificate.pem      — сертификат
  keystore.properties  — готовые настройки для android/keystore.properties
"""
import argparse
import base64
import hashlib
import os
import struct
import subprocess
import sys
import tempfile


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def gen_key_and_cert(dname, password):
    """RSA 4096 + самоподписанный сертификат на 30 лет через openssl."""
    tmp = tempfile.mkdtemp()
    key = os.path.join(tmp, 'key.pem')
    crt = os.path.join(tmp, 'cert.pem')
    run(['openssl', 'genrsa', '-out', key, '4096'])
    run([
        'openssl', 'req', '-new', '-x509', '-sha256',
        '-key', key, '-out', crt, '-days', '10950',
        '-subj', '/' + dname.replace(', ', '/').replace(',', '/'),
    ])
    with open(key, 'rb') as f:
        key_pem = f.read()
    with open(crt, 'rb') as f:
        cert_pem = f.read()
    return tmp, key, crt, key_pem, cert_pem


def to_der(pem_bytes):
    b64 = b''.join(l for l in pem_bytes.split(b'\n') if b'-----' not in l)
    return base64.b64decode(b64)


def pkcs12(tmp, key, crt, out, password):
    """Собираем PKCS#12 (его читает и keytool, и Gradle, и apksigner)."""
    run([
        'openssl', 'pkcs12', '-export', '-inkey', key, '-in', crt,
        '-out', out, '-name', 'ministudio', '-passout', 'pass:' + password,
    ])
    return out


def der_to_pem(der, label):
    b64 = base64.encodebytes(der).decode().replace('\n', '')
    lines = [b64[i:i + 64] for i in range(0, len(b64), 64)]
    return ('-----BEGIN %s-----\n%s\n-----END %s-----\n' % (label, '\n'.join(lines), label)).encode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.expanduser('~/.mini-studio-keys'))
    ap.add_argument('--alias', default='ministudio')
    ap.add_argument('--password', default=None)
    ap.add_argument('--dname', default='CN=Mini Studio, OU=Audio, O=Mini Studio, L=Prague, C=CZ')
    args = ap.parse_args()

    password = args.password or base64.urlsafe_b64encode(os.urandom(18)).decode().rstrip('=')
    os.makedirs(args.out, mode=0o700, exist_ok=True)

    p12 = os.path.join(args.out, 'release.p12')
    if os.path.exists(p12):
        sys.exit('Ключ уже существует: %s\nУдалите вручную, если правда нужен новый '
                 '(смена ключа ломает обновления в Play).' % p12)

    tmp, key, crt, key_pem, cert_pem = gen_key_and_cert(args.dname, password)
    pkcs12(tmp, key, crt, p12, password)
    os.chmod(p12, 0o600)

    with open(os.path.join(args.out, 'certificate.pem'), 'wb') as f:
        f.write(cert_pem)

    props = os.path.join(args.out, 'keystore.properties')
    with open(props, 'w') as f:
        f.write('storeFile=%s\nstorePassword=%s\nkeyAlias=%s\nkeyPassword=%s\n'
                % (p12, password, args.alias, password))
    os.chmod(props, 0o600)

    # Отпечатки — как их показывает keytool
    der = to_der(cert_pem)
    sha256 = hashlib.sha256(der).hexdigest().upper()
    sha1 = hashlib.sha1(der).hexdigest().upper()
    fmt = lambda h: ':'.join(h[i:i + 2] for i in range(0, len(h), 2))
    md5 = None
    try:
        md5 = hashlib.md5(der).hexdigest().upper()
    except Exception:
        pass

    print('Готово:')
    print('  хранилище:  %s' % p12)
    print('  пароль:     %s   (сохраните в менеджере паролей!)' % password)
    print('  алиас:      %s' % args.alias)
    print('  настройки:  %s' % props)
    print()
    print('Отпечатки сертификата:')
    print('  SHA-256: %s' % fmt(sha256))
    print('  SHA-1:   %s' % fmt(sha1))
    if md5:
        print('  MD5:     %s' % fmt(md5))
    print()
    print('Для GitHub Secrets:')
    print('  base64 -w0 %s   → ANDROID_KEYSTORE_BASE64' % p12)
    print('  пароль                      → ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_PASSWORD')
    print('  алиас «%s»           → ANDROID_KEY_ALIAS' % args.alias)


if __name__ == '__main__':
    main()
