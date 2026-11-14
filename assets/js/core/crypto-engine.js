/* ==========================================================================
   core/crypto-engine.js â€” encryption profiles, KRX5 envelope, KRXFILE2 container

   Design notes
   ------------
   * Text envelopes are self-describing and the *whole* header (version, level,
     algorithm, KDF id, iteration count, salt, IV, compression) is passed to
     AES-GCM as additional authenticated data.  Changing any of it invalidates
     the tag, so a blob can never be downgraded or re-labelled.
   * Every field read from an untrusted blob is validated *before* a key is
     derived: version, algorithm allow-list, iteration bounds, salt/IV sizes and
     ciphertext size.  Malformed input fails fast instead of allocating work.
   * Files use the KRXFILE2 container: a fixed 44-byte header (magic, version,
     cipher, KDF, iterations, salt, IV) that is authenticated as AAD, followed
     by GCM(metaLen || metaJSON || contents).  The original filename is stored
     inside the ciphertext, so it is both confidential and authenticated.
   * Readers for the older formats (KRX4 envelope, v3 legacy blob, KRXFILE
     v1 container) are kept so nothing becomes undecryptable.
   ========================================================================== */
'use strict';

KX.crypto = (() => {
    const U = KX.utils;

    const SALT_SIZE = 16;
    const IV_SIZE = 12;
    const TAG_BITS = 128;

    const VERSION = 5;
    const ENVELOPE_PREFIX = 'KRX5.';
    const ENVELOPE_PREFIX_V4 = 'KRX4.';
    const KDF_ID = 'PBKDF2-SHA256';

    const MIN_ITERATIONS = 100000;
    const MAX_ITERATIONS = 4000000;
    const MAX_CIPHERTEXT_BYTES = 96 * 1024 * 1024;
    const MAX_PLAINTEXT_BYTES = 256 * 1024 * 1024;
    const MAX_META_BYTES = 64 * 1024;

    const FILE_MAGIC = 'KRXFILE2';
    const FILE_HEADER_LEN = 44;
    const FILE_CIPHER_ID = 1;     // AES-256-GCM
    const FILE_KDF_ID = 1;        // PBKDF2-HMAC-SHA256
    const FILE_ITERATIONS = 600000;
    const LEGACY_FILE_ITERATIONS = 250000;
    const LEGACY_TEXT_ITERATIONS = 250000;

    /**
     * Selectable cipher profiles. Each envelope carries its own KDF
     * parameters, so decryption never needs to know the chosen level.
     * Iteration counts follow OWASP's 600k floor for PBKDF2-HMAC-SHA256 and
     * scale up with the profile.
     */
    const LEVELS = {
        standard: {
            name: 'STANDARD',
            cipher: 'AES-128-GCM',
            keyLength: 128,
            iterations: 600000,
            tagline: 'PBKDF2 Ã— 600k Â· fast, everyday secrets',
            info: '<strong>AES-128-GCM</strong> with a PBKDF2-HMAC-SHA256 key stretched over <strong>600,000 iterations</strong>. ' +
                  'Brute-forcing the passphrase is the only practical attack, and stretching makes every guess expensive. ' +
                  'Best for everyday notes and quick exchanges where speed matters.'
        },
        advanced: {
            name: 'ADVANCED',
            cipher: 'AES-256-GCM',
            keyLength: 256,
            iterations: 1000000,
            tagline: 'PBKDF2 Ã— 1M Â· recommended balance',
            info: '<strong>AES-256-GCM</strong> with <strong>1,000,000 PBKDF2 iterations</strong> â€” the same profile used for file sealing and the vault. ' +
                  'GCM authenticates both the ciphertext and the envelope header: any modification in transit makes decryption fail loudly instead of returning corrupted data. ' +
                  'The recommended default for sensitive content.'
        },
        maximum: {
            name: 'MAXIMUM',
            cipher: 'AES-256-GCM',
            keyLength: 256,
            iterations: 2000000,
            tagline: 'PBKDF2 Ã— 2M Â· high-value data, slower',
            info: '<strong>AES-256-GCM</strong> with <strong>2,000,000 PBKDF2 iterations</strong>. Deriving the key takes a couple of seconds per attempt, ' +
                  'which throttles offline dictionary attacks by an order of magnitude versus the standard profile. ' +
                  'Use for long-lived, high-value secrets where a few seconds of patience is acceptable.'
        }
    };

    function assertIterations(iterations) {
        if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
            throw new Error('Refusing an unsafe key-derivation work factor (' + iterations + ').');
        }
    }

    async function deriveKey(passphrase, salt, iterations, keyLength) {
        if (!passphrase) throw new Error('Empty passphrase');
        assertIterations(iterations);
        if (keyLength !== 128 && keyLength !== 256) throw new Error('Unsupported key length');
        const material = await crypto.subtle.importKey(
            'raw', U.utf8Encode(passphrase), 'PBKDF2', false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
            material,
            { name: 'AES-GCM', length: keyLength },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /* ---------- envelope helpers ---------- */

    /** Header fields covered by the authentication tag, in a fixed order. */
    function headerBytes(env) {
        return U.utf8Encode(JSON.stringify({
            v: env.v, lvl: env.lvl, alg: env.alg, kdf: env.kdf,
            i: env.i, s: env.s, iv: env.iv, z: env.z
        }));
    }

    function decodeB64Url(value, what) {
        if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
            throw new Error('Malformed ' + what + ' (not base64url).');
        }
        return U.b64ToBuf(value.replace(/-/g, '+').replace(/_/g, '/'));
    }

    function decodeB64(value, what) {
        if (typeof value !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(value)) {
            throw new Error('Malformed ' + what + ' (not base64).');
        }
        return U.b64ToBuf(value);
    }

    function parseEnvelope(text) {
        if (text.length > MAX_CIPHERTEXT_BYTES * 2) throw new Error('Ciphertext exceeds the size limit.');
        let json;
        try {
            json = new TextDecoder().decode(decodeB64Url(text, 'envelope'));
        } catch (e) {
            throw new Error('Malformed envelope (not valid base64url JSON).');
        }
        try {
            return JSON.parse(json);
        } catch (e) {
            throw new Error('Malformed envelope (invalid JSON).');
        }
    }

    function validateEnvelope(env) {
        if (!env || typeof env !== 'object') throw new Error('Malformed envelope.');
        if (env.v !== VERSION) throw new Error('Unsupported envelope version (' + env.v + ').');
        if (env.alg !== 'AES-256-GCM' && env.alg !== 'AES-128-GCM') throw new Error('Unsupported cipher.');
        if (env.kdf !== KDF_ID) throw new Error('Unsupported key-derivation function.');
        if (!LEVELS[env.lvl]) throw new Error('Unknown security level.');
        assertIterations(env.i);
        if (env.z !== 'deflate' && env.z !== 'none') throw new Error('Unsupported payload encoding.');
        if (decodeB64(env.s, 'salt').length !== SALT_SIZE) throw new Error('Bad salt length.');
        if (decodeB64(env.iv, 'iv').length !== IV_SIZE) throw new Error('Bad IV length.');
        const ctLen = decodeB64(env.d, 'ciphertext').length;
        if (ctLen < 17) throw new Error('Ciphertext is truncated.');
        if (ctLen > MAX_CIPHERTEXT_BYTES) throw new Error('Ciphertext exceeds the size limit.');
    }

    /** Older KRX4 envelopes: same JSON shape, header not authenticated. */
    function validateLegacyEnvelope(env) {
        if (!env || typeof env !== 'object') throw new Error('Malformed envelope.');
        if (env.v !== 4) throw new Error('Unsupported envelope version.');
        if (env.alg !== 'AES-256-GCM' && env.alg !== 'AES-128-GCM') throw new Error('Unsupported cipher.');
        assertIterations(env.i);
        if (decodeB64(env.s, 'salt').length !== SALT_SIZE) throw new Error('Bad salt length.');
        if (decodeB64(env.iv, 'iv').length !== IV_SIZE) throw new Error('Bad IV length.');
        if (decodeB64(env.d, 'ciphertext').length > MAX_CIPHERTEXT_BYTES) throw new Error('Ciphertext exceeds the size limit.');
    }

    /** Inflate with a hard output cap so a hostile payload cannot exhaust memory. */
    function inflateCapped(bytes, maxBytes) {
        const engine = new pako.Inflate();
        const parts = [];
        let total = 0;
        let overflow = false;
        engine.onData = (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
                overflow = true;
                throw new Error('EXPANSION_LIMIT');
            }
            parts.push(chunk);
        };
        const CHUNK = 1024 * 1024;
        try {
            if (!bytes.length) {
                engine.push(new Uint8Array(0), true);
            } else {
                for (let off = 0; off < bytes.length; off += CHUNK) {
                    const end = Math.min(off + CHUNK, bytes.length);
                    engine.push(bytes.subarray(off, end), end >= bytes.length);
                    if (engine.err) throw new Error('CORRUPT');
                    if (end >= bytes.length) break;
                }
            }
        } catch (e) {
            if (overflow) throw new Error('Decrypted payload expands beyond the safety limit.');
            throw new Error('Decrypted payload is not valid deflate data.');
        }
        const out = new Uint8Array(total);
        let pos = 0;
        for (let i = 0; i < parts.length; i++) {
            out.set(parts[i], pos);
            pos += parts[i].length;
        }
        return U.utf8Decode(out);
    }

    /**
     * Encrypt text into a self-describing KRX5 envelope (base64url JSON).
     * Pipeline: deflate â†’ PBKDF2(level) â†’ AES-GCM(header as AAD).
     * Fresh salt/IV per call.
     */
    async function encryptText(plaintext, passphrase, levelName = 'advanced') {
        const level = LEVELS[levelName] || LEVELS.advanced;
        const t0 = performance.now();

        const originalSize = new Blob([plaintext]).size;
        const packed = pako.deflate(plaintext);

        const salt = U.randomBytes(SALT_SIZE);
        const iv = U.randomBytes(IV_SIZE);
        const key = await deriveKey(passphrase, salt, level.iterations, level.keyLength);

        const env = {
            v: VERSION,
            lvl: levelName,
            alg: level.cipher,
            kdf: KDF_ID,
            i: level.iterations,
            s: U.bufToB64(salt),
            iv: U.bufToB64(iv),
            z: 'deflate'
        };
        const cipherBuf = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: headerBytes(env), tagLength: TAG_BITS },
            key,
            packed
        );
        env.d = U.bufToB64(new Uint8Array(cipherBuf));

        const b64url = U.bufToB64(U.utf8Encode(JSON.stringify(env)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        return {
            result: ENVELOPE_PREFIX + b64url,
            stats: {
                original: originalSize,
                compressed: packed.length,
                ratio: originalSize > 0 ? ((1 - packed.length / originalSize) * 100).toFixed(1) : '0.0',
                time: (performance.now() - t0).toFixed(0)
            }
        };
    }

    /**
     * Decrypt a KRX5 envelope, a KRX4 envelope, or a legacy v3 payload
     * (raw base64 of salt|iv|ciphertext, AES-256, 250k iterations).
     */
    async function decryptText(input, passphrase) {
        const t0 = performance.now();
        if (typeof input !== 'string') throw new Error('Ciphertext must be text.');
        const clean = input.trim();
        if (!clean) throw new Error('No ciphertext provided.');
        if (clean.length > MAX_CIPHERTEXT_BYTES * 2) throw new Error('Ciphertext exceeds the size limit.');

        let plaintext;
        let meta = { version: 3 };

        if (clean.startsWith(ENVELOPE_PREFIX)) {
            const env = parseEnvelope(clean.slice(ENVELOPE_PREFIX.length));
            validateEnvelope(env);
            const key = await deriveKey(
                passphrase, decodeB64(env.s, 'salt'), env.i,
                env.alg === 'AES-128-GCM' ? 128 : 256
            );
            const plainBuf = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: decodeB64(env.iv, 'iv'),
                    additionalData: headerBytes(env),
                    tagLength: TAG_BITS
                },
                key,
                decodeB64(env.d, 'ciphertext')
            );
            const bytes = new Uint8Array(plainBuf);
            plaintext = env.z === 'deflate' ? inflateCapped(bytes, MAX_PLAINTEXT_BYTES) : U.utf8Decode(bytes);
            meta = { version: 5, level: env.lvl, iterations: env.i, algorithm: env.alg };
        } else if (clean.startsWith(ENVELOPE_PREFIX_V4)) {
            const env = parseEnvelope(clean.slice(ENVELOPE_PREFIX_V4.length));
            validateLegacyEnvelope(env);
            const key = await deriveKey(
                passphrase, decodeB64(env.s, 'salt'), env.i,
                env.alg.includes('256') ? 256 : 128
            );
            const plainBuf = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: decodeB64(env.iv, 'iv'), tagLength: TAG_BITS },
                key,
                decodeB64(env.d, 'ciphertext')
            );
            plaintext = inflateCapped(new Uint8Array(plainBuf), MAX_PLAINTEXT_BYTES);
            meta = { version: 4, level: env.lvl, iterations: env.i, algorithm: env.alg };
        } else {
            const combined = U.b64ToBuf(clean);
            if (combined.length < SALT_SIZE + IV_SIZE + 1) throw new Error('Invalid ciphertext.');
            if (combined.length > MAX_CIPHERTEXT_BYTES) throw new Error('Ciphertext exceeds the size limit.');
            const key = await deriveKey(
                passphrase, combined.slice(0, SALT_SIZE), LEGACY_TEXT_ITERATIONS, 256
            );
            const plainBuf = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: combined.slice(SALT_SIZE, SALT_SIZE + IV_SIZE),
                    tagLength: TAG_BITS
                },
                key,
                combined.slice(SALT_SIZE + IV_SIZE)
            );
            plaintext = inflateCapped(new Uint8Array(plainBuf), MAX_PLAINTEXT_BYTES);
        }

        return { result: plaintext, stats: { time: (performance.now() - t0).toFixed(0) }, meta };
    }

    /** Read-only peek at an envelope's metadata (used to explain what was opened). */
    function peekEnvelope(input) {
        try {
            const clean = String(input || '').trim();
            if (clean.startsWith(ENVELOPE_PREFIX)) {
                const env = parseEnvelope(clean.slice(ENVELOPE_PREFIX.length));
                return { version: 5, level: env.lvl, iterations: env.i, algorithm: env.alg };
            }
            if (clean.startsWith(ENVELOPE_PREFIX_V4)) {
                const env = parseEnvelope(clean.slice(ENVELOPE_PREFIX_V4.length));
                return { version: 4, level: env.lvl, iterations: env.i, algorithm: env.alg };
            }
        } catch (e) { /* not an envelope */ }
        return null;
    }

    /** Seal and immediately re-open: catches a mistyped passphrase before the user saves. */
    async function verifySeal(plaintext, passphrase, levelName) {
        const sealed = await encryptText(plaintext, passphrase, levelName);
        const opened = await decryptText(sealed.result, passphrase);
        return opened.result === plaintext;
    }

    /* ---------- file sealing (KRXFILE2 container) ---------- */

    function sanitizeName(name) {
        const cleaned = String(name || '')
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
            .trim();
        return cleaned.slice(0, 200) || 'kriptex-file';
    }

    function packFileHeader(iterations, salt, iv) {
        const head = new Uint8Array(FILE_HEADER_LEN);
        for (let i = 0; i < FILE_MAGIC.length; i++) head[i] = FILE_MAGIC.charCodeAt(i);
        head[8] = 2;                 // container version
        head[9] = FILE_CIPHER_ID;    // AES-256-GCM
        head[10] = FILE_KDF_ID;      // PBKDF2-HMAC-SHA256
        head[11] = 0;                // reserved
        new DataView(head.buffer).setUint32(12, iterations, false);
        head.set(salt, 16);
        head.set(iv, 32);
        return head;
    }

    function hasFileMagic(bytes) {
        if (bytes.length < FILE_MAGIC.length) return false;
        for (let i = 0; i < FILE_MAGIC.length; i++) {
            if (bytes[i] !== FILE_MAGIC.charCodeAt(i)) return false;
        }
        return true;
    }

    async function sealFile(fileBuffer, passphrase, filename) {
        const bytes = fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer);
        const t0 = performance.now();

        const salt = U.randomBytes(SALT_SIZE);
        const iv = U.randomBytes(IV_SIZE);
        const meta = { name: sanitizeName(filename), size: bytes.length, mtime: Date.now() };
        const metaBytes = U.utf8Encode(JSON.stringify(meta));

        const body = new Uint8Array(4 + metaBytes.length + bytes.length);
        new DataView(body.buffer).setUint32(0, metaBytes.length, false);
        body.set(metaBytes, 4);
        body.set(bytes, 4 + metaBytes.length);

        const head = packFileHeader(FILE_ITERATIONS, salt, iv);
        const key = await deriveKey(passphrase, salt, FILE_ITERATIONS, 256);
        const cipherBuf = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: head, tagLength: TAG_BITS },
            key,
            body
        );

        const out = new Uint8Array(head.length + cipherBuf.byteLength);
        out.set(head, 0);
        out.set(new Uint8Array(cipherBuf), head.length);

        return {
            blob: new Blob([out], { type: 'application/octet-stream' }),
            filename: meta.name + '.krx',
            meta,
            stats: { size: out.length, time: (performance.now() - t0).toFixed(0) }
        };
    }

    async function openFile(fileBuffer, passphrase, filename) {
        const file = fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer);
        const t0 = performance.now();
        let plaintext;
        let meta;

        if (hasFileMagic(file)) {
            if (file.length < FILE_HEADER_LEN + 17) throw new Error('Container is truncated.');
            if (file[8] !== 2) throw new Error('Unsupported container version (' + file[8] + ').');
            if (file[9] !== FILE_CIPHER_ID) throw new Error('Unsupported container cipher.');
            if (file[10] !== FILE_KDF_ID) throw new Error('Unsupported container KDF.');
            const iterations = new DataView(file.buffer, file.byteOffset).getUint32(12, false);
            assertIterations(iterations);
            const salt = file.slice(16, 32);
            const iv = file.slice(32, 44);
            const head = file.slice(0, FILE_HEADER_LEN);
            const key = await deriveKey(passphrase, salt, iterations, 256);
            const plainBuf = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv, additionalData: head, tagLength: TAG_BITS },
                key,
                file.slice(FILE_HEADER_LEN)
            );
            const body = new Uint8Array(plainBuf);
            if (body.length < 4) throw new Error('Container payload is corrupt.');
            const metaLen = new DataView(body.buffer, body.byteOffset).getUint32(0, false);
            if (metaLen > MAX_META_BYTES || 4 + metaLen > body.length) throw new Error('Container metadata is corrupt.');
            try {
                meta = JSON.parse(U.utf8Decode(body.subarray(4, 4 + metaLen)));
            } catch (e) {
                throw new Error('Container metadata is corrupt.');
            }
            meta = {
                name: sanitizeName(meta.name),
                size: Number(meta.size) || 0,
                mtime: Number(meta.mtime) || 0
            };
            plaintext = body.subarray(4 + metaLen);
        } else {
            // Legacy v1 container: salt (16) | iv (12) | ciphertext
            if (file.length < SALT_SIZE + IV_SIZE + 1) throw new Error('Invalid .krx container.');
            const key = await deriveKey(passphrase, file.slice(0, SALT_SIZE), LEGACY_FILE_ITERATIONS, 256);
            const plainBuf = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: file.slice(SALT_SIZE, SALT_SIZE + IV_SIZE),
                    tagLength: TAG_BITS
                },
                key,
                file.slice(SALT_SIZE + IV_SIZE)
            );
            plaintext = new Uint8Array(plainBuf);
            const base = String(filename || '').replace(/\.krx$/i, '');
            meta = { name: sanitizeName(base || 'restored-file'), size: plaintext.length, mtime: 0 };
        }

        return {
            blob: new Blob([plaintext], { type: 'application/octet-stream' }),
            filename: meta.name,
            meta,
            stats: { time: (performance.now() - t0).toFixed(0) }
        };
    }

    /* ---------- hashing ---------- */

    /**
     * CryptoJS implements original Keccak, not FIPS-202 SHA-3 (different
     * domain-separation padding), so the labels must say Keccak.  Verified
     * against the NIST empty-string vector in test/crypto.test.mjs.
     */
    const HASH_ALGOS = {
        'MD5':        { fn: (w) => CryptoJS.MD5(w),                              hexLen: 32,  weak: true },
        'SHA-1':      { fn: (w) => CryptoJS.SHA1(w),                             hexLen: 40,  weak: true },
        'SHA-224':    { fn: (w) => CryptoJS.SHA224(w),                           hexLen: 56,  weak: false },
        'SHA-256':    { fn: (w) => CryptoJS.SHA256(w),                            hexLen: 64,  weak: false },
        'SHA-384':    { fn: (w) => CryptoJS.SHA384(w),                           hexLen: 96,  weak: false },
        'SHA-512':    { fn: (w) => CryptoJS.SHA512(w),                           hexLen: 128, weak: false },
        'Keccak-256': { fn: (w) => CryptoJS.SHA3(w, { outputLength: 256 }),      hexLen: 64,  weak: false },
        'Keccak-512': { fn: (w) => CryptoJS.SHA3(w, { outputLength: 512 }),      hexLen: 128, weak: false },
        'RIPEMD-160': { fn: (w) => CryptoJS.RIPEMD160(w),                        hexLen: 40,  weak: false }
    };

    /** Streaming variants (same algorithms, incremental API). */
    const STREAM_ALGOS = {
        'MD5': (w) => CryptoJS.algo.MD5.create(),
        'SHA-1': (w) => CryptoJS.algo.SHA1.create(),
        'SHA-224': (w) => CryptoJS.algo.SHA224.create(),
        'SHA-256': (w) => CryptoJS.algo.SHA256.create(),
        'SHA-384': (w) => CryptoJS.algo.SHA384.create(),
        'SHA-512': (w) => CryptoJS.algo.SHA512.create(),
        'Keccak-256': () => CryptoJS.algo.SHA3.create({ outputLength: 256 }),
        'Keccak-512': () => CryptoJS.algo.SHA3.create({ outputLength: 512 }),
        'RIPEMD-160': () => CryptoJS.algo.RIPEMD160.create()
    };

    function hashText(text, algorithm) {
        const algo = HASH_ALGOS[algorithm];
        if (!algo) throw new Error('Unsupported algorithm: ' + algorithm);
        return algo.fn(text).toString();
    }

    /** Streamed file hashing in 4 MB slices â€” constant memory usage. */
    async function hashFile(file, algorithm, onProgress) {
        const factory = STREAM_ALGOS[algorithm];
        if (!factory) throw new Error('Unsupported algorithm: ' + algorithm);
        const hasher = factory();
        const SLICE = 4 * 1024 * 1024;
        let offset = 0;
        while (offset < file.size) {
            const buf = await file.slice(offset, offset + SLICE).arrayBuffer();
            hasher.update(CryptoJS.lib.WordArray.create(buf));
            offset += buf.byteLength;
            if (onProgress) onProgress(Math.round((offset / file.size) * 100));
            await new Promise((r) => setTimeout(r, 0));
        }
        return hasher.finalize().toString();
    }

    /** Guess plausible algorithms from digest length (ambiguous ones listed together). */
    function detectHashAlgorithms(digest) {
        const hex = String(digest || '').trim().toLowerCase();
        if (!/^[0-9a-f]+$/.test(hex)) return [];
        return Object.keys(HASH_ALGOS).filter((name) => HASH_ALGOS[name].hexLen === hex.length);
    }

    const isWeakHash = (name) => !!(HASH_ALGOS[name] && HASH_ALGOS[name].weak);

    return {
        LEVELS, ENVELOPE_PREFIX, FILE_MAGIC, MIN_ITERATIONS, MAX_ITERATIONS,
        MAX_PLAINTEXT_BYTES, FILE_ITERATIONS,
        deriveKey, encryptText, decryptText, peekEnvelope, verifySeal,
        sealFile, openFile,
        HASH_ALGOS, hashText, hashFile, detectHashAlgorithms, isWeakHash
    };
})();
