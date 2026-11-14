import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const html = read('index.html');

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const jsFiles = walk(path.join(ROOT, 'assets', 'js'));
const sources = [...jsFiles, path.join(ROOT, 'index.html')];

test('the app never loads a subresource from a third party', () => {
    const offenders = [];
    for (const file of sources) {
        const src = fs.readFileSync(file, 'utf8');
        for (const match of src.matchAll(/(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']+/g)) {
            offenders.push(`${path.basename(file)}: ${match[0]}`);
        }
        for (const match of src.matchAll(/importScripts\(\s*["'](?:https?:)?\/\//g)) {
            offenders.push(`${path.basename(file)}: ${match[0]}`);
        }
        for (const match of src.matchAll(/\bfetch\(\s*["']https?:/g)) {
            offenders.push(`${path.basename(file)}: ${match[0]}`);
        }
        for (const match of src.matchAll(/@import\s+url\(\s*["']?https?:/g)) {
            offenders.push(`${path.basename(file)}: ${match[0]}`);
        }
    }
    assert.deepEqual(offenders, [], 'remove these external loads:\n' + offenders.join('\n'));
});

test('a strict Content-Security-Policy is declared', () => {
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /worker-src 'self'/);
    assert.ok(!/unsafe-eval/.test(html), "no 'unsafe-eval'");
    assert.ok(!/cdnjs|unpkg|jsdelivr|googleapis|gstatic/.test(html), 'no CDN hostnames');
});

test('every DOM lookup resolves to an element id, and ids are unique', () => {
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, 'duplicate element ids: ' +
        ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));

    const missing = [];
    for (const file of jsFiles) {
        const src = fs.readFileSync(file, 'utf8');
        for (const match of src.matchAll(/U\.\$\(\s*'([^']+)'\s*\)/g)) {
            if (!unique.has(match[1])) missing.push(`${path.basename(file)} -> #${match[1]}`);
        }
    }
    assert.deepEqual(missing, [], 'these lookups would throw at runtime:\n' + missing.join('\n'));
});

test('every local asset reference resolves on disk', () => {
    const missing = [];
    for (const match of html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)) {
        if (!fs.existsSync(path.join(ROOT, match[1]))) missing.push(match[1]);
    }
    for (const file of jsFiles) {
        const src = fs.readFileSync(file, 'utf8');
        for (const match of src.matchAll(/importScripts\(\s*'([^']+)'\s*\)/g)) {
            const resolved = path.resolve(path.dirname(file), match[1]);
            if (!fs.existsSync(resolved)) missing.push(`${path.basename(file)} -> ${match[1]}`);
        }
    }
    assert.deepEqual(missing, [], 'missing assets:\n' + missing.join('\n'));
});

test('vendored third-party files match CHECKSUMS.txt', () => {
    const manifest = read('assets/vendor/CHECKSUMS.txt');
    const entries = manifest.split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('SHA-256'));

    assert.ok(entries.length >= 10, 'manifest looks empty');

    for (const line of entries) {
        const [expected, rel] = line.split(/\s+/);
        assert.match(expected, /^[0-9a-f]{64}$/, 'bad digest line: ' + line);
        const actual = crypto.createHash('sha256')
            .update(fs.readFileSync(path.join(ROOT, rel)))
            .digest('hex');
        assert.equal(actual, expected, `${rel} does not match its recorded checksum`);
    }
});

test('every text file is UTF-8 without BOM and free of mojibake', () => {
    // Guards against editors that re-encode files and turn an em dash into a
    // three-character sequence starting with U+00E2. The markers are built from
    // code points so this file does not trip its own check.
    const TEXT = /\.(md|js|mjs|html|css|json|ya?ml|txt|svg)$/;
    const MARKERS = [
        String.fromCharCode(0x00e2, 0x20ac),   // a-circumflex + euro
        String.fromCharCode(0x00f0, 0x0178),   // eth + Y-diaeresis
        String.fromCharCode(0x00c3, 0x00a2),   // A-tilde + cent
        String.fromCharCode(0x00c3, 0x00a9),   // A-tilde + copyright
        String.fromCharCode(0x00c2, 0x00b7)    // A-circumflex + middle dot
    ];
    const problems = [];

    const walkAll = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === '.git' || entry.name === 'node_modules') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walkAll(full);
                continue;
            }
            if (!TEXT.test(entry.name)) continue;

            const raw = fs.readFileSync(full);
            const rel = path.relative(ROOT, full).split(path.sep).join('/');
            if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
                problems.push(`${rel}: starts with a UTF-8 BOM`);
            }
            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
            const roundTrip = Buffer.from(decoded, 'utf8');
            if (!roundTrip.equals(raw)) problems.push(`${rel}: does not round-trip as UTF-8`);
            for (const marker of MARKERS) {
                if (decoded.includes(marker)) problems.push(`${rel}: contains mojibake "${marker}"`);
            }
        }
    };

    walkAll(ROOT);
    assert.deepEqual(problems, [], 'encoding problems:\n' + problems.join('\n'));
});
