/* ==========================================================================
   core/vault.js — encrypted notes vault on top of localStorage

   Storage layout (single key, everything sensitive is ciphertext):
     kriptex.vault.v1 = {
       v: 1,
       kdf:    { iterations, salt(b64) },
       verify: { iv(b64), data(b64) },   // AES-GCM(sentinel) — password check
       notes:  { iv(b64), data(b64) },   // AES-GCM(JSON notes[])
       notesCount, createdAt, updatedAt  // non-sensitive metadata
     }

   The passphrase is never stored — verification decrypts a known sentinel.
   The derived key lives only in this module's closure while unlocked.

   Durability notes
   ----------------
   * Writes are guarded by the Web Locks API so two tabs cannot clobber each
     other, and storage failures (quota, private mode) surface as errors
     instead of silently dropping a note.
   * An external change (another tab wrote the vault) is reported through
     onExternalChange() so the UI can lock rather than overwrite it.
   * exportBlob()/importBlob() move the *sealed* blob only — no plaintext and
     no key ever leaves the page.
   ========================================================================== */
'use strict';

KX.vault = (() => {
    const U = KX.utils;

    const STORAGE_KEY = 'kriptex.vault.v1';
    const SENTINEL = 'kriptex::vault-sentinel::v1';
    const KDF_ITERATIONS = 600000;
    const MIN_ITERATIONS = 100000;
    const MAX_ITERATIONS = 4000000;
    const SALT_SIZE = 16;
    const IV_SIZE = 12;
    const MIN_PASSPHRASE = 8;

    let sessionKey = null;
    let sessionNotes = [];
    let lockTimer = null;
    let lockCallback = null;
    let deadline = 0;
    let externalHandler = null;

    const exists = () => localStorage.getItem(STORAGE_KEY) !== null;
    const isUnlocked = () => sessionKey !== null;

    function readStore() {
        let raw;
        try {
            raw = localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null;
        }
        if (!raw) return null;
        try {
            const store = JSON.parse(raw);
            return isValidStore(store) ? store : null;
        } catch (e) {
            return null;
        }
    }

    function isValidStore(store) {
        return !!(store && typeof store === 'object' &&
            store.kdf && typeof store.kdf.iterations === 'number' && typeof store.kdf.salt === 'string' &&
            store.verify && typeof store.verify.iv === 'string' && typeof store.verify.data === 'string' &&
            store.notes && typeof store.notes.iv === 'string' && typeof store.notes.data === 'string');
    }

    function writeStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch (e) {
            throw new Error('Could not save the vault — browser storage is full or disabled. Export your vault, then free some space.');
        }
    }

    /** Serialise vault writes across tabs (no-op where Web Locks is unavailable). */
    async function withLock(fn) {
        if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
            return navigator.locks.request('kriptex.vault', fn);
        }
        return fn();
    }

    function getMeta() {
        const store = readStore();
        if (!store) return null;
        return {
            notesCount: store.notesCount || 0,
            createdAt: store.createdAt,
            updatedAt: store.updatedAt,
            iterations: store.kdf.iterations
        };
    }

    async function sealJSON(key, obj) {
        const iv = U.randomBytes(IV_SIZE);
        const buf = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, tagLength: 128 }, key, U.utf8Encode(JSON.stringify(obj))
        );
        return { iv: U.bufToB64(iv), data: U.bufToB64(new Uint8Array(buf)) };
    }

    async function openJSON(key, sealed) {
        const buf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: U.b64ToBuf(sealed.iv), tagLength: 128 }, key, U.b64ToBuf(sealed.data)
        );
        return JSON.parse(U.utf8Decode(new Uint8Array(buf)));
    }

    function assertPassphrase(passphrase) {
        if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) {
            throw new Error('Master passphrase must be at least ' + MIN_PASSPHRASE + ' characters.');
        }
    }

    /** Create a fresh vault. Throws if one already exists. */
    async function create(passphrase) {
        if (exists()) throw new Error('Vault already exists');
        assertPassphrase(passphrase);
        const salt = U.randomBytes(SALT_SIZE);
        const key = await KX.crypto.deriveKey(passphrase, salt, KDF_ITERATIONS, 256);
        const store = {
            v: 1,
            kdf: { iterations: KDF_ITERATIONS, salt: U.bufToB64(salt) },
            verify: await sealJSON(key, SENTINEL),
            notes: await sealJSON(key, []),
            notesCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        writeStore(store);
        sessionKey = key;
        sessionNotes = [];
    }

    /** Unlock with a passphrase. Resolves false on wrong passphrase. */
    async function unlock(passphrase) {
        const store = readStore();
        if (!store) throw new Error('No readable vault on this device');
        const iterations = store.kdf.iterations;
        if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
            throw new Error('Vault KDF parameters are out of range — refusing to derive a key.');
        }
        const key = await KX.crypto.deriveKey(passphrase, U.b64ToBuf(store.kdf.salt), iterations, 256);
        let sentinel;
        try {
            sentinel = await openJSON(key, store.verify);
        } catch (e) {
            return false; // GCM tag mismatch → wrong passphrase
        }
        if (sentinel !== SENTINEL) return false;

        sessionKey = key;
        sessionNotes = await openJSON(key, store.notes);
        if (!Array.isArray(sessionNotes)) sessionNotes = [];
        return true;
    }

    /** True when the vault was sealed with an older (weaker) work factor. */
    function needsUpgrade() {
        const store = readStore();
        return !!(store && store.kdf.iterations < KDF_ITERATIONS);
    }

    /** Encrypt and persist the in-memory notes array. */
    async function persist() {
        return withLock(async () => {
            if (!sessionKey) throw new Error('Vault is locked');
            const store = readStore();
            if (!store) throw new Error('Vault disappeared from storage — export or re-create it.');
            store.notes = await sealJSON(sessionKey, sessionNotes);
            store.notesCount = sessionNotes.length;
            store.updatedAt = Date.now();
            writeStore(store);
        });
    }

    /** Re-key the vault to a new passphrase (fresh salt). */
    async function changePassphrase(current, next) {
        if (!sessionKey) throw new Error('Vault is locked');
        assertPassphrase(next);
        return withLock(async () => {
            const store = readStore();
            if (!store) throw new Error('No vault on this device');
            const oldKey = await KX.crypto.deriveKey(
                current, U.b64ToBuf(store.kdf.salt), store.kdf.iterations, 256
            );
            const sentinel = await openJSON(oldKey, store.verify).catch(() => null);
            if (sentinel !== SENTINEL) return false;

            const salt = U.randomBytes(SALT_SIZE);
            const newKey = await KX.crypto.deriveKey(next, salt, KDF_ITERATIONS, 256);
            store.kdf = { iterations: KDF_ITERATIONS, salt: U.bufToB64(salt) };
            store.verify = await sealJSON(newKey, SENTINEL);
            store.notes = await sealJSON(newKey, sessionNotes);
            store.updatedAt = Date.now();
            writeStore(store);
            sessionKey = newKey;
            return true;
        });
    }

    /** Serialise the sealed vault for backup. Contains ciphertext only. */
    function exportBlob() {
        const store = readStore();
        if (!store) throw new Error('Nothing to export — no vault on this device.');
        return JSON.stringify(store, null, 2);
    }

    /** Restore a sealed vault from a backup produced by exportBlob(). */
    async function importBlob(text, options) {
        const replace = !!(options && options.replace);
        let store;
        try {
            store = JSON.parse(String(text));
        } catch (e) {
            throw new Error('That file is not a KRIPTEX vault backup (invalid JSON).');
        }
        if (!isValidStore(store)) {
            throw new Error('That file is not a KRIPTEX vault backup (unexpected structure).');
        }
        if (exists() && !replace) throw new Error('A vault already exists — wipe it first.');
        writeStore(store);
        lock();
        return getMeta();
    }

    /** Called when another tab rewrites the vault blob. */
    function onExternalChange(handler) {
        externalHandler = handler;
        window.addEventListener('storage', (event) => {
            if (event.key !== STORAGE_KEY) return;
            if (!externalHandler) return;
            if (!sessionKey) return;
            externalHandler();
        });
    }

    function wipe() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) { /* nothing else we can do */ }
        lock();
    }

    /** Destroy the session — key and plaintext leave memory. */
    function lock() {
        sessionKey = null;
        sessionNotes = [];
        deadline = 0;
        if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
    }

    /* ---------- notes CRUD (in-memory; call persist() to save) ---------- */

    const getNotes = () => sessionNotes.slice();

    function addNote(title, body) {
        const note = {
            id: U.bytesToHex(U.randomBytes(8)),
            title: title || 'untitled',
            body: body || '',
            updatedAt: Date.now()
        };
        sessionNotes.unshift(note);
        return note;
    }

    function updateNote(id, title, body) {
        const note = sessionNotes.find((n) => n.id === id);
        if (!note) return null;
        note.title = title || 'untitled';
        note.body = body;
        note.updatedAt = Date.now();
        return note;
    }

    function deleteNote(id) {
        sessionNotes = sessionNotes.filter((n) => n.id !== id);
    }

    /* ---------- auto-lock ---------- */

    const AUTOLOCK_MS = 5 * 60 * 1000;

    function armAutoLock(onLock) {
        lockCallback = onLock;
        touch();
        if (lockTimer) clearInterval(lockTimer);
        lockTimer = setInterval(() => {
            if (!sessionKey) return;
            if (Date.now() >= deadline) {
                lock();
                if (lockCallback) lockCallback();
            }
        }, 1000);
    }

    function disarmAutoLock() {
        if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
        deadline = 0;
    }

    function touch() {
        if (!sessionKey) return;
        deadline = Date.now() + AUTOLOCK_MS;
    }

    function secondsUntilLock() {
        return Math.max(0, Math.round((deadline - Date.now()) / 1000));
    }

    return {
        exists, isUnlocked, getMeta, needsUpgrade,
        create, unlock, persist, changePassphrase, wipe, lock,
        exportBlob, importBlob, onExternalChange,
        getNotes, addNote, updateNote, deleteNote,
        armAutoLock, disarmAutoLock, touch, secondsUntilLock,
        KDF_ITERATIONS, MIN_PASSPHRASE
    };
})();
