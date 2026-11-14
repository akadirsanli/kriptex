import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_FILES = ['assets/css/base.css', 'assets/css/components.css', 'assets/css/effects.css'];
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = CSS_FILES.map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const cssAll = css.join('\n');

test('stylesheets have balanced blocks and no stray tokens', () => {
    CSS_FILES.forEach((rel, index) => {
        const src = css[index];
        let depth = 0;
        for (const ch of src.replace(/\/\*[\s\S]*?\*\//g, '')) {
            if (ch === '{') depth++;
            if (ch === '}') depth--;
            assert.ok(depth >= 0, `${rel}: unexpected closing brace`);
        }
        assert.equal(depth, 0, `${rel}: ${depth} unclosed block(s)`);

        let parens = 0;
        for (const ch of src) {
            if (ch === '(') parens++;
            if (ch === ')') parens--;
            assert.ok(parens >= 0, `${rel}: unbalanced parenthesis`);
        }
        assert.equal(parens, 0, `${rel}: ${parens} unclosed parenthes(es)`);
    });
});

test('every custom property used by the stylesheets is defined', () => {
    // Values written by JavaScript at runtime.
    const RUNTIME = new Set(['--sx', '--sy', '--fill']);

    const defined = new Set();
    for (const match of cssAll.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(match[1]);

    const missing = new Set();
    for (const match of cssAll.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const name = match[1];
        if (!defined.has(name) && !RUNTIME.has(name)) missing.add(name);
    }
    assert.deepEqual([...missing], [], 'undefined custom properties: ' + [...missing].join(', '));
});

test('every class used in the markup has a style', () => {
    // Classes that are only ever added by JavaScript at runtime, plus the
    // third-party Font Awesome icon classes.
    const RUNTIME = new Set([
        'active', 'dragover', 'fx-off', 'hovering', 'match', 'mismatch',
        'found', 'notfound', 'success', 'error', 'warning', 'info'
    ]);
    const isIcon = (name) => name === 'fas' || name.startsWith('fa-');

    const used = new Set();
    for (const match of html.matchAll(/class="([^"]+)"/g)) {
        match[1].split(/\s+/).filter(Boolean).forEach((name) => used.add(name));
    }

    const missing = [...used].filter((name) =>
        !RUNTIME.has(name) && !isIcon(name) && !cssAll.includes('.' + name)
    );
    assert.deepEqual(missing, [], 'classes without a rule: ' + missing.join(', '));
});

test('each tab panel owns exactly one h1 and a labelled tablist', () => {
    assert.match(html, /role="tablist"/);

    const panels = html.split(/<section id="tab-/).slice(1);
    assert.equal(panels.length, 7, 'seven tab panels');

    panels.forEach((panel) => {
        const heading = (panel.match(/<h1[\s>]/g) || []).length;
        assert.equal(heading, 1, 'one h1 per tab panel');
        assert.match(panel, /role="tabpanel"/);
    });
});

test('interactive controls have accessible names', () => {
    const button = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
    const unnamed = [];
    for (const match of html.matchAll(button)) {
        const attrs = match[1];
        const inner = match[2];
        const text = inner.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').trim();
        const hasLabel = /aria-label=/.test(attrs) || /title=/.test(attrs);
        if (!text && !hasLabel) unnamed.push(attrs.slice(0, 80));
    }
    assert.deepEqual(unnamed, [], 'buttons without a name:\n' + unnamed.join('\n'));
});
