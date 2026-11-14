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
