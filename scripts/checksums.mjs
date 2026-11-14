/* ==========================================================================
   scripts/checksums.mjs — regenerate assets/vendor/CHECKSUMS.txt

   Run after updating a vendored library:
       node scripts/checksums.mjs
   CI (tests/static.test.mjs) fails if a vendored file no longer matches.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'assets', 'vendor');
const MANIFEST = path.join(VENDOR, 'CHECKSUMS.txt');

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (full !== MANIFEST && /\.(js|css|woff2)$/.test(entry.name)) out.push(full);
    }
    return out;
}

const lines = [
    '# SHA-256 of every vendored third-party file.',
    '# Regenerate with: node scripts/checksums.mjs',
    '# Verify with:     node --test tests/',
    ''
];

for (const file of walk(VENDOR).sort()) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    lines.push(`${digest}  ${rel}`);
}

fs.writeFileSync(MANIFEST, lines.join('\n') + '\n');
console.log('wrote', path.relative(ROOT, MANIFEST), '(' + (lines.length - 4) + ' files)');
