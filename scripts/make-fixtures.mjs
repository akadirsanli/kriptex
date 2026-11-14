/* ==========================================================================
   scripts/make-fixtures.mjs — generate the format compatibility fixtures.

   The fixtures are produced by an *independent* implementation (Node's
   WebCrypto + zlib, not the app code) so test/crypto.test.mjs proves that the
   shipping decryptor understands the documented wire format, not merely its
   own output.

   Run: node scripts/make-fixtures.mjs
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'fixtures');

const enc = new TextEncoder();
const b64 = (u8) => Buffer.from(u8).toString('base64');
const b64url = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomBytes = (n) => webcrypto.getRandomValues(new Uint8Array(n));

async function derive(pass, salt, iterations, bits) {
    const material = await webcrypto.subtle.importKey(
        'raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']
    );
    return webcrypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: bits },
        false,
        ['encrypt']
    );
}

async function seal(key, iv, data, aad) {
    const params = { name: 'AES-GCM', iv, tagLength: 128 };
    if (aad) params.additionalData = aad;
    const buf = await webcrypto.subtle.encrypt(params, key, data);
    return new Uint8Array(buf);
}

function write(name, data) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, name), data);
    console.log('wrote', name, typeof data === 'string' ? data.length + ' chars' : data.length + ' bytes');
}

/* ---------- legacy v4 text envelope (unauthenticated header) ---------- */
{
    const pass = 'kriptex-fixture-v4';
    const plaintext = 'Legacy KRX4 envelope fixture — decrypts with the v4 profile.';
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const iterations = 250000;
    const key = await derive(pass, salt, iterations, 256);
    const ct = await seal(key, iv, zlib.deflateSync(Buffer.from(plaintext)));
    const env = {
        v: 4, lvl: 'advanced', alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256',
        i: iterations, s: b64(salt), iv: b64(iv), d: b64(ct)
    };
    write('legacy-v4-envelope.txt', 'KRX4.' + b64url(enc.encode(JSON.stringify(env))) + '\n');
}

/* ---------- current KRX5 envelope (authenticated header) ---------- */
{
    const pass = 'kriptex-fixture-v5';
    const plaintext = 'KRX5 fixture: the header is authenticated as AES-GCM AAD.';
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const header = {
        v: 5, lvl: 'standard', alg: 'AES-128-GCM', kdf: 'PBKDF2-SHA256',
        i: 600000, s: b64(salt), iv: b64(iv), z: 'deflate'
    };
    const key = await derive(pass, salt, header.i, 128);
    const ct = await seal(key, iv, zlib.deflateSync(Buffer.from(plaintext)),
        enc.encode(JSON.stringify(header)));
    const env = Object.assign({}, header, { d: b64(ct) });
    write('krx5-envelope.txt', 'KRX5.' + b64url(enc.encode(JSON.stringify(env))) + '\n');
}

/* ---------- legacy v1 .krx container: salt|iv|ciphertext ---------- */
{
    const pass = 'kriptex-fixture-krx-v1';
    const payload = enc.encode('legacy v1 container payload\n');
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await derive(pass, salt, 250000, 256);
    const ct = await seal(key, iv, payload);
    const out = new Uint8Array(salt.length + iv.length + ct.length);
    out.set(salt, 0);
    out.set(iv, salt.length);
    out.set(ct, salt.length + iv.length);
    write('legacy-v1-file.krx', Buffer.from(out));
}

/* ---------- KRXFILE2 container with encrypted metadata ---------- */
{
    const pass = 'kriptex-fixture-krxfile2';
    const contents = enc.encode('KRXFILE2 container payload\nsecond line\n');
    const name = 'fixture-note.txt';
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const iterations = 300000;
    const metaBytes = enc.encode(JSON.stringify({ name, size: contents.length, mtime: 1700000000000 }));

    const head = new Uint8Array(44);
    for (let i = 0; i < 8; i++) head[i] = 'KRXFILE2'.charCodeAt(i);
    head[8] = 2;
    head[9] = 1;
    head[10] = 1;
    head[11] = 0;
    new DataView(head.buffer).setUint32(12, iterations, false);
    head.set(salt, 16);
    head.set(iv, 32);

    const body = new Uint8Array(4 + metaBytes.length + contents.length);
    new DataView(body.buffer).setUint32(0, metaBytes.length, false);
    body.set(metaBytes, 4);
    body.set(contents, 4 + metaBytes.length);

    const key = await derive(pass, salt, iterations, 256);
    const ct = await seal(key, iv, body, head);
    const out = new Uint8Array(head.length + ct.length);
    out.set(head, 0);
    out.set(ct, head.length);
    write('krxfile2.krx', Buffer.from(out));
}

console.log('\nfixture passphrases are listed in test/crypto.test.mjs');
