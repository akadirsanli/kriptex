import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, fixture } from './harness.mjs';

const app = createApp();
const KX = app.KX;
const C = KX.crypto;
const U = KX.utils;

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const textOf = (buf) => Buffer.from(buf).toString('utf8');

test('KRX5 round-trips at every profile and reports its metadata', async () => {
    const plaintext = 'Hello — 日本語 🚀 line two\nand *markup* <b>kept</b> literal.';
    for (const level of Object.keys(C.LEVELS)) {
        const { result, stats } = await C.encryptText(plaintext, 'correct horse battery staple', level);
        assert.ok(result.startsWith('KRX5.'), 'envelope prefix');

        const peek = C.peekEnvelope(result);
        assert.equal(peek.version, 5);
        assert.equal(peek.level, level);
        assert.equal(peek.iterations, C.LEVELS[level].iterations);

        const opened = await C.decryptText(result, 'correct horse battery staple');
        assert.equal(opened.result, plaintext);
        assert.equal(opened.meta.version, 5);
        assert.equal(opened.meta.level, level);
        assert.ok(Number(stats.time) >= 0);
    }
});

test('a wrong passphrase fails the authentication tag', async () => {
    const { result } = await C.encryptText('secret', 'right-passphrase', 'standard');
    await assert.rejects(() => C.decryptText(result, 'wrong-passphrase'));
});

test('tampering with the authenticated header is detected', async () => {
    const { result } = await C.encryptText('header binding test', 'passphrase-123', 'standard');
    const env = JSON.parse(Buffer.from(result.slice(5), 'base64url').toString('utf8'));

    const variants = [
        { ...env, lvl: 'maximum' },
        { ...env, i: 150000 },
        { ...env, alg: 'AES-256-GCM' },
        { ...env, z: 'none' },
        { ...env, iv: U.bufToB64(U.randomBytes(12)) }
    ];

    for (const variant of variants) {
        const blob = 'KRX5.' + Buffer.from(JSON.stringify(variant)).toString('base64url');
        await assert.rejects(() => C.decryptText(blob, 'passphrase-123'),
            `tampered ${JSON.stringify(variant).slice(0, 40)} must not decrypt`);
    }
});

test('unsafe or malformed envelopes are rejected before key derivation', async () => {
    const { result } = await C.encryptText('bounds', 'passphrase-123', 'standard');
    const env = JSON.parse(Buffer.from(result.slice(5), 'base64url').toString('utf8'));

    const make = (patch) => 'KRX5.' + Buffer.from(JSON.stringify({ ...env, ...patch })).toString('base64url');

    await assert.rejects(() => C.decryptText(make({ i: 1000 }), 'passphrase-123'), /work factor/i);
    await assert.rejects(() => C.decryptText(make({ i: 99_000_000 }), 'passphrase-123'), /work factor/i);
    await assert.rejects(() => C.decryptText(make({ v: 7 }), 'passphrase-123'), /version/i);
    await assert.rejects(() => C.decryptText(make({ alg: 'AES-192-CBC' }), 'passphrase-123'), /cipher/i);
    await assert.rejects(() => C.decryptText(make({ s: U.bufToB64(U.randomBytes(4)) }), 'passphrase-123'), /salt/i);
    await assert.rejects(() => C.decryptText(make({ d: '' }), 'passphrase-123'), /truncated|malformed/i);
    await assert.rejects(() => C.decryptText('KRX5.not-base64!', 'passphrase-123'));
    await assert.rejects(() => C.decryptText('', 'passphrase-123'));
});

test('a KRX5 envelope produced by an independent implementation decrypts', async () => {
    const fixtureText = fixture('krx5-envelope.txt').toString('utf8').trim();
    const opened = await C.decryptText(fixtureText, 'kriptex-fixture-v5');
    assert.equal(opened.result, 'KRX5 fixture: the header is authenticated as AES-GCM AAD.');
    assert.equal(opened.meta.version, 5);
    assert.equal(opened.meta.level, 'standard');
    assert.equal(opened.meta.iterations, 600000);
});

test('legacy v4 envelopes still decrypt (backwards compatibility)', async () => {
    const fixtureText = fixture('legacy-v4-envelope.txt').toString('utf8').trim();
    const opened = await C.decryptText(fixtureText, 'kriptex-fixture-v4');
    assert.equal(opened.result, 'Legacy KRX4 envelope fixture — decrypts with the v4 profile.');
    assert.equal(opened.meta.version, 4);
});

test('.krx round-trips contents, name and size', async () => {
    const contents = U.utf8Encode('file payload\n'.repeat(1000));
    const sealed = await C.sealFile(contents, 'file-passphrase', 'report final.pdf');

    assert.equal(sealed.filename, 'report final.pdf.krx');
    assert.equal(sealed.meta.name, 'report final.pdf');
    assert.equal(sealed.meta.size, contents.length);

    const opened = await C.openFile(await bytesOf(sealed.blob), 'file-passphrase', sealed.filename);
    assert.equal(opened.filename, 'report final.pdf');
    assert.equal(opened.meta.size, contents.length);
    assert.deepEqual(Array.from(await bytesOf(opened.blob)), Array.from(contents));
});

test('.krx rejects a tampered header, a wrong passphrase and truncation', async () => {
    const contents = U.utf8Encode('tamper me');
    const sealed = await C.sealFile(contents, 'file-passphrase', 'x.bin');
    const bytes = await bytesOf(sealed.blob);

    const tampered = bytes.slice();
    tampered[12] ^= 0x01; // iteration count is inside the AAD
    await assert.rejects(() => C.openFile(tampered, 'file-passphrase', sealed.filename));

    await assert.rejects(() => C.openFile(bytes, 'wrong-passphrase', sealed.filename));
    await assert.rejects(() => C.openFile(bytes.slice(0, 20), 'file-passphrase', sealed.filename), /truncated/i);
});

test('legacy v1 .krx and KRXFILE2 fixtures open', async () => {
    const legacy = fixture('legacy-v1-file.krx');
    const openedLegacy = await C.openFile(new Uint8Array(legacy), 'kriptex-fixture-krx-v1', 'old.bin.krx');
    assert.equal(textOf(await bytesOf(openedLegacy.blob)), 'legacy v1 container payload\n');
    assert.equal(openedLegacy.filename, 'old.bin');

    const modern = fixture('krxfile2.krx');
    const openedModern = await C.openFile(new Uint8Array(modern), 'kriptex-fixture-krxfile2', 'whatever.krx');
    assert.equal(openedModern.filename, 'fixture-note.txt');
    assert.equal(openedModern.meta.size, 'KRXFILE2 container payload\nsecond line\n'.length);
    assert.equal(textOf(await bytesOf(openedModern.blob)), 'KRXFILE2 container payload\nsecond line\n');
});

test('hash implementations match published vectors', () => {
    assert.equal(C.hashText('abc', 'SHA-256'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(C.hashText('', 'SHA-512').slice(0, 16), 'cf83e1357eefb8bd');
    assert.equal(C.hashText('', 'MD5'), 'd41d8cd98f00b204e9800998ecf8427e');

    // CryptoJS implements Keccak, not FIPS-202 SHA-3. The UI labels it accordingly;
    // this test pins the behaviour so it can never be silently relabelled as SHA3.
    assert.equal(C.hashText('', 'Keccak-256'), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    assert.notEqual(C.hashText('', 'Keccak-256'), 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a');
});

test('algorithm detection maps digest lengths to candidates', () => {
    const detect = (digest) => Array.from(C.detectHashAlgorithms(digest));
    assert.deepEqual(detect('d41d8cd98f00b204e9800998ecf8427e'), ['MD5']);
    assert.deepEqual(detect('a9993e364706816aba3e25717850c26c9cd0d89d'), ['SHA-1', 'RIPEMD-160']);
    assert.deepEqual(detect('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
        ['SHA-256', 'Keccak-256']);
    assert.deepEqual(detect('not hex'), []);
    assert.equal(C.isWeakHash('MD5'), true);
    assert.equal(C.isWeakHash('SHA-256'), false);
});

test('file hashing streams in slices and matches the one-shot digest', async () => {
    const payload = U.utf8Encode('abcdef'.repeat(200000));
    const file = {
        size: payload.length,
        slice: (start, end) => ({
            arrayBuffer: async () => app.toRealm(payload.subarray(start, end)).buffer
        })
    };
    let progress = 0;
    const digest = await C.hashFile(file, 'SHA-256', (pct) => { progress = pct; });
    assert.equal(digest, C.hashText(textOf(payload), 'SHA-256'));
    assert.equal(progress, 100);
});

test('every offered algorithm has a working streaming implementation', async () => {
    const payload = U.utf8Encode('kriptex streaming check');
    const file = {
        size: payload.length,
        slice: (start, end) => ({
            arrayBuffer: async () => app.toRealm(payload.subarray(start, end)).buffer
        })
    };
    for (const algorithm of Object.keys(C.HASH_ALGOS)) {
        const streamed = await C.hashFile(file, algorithm);
        assert.equal(streamed, C.hashText('kriptex streaming check', algorithm), algorithm);
    }
});

test('passphrase strength is pessimistic about common patterns', () => {
    assert.ok(U.entropyBits('qwertyuiop1!') <= 24);
    assert.ok(U.entropyBits('Password1!') <= 24);
    assert.ok(U.entropyBits('correct-horse-battery-staple-42') > 60);
    const label = U.strengthLabel(U.entropyBits('qwertyuiop1!'));
    assert.match(label.label, /weak|very weak/);
});

test('wordlist and generators produce the promised entropy', () => {
    assert.equal(KX.wordlist.length, 7776);
    assert.equal(new Set(KX.wordlist).size, 7776);
    assert.ok(Math.abs(KX.generators.WORD_BITS - 12.925) < 0.01);

    const pw = KX.generators.password(24, true, true, true, true);
    assert.equal(pw.length, 24);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[0-9]/);
    assert.match(pw, /[^A-Za-z0-9]/);

    const phrase = KX.generators.passphrase(6, false, false, true);
    assert.equal(phrase.split('-').length, 6);
    const bits = KX.generators.passphraseEntropy(6, false, false);
    assert.ok(bits > 74, 'six EFF words are worth ~77 bits, got ' + bits);
});

test('encryptText refuses an empty passphrase', async () => {
    await assert.rejects(() => C.encryptText('x', '', 'standard'));
});
