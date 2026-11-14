/* ==========================================================================
   test/harness.mjs â€” loads the browser modules into a VM context so the
   crypto and vault cores can be tested with node:test (no bundler, no jsdom).

   Only the parts the core modules touch are stubbed: localStorage, a minimal
   document, navigator and the storage event target.  Everything else is the
   real thing (WebCrypto from Node, the vendored pako/CryptoJS builds).
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp() {
    const store = new Map();
    const storageListeners = [];

    const localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(String(key), String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => store.clear(),
        key: (index) => Array.from(store.keys())[index] ?? null,
        get length() { return store.size; }
    };

    const noop = () => {};
    const element = () => ({
        style: {},
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        setAttribute: noop,
        append: noop,
        appendChild: noop,
        replaceChildren: noop,
        addEventListener: noop,
        remove: noop,
        focus: noop,
        querySelector: () => null,
        textContent: '',
        value: '',
        hidden: false
    });

    const document = {
        readyState: 'complete',
        body: { classList: { contains: () => false }, appendChild: noop },
        getElementById: () => null,
        querySelectorAll: () => [],
        createElement: element,
        addEventListener: noop
    };

    const context = {
        console,
        crypto: webcrypto,
        performance: { now: () => Date.now() },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        queueMicrotask,
        TextEncoder,
        TextDecoder,
        Blob,
        URL,
        AbortController,
        DOMException,
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        structuredClone,
        document,
        localStorage,
        navigator: { clipboard: null },
        isSecureContext: true,
        matchMedia: () => ({ matches: false }),
        addEventListener: (type, fn) => { if (type === 'storage') storageListeners.push(fn); },
        removeEventListener: noop,
        dispatchStorage: (key) => storageListeners.forEach((fn) => fn({ key }))
    };

    vm.createContext(context);
    // In a browser `window` is the global object; mirror that so `window.KX`
    // and bare `KX` refer to the same binding.
    vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', context);

    const load = (rel) => {
        const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        vm.runInContext(code, context, { filename: rel });
    };

    load('assets/vendor/pako.min.js');
    load('assets/vendor/crypto-js.min.js');
    load('assets/js/core/utils.js');
    load('assets/js/core/wordlist.js');
    load('assets/js/core/crypto-engine.js');
    load('assets/js/core/vault.js');
    load('assets/js/tabs/generator-tab.js');

    /* Copy host-realm bytes into the VM realm. CryptoJS checks
       `x instanceof ArrayBuffer`, which is realm-sensitive, so tests that feed
       it data must hand it a buffer created inside the context. */
    const toRealm = vm.runInContext(
        '(bytes) => { const copy = new Uint8Array(bytes.length); copy.set(bytes); return copy; }',
        context
    );

    return { context, KX: context.KX, store, storageListeners, toRealm };
}

/** Read a fixture produced by scripts/make-fixtures.mjs. */
export function fixture(name) {
    return fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name));
}
