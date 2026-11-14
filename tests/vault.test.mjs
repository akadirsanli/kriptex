import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './harness.mjs';

const MASTER = 'correct horse battery staple';
const STORAGE_KEY = 'kriptex.vault.v1';

test('vault lifecycle: create, persist, lock, unlock', async () => {
    const { KX } = createApp();
    const V = KX.vault;

    await V.create(MASTER);
    assert.equal(V.exists(), true);
    assert.equal(V.isUnlocked(), true);

    const meta = V.getMeta();
    assert.equal(meta.notesCount, 0);
    assert.equal(meta.iterations, 600000);

    V.addNote('first', 'secret body');
    await V.persist();
    assert.equal(V.getMeta().notesCount, 1);

    V.lock();
    assert.equal(V.isUnlocked(), false);

    assert.equal(await V.unlock('wrong-passphrase'), false);
    assert.equal(V.isUnlocked(), false, 'a failed unlock must not leave a key behind');

    assert.equal(await V.unlock(MASTER), true);
    assert.equal(V.getNotes().length, 1);
    assert.equal(V.getNotes()[0].body, 'secret body');
});

test('a passphrase shorter than the minimum is rejected', async () => {
    const { KX } = createApp();
    await assert.rejects(() => KX.vault.create('short'), /at least 8/);
});

test('the exported backup contains ciphertext only and can be restored', async () => {
    const app = createApp();
    const V = app.KX.vault;
    await V.create(MASTER);
    V.addNote('bank', 'top secret note body');
    await V.persist();

    const backup = V.exportBlob();
    assert.ok(backup.includes('kdf'), 'backup is the sealed store');
    assert.ok(!backup.includes('top secret note body'), 'plaintext must never leave the vault');

    const restoredApp = createApp();
    const restored = restoredApp.KX.vault;
    await restored.importBlob(backup, { replace: true });
    assert.equal(restored.isUnlocked(), false, 'importing must not unlock');
    assert.equal(await restored.unlock(MASTER), true);
    assert.equal(restored.getNotes()[0].body, 'top secret note body');
});

test('importing an arbitrary JSON file is refused', async () => {
    const { KX } = createApp();
    await assert.rejects(() => KX.vault.importBlob('{"hello":"world"}'), /not a KRIPTEX vault backup/i);
    await assert.rejects(() => KX.vault.importBlob('not json at all'), /not a KRIPTEX vault backup/i);
});

test('writing while locked fails instead of silently dropping data', async () => {
    const { KX } = createApp();
    await KX.vault.create(MASTER);
    KX.vault.lock();
    await assert.rejects(() => KX.vault.persist(), /locked/);
});

test('a storage failure surfaces as a clear error', async () => {
    const app = createApp();
    const V = app.KX.vault;
    await V.create(MASTER);
    V.addNote('doomed', 'x');

    const original = app.context.localStorage.setItem;
    app.context.localStorage.setItem = () => {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
    };
    await assert.rejects(() => V.persist(), /storage is full or disabled/i);
    app.context.localStorage.setItem = original;
});

test('an unreadable vault blob is reported, not guessed at', async () => {
    const app = createApp();
    await app.KX.vault.create(MASTER);
    app.context.localStorage.setItem(STORAGE_KEY, '{"v":1,"kdf":null}');
    await assert.rejects(() => app.KX.vault.unlock(MASTER), /No readable vault/);
});

test('re-keying replaces the salt and invalidates the old passphrase', async () => {
    const { KX } = createApp();
    const V = KX.vault;
    await V.create(MASTER);
    V.addNote('note', 'body');
    await V.persist();
    const saltBefore = JSON.parse(KX.vault.exportBlob()).kdf.salt;

    assert.equal(await V.changePassphrase('wrong-old-pass', 'new-passphrase-42'), false);
    assert.equal(await V.changePassphrase(MASTER, 'new-passphrase-42'), true);

    const saltAfter = JSON.parse(KX.vault.exportBlob()).kdf.salt;
    assert.notEqual(saltBefore, saltAfter);

    V.lock();
    assert.equal(await V.unlock(MASTER), false);
    assert.equal(await V.unlock('new-passphrase-42'), true);
    assert.equal(V.getNotes()[0].body, 'body');
});

test('another tab rewriting the vault triggers the external-change hook', async () => {
    const app = createApp();
    const V = app.KX.vault;
    await V.create(MASTER);

    let fired = 0;
    V.onExternalChange(() => { fired++; });
    app.context.dispatchStorage(STORAGE_KEY);
    assert.equal(fired, 1);

    app.context.dispatchStorage('some.other.key');
    assert.equal(fired, 1, 'unrelated keys are ignored');

    V.lock();
    app.context.dispatchStorage(STORAGE_KEY);
    assert.equal(fired, 1, 'a locked vault has nothing to protect');
});
