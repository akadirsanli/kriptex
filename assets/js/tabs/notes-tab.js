/* ==========================================================================
   tabs/notes-tab.js — encrypted notes UI on top of core/vault.
   The vault key never touches the DOM or storage; plaintext exists only
   while the session is unlocked and is wiped from the DOM on every lock
   path (manual, idle timeout, external change, wipe).
   ========================================================================== */
'use strict';

KX.tabs = KX.tabs || {};

KX.tabs.notes = (() => {
    const U = KX.utils;
    const V = KX.vault;

    const LOCKED_FIELDS = [
        'vault-pass', 'vault-setup-pass', 'vault-setup-pass2',
        'rekey-current', 'rekey-new', 'rekey-confirm'
    ];

    let activeNoteId = null;
    let timerInterval = null;
    let saveTimer = null;
    let activityBound = false;

    /* ---------- view switching ---------- */

    function showGate() {
        U.$('vault-gate').style.display = 'block';
        U.$('vault-app').style.display = 'none';
        const hasVault = V.exists();
        U.$('vault-setup').style.display = hasVault ? 'none' : 'block';
        U.$('vault-unlock').style.display = hasVault ? 'block' : 'none';
        U.$('vault-rekey').style.display = 'none';

        if (hasVault) {
            const meta = V.getMeta();
            if (!meta) {
                U.$('vault-meta').textContent = 'vault data is unreadable — restore a backup or wipe it.';
                return;
            }
            U.$('vault-meta').innerHTML =
                `vault created: ${new Date(meta.createdAt).toLocaleString()}<br>` +
                `notes stored: ${meta.notesCount} &middot; kdf iterations: ${U.formatCount(meta.iterations)}`;
        }
    }

    function showApp() {
        U.$('vault-gate').style.display = 'none';
        U.$('vault-app').style.display = 'block';
        resetEditor();
        renderNoteList();
        startAutoLockUI();
    }

    function resetEditor() {
        activeNoteId = null;
        U.$('note-editor').style.display = 'none';
        U.$('note-empty').style.display = 'flex';
        U.$('note-title').value = '';
        U.$('note-body').value = '';
        U.$('note-search').value = '';
        U.$('note-status').textContent = '—';
    }

    /** Single lock path: wipe the key, the in-memory notes and the DOM. */
    function lockUI(message) {
        clearTimeout(saveTimer);
        saveTimer = null;
        V.lock();
        V.disarmAutoLock();
        stopAutoLockUI();
        resetEditor();
        U.clearFields(LOCKED_FIELDS);
        if (message) U.toast(message, 'info');
        showGate();
    }

    /* ---------- gate handlers ---------- */

    async function handleCreate() {
        const p1 = U.$('vault-setup-pass').value;
        const p2 = U.$('vault-setup-pass2').value;
        if (p1.length < V.MIN_PASSPHRASE) {
            return U.toast(`Master passphrase needs at least ${V.MIN_PASSPHRASE} characters.`, 'warning');
        }
        if (p1 !== p2) return U.toast('Passphrases do not match.', 'error');

        const btn = U.$('vault-create-btn');
        btn.disabled = true;
        btn.textContent = '[ deriving key... ]';
        try {
            await V.create(p1);
            U.clearFields(['vault-setup-pass', 'vault-setup-pass2']);
            U.toast('Vault created and unlocked. Export a backup — it lives only in this browser.', 'success');
            showApp();
        } catch (err) {
            U.toast('Vault creation failed: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '[ create_vault ]';
        }
    }

    async function handleUnlock() {
        const pass = U.$('vault-pass').value;
        if (!pass) return U.toast('Enter your master passphrase.', 'warning');

        const btn = U.$('vault-unlock-btn');
        btn.disabled = true;
        btn.textContent = '[ deriving key... ]';
        try {
            const ok = await V.unlock(pass);
            U.clearFields(['vault-pass']);
            if (!ok) return U.toast('Wrong passphrase — vault stays locked.', 'error');
            if (V.needsUpgrade()) {
                U.toast('Vault unlocked. This vault uses an older work factor — consider re-keying.', 'warning');
            } else {
                U.toast('Vault unlocked. Session auto-locks after 5 min idle.', 'success');
            }
            showApp();
        } catch (err) {
            U.toast('Unlock failed: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '[ unlock ]';
        }
    }

    /* ---------- auto-lock UI ---------- */

    function startAutoLockUI() {
        V.armAutoLock(() => lockUI('Session expired — vault auto-locked, key and plaintext wiped.'));

        if (!activityBound) {
            activityBound = true;
            const resetOnActivity = () => V.touch();
            ['click', 'keydown', 'touchstart'].forEach((evt) =>
                document.addEventListener(evt, resetOnActivity, { passive: true }));
        }

        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (!V.isUnlocked()) return;
            const s = V.secondsUntilLock();
            const mm = String(Math.floor(s / 60)).padStart(2, '0');
            const ss = String(s % 60).padStart(2, '0');
            U.$('vault-autolock-timer').textContent = `${mm}:${ss}`;
        }, 1000);
    }

    function stopAutoLockUI() {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }

    function handleLock() {
        lockUI('Vault locked. Key and plaintext wiped from memory.');
    }

    /* ---------- notes CRUD ---------- */

    function renderNoteList(filter = '') {
        const list = U.$('note-list');
        const notes = V.getNotes()
            .filter((n) => !filter || n.title.toLowerCase().includes(filter) || n.body.toLowerCase().includes(filter));

        if (!notes.length) {
            list.innerHTML = '<div class="note-list-empty">no notes yet — create one</div>';
            return;
        }

        list.replaceChildren(...notes.map((note) => {
            const el = document.createElement('div');
            el.className = 'note-item' + (note.id === activeNoteId ? ' active' : '');
            el.tabIndex = 0;
            el.setAttribute('role', 'button');
            const title = document.createElement('span');
            title.className = 'note-item-title';
            title.textContent = note.title;
            const date = document.createElement('span');
            date.className = 'note-item-date';
            date.textContent = new Date(note.updatedAt).toLocaleString();
            el.append(title, date);
            el.addEventListener('click', () => openNote(note.id));
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openNote(note.id);
                }
            });
            return el;
        }));
    }

    function openNote(id) {
        const note = V.getNotes().find((n) => n.id === id);
        if (!note) return;
        activeNoteId = id;
        U.$('note-empty').style.display = 'none';
        U.$('note-editor').style.display = 'flex';
        U.$('note-title').value = note.title;
        U.$('note-body').value = note.body;
        U.$('note-status').textContent = 'last saved: ' + new Date(note.updatedAt).toLocaleString();
        renderNoteList(U.$('note-search').value.toLowerCase());
    }

    async function handleNew() {
        try {
            const note = V.addNote('untitled', '');
            await V.persist();
            renderNoteList();
            openNote(note.id);
            U.$('note-title').focus();
        } catch (err) {
            U.toast('Could not create the note: ' + err.message, 'error');
        }
    }

    async function handleSave() {
        if (!activeNoteId) return;
        try {
            V.updateNote(activeNoteId, U.$('note-title').value.trim(), U.$('note-body').value);
            await V.persist();
            U.$('note-status').textContent = 'encrypted + saved: ' + new Date().toLocaleTimeString();
            renderNoteList(U.$('note-search').value.toLowerCase());
            U.toast('Note sealed into the vault blob.', 'success');
        } catch (err) {
            U.toast('Save failed: ' + err.message, 'error');
        }
    }

    async function handleDelete() {
        if (!activeNoteId) return;
        const ok = await U.confirmAction({
            title: 'Delete this note?',
            body: 'The note is removed from the vault and the blob is re-sealed. This cannot be undone.',
            confirmLabel: 'Delete note'
        });
        if (!ok) return;
        try {
            V.deleteNote(activeNoteId);
            await V.persist();
            resetEditor();
            renderNoteList();
            U.toast('Note deleted and vault re-encrypted.', 'info');
        } catch (err) {
            U.toast('Delete failed: ' + err.message, 'error');
        }
    }

    /* ---------- backup ---------- */

    function handleExport() {
        try {
            const json = V.exportBlob();
            U.downloadBlob(new Blob([json], { type: 'application/json' }),
                U.timestampedName('kriptex-vault-backup', 'json'));
            U.toast('Encrypted backup exported — keep it somewhere safe.', 'success');
        } catch (err) {
            U.toast('Export failed: ' + err.message, 'error');
        }
    }

    async function handleImportFile(file) {
        if (!file) return;
        try {
            const text = await file.text();
            if (V.exists()) {
                const replace = await U.confirmAction({
                    title: 'Replace the current vault?',
                    body: 'A vault already exists in this browser. Restoring the backup overwrites it, and the current notes are lost unless you exported them.',
                    confirmLabel: 'Replace vault'
                });
                if (!replace) return;
            }
            const meta = await V.importBlob(text, { replace: true });
            lockUI();
            U.toast(`Backup restored (${meta.notesCount} notes). Unlock it with its master passphrase.`, 'success');
        } catch (err) {
            U.toast('Import failed: ' + err.message, 'error');
        } finally {
            U.$('vault-import-input').value = '';
        }
    }

    /* ---------- danger zone ---------- */

    function openRekey() {
        U.$('vault-rekey').style.display = 'block';
        U.$('rekey-current').focus();
    }

    async function handleRekey() {
        const current = U.$('rekey-current').value;
        const next = U.$('rekey-new').value;
        const confirmNext = U.$('rekey-confirm').value;
        if (!current) return U.toast('Enter the current master passphrase.', 'warning');
        if (next.length < V.MIN_PASSPHRASE) {
            return U.toast(`New passphrase needs at least ${V.MIN_PASSPHRASE} characters.`, 'warning');
        }
        if (next !== confirmNext) return U.toast('New passphrases do not match.', 'error');

        const btn = U.$('rekey-save');
        btn.disabled = true;
        try {
            const ok = await V.changePassphrase(current, next);
            if (!ok) return U.toast('Current passphrase wrong — unchanged.', 'error');
            U.clearFields(['rekey-current', 'rekey-new', 'rekey-confirm']);
            U.$('vault-rekey').style.display = 'none';
            U.toast('Vault re-keyed with a fresh salt. Export a new backup.', 'success');
        } catch (err) {
            U.toast('Re-key failed: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async function handleWipe() {
        const first = await U.confirmAction({
            title: 'Wipe the entire vault?',
            body: 'Every encrypted note in this browser is destroyed. There is no undo and no recovery without a backup.',
            confirmLabel: 'Wipe vault'
        });
        if (!first) return;
        V.wipe();
        lockUI();
        U.toast('Vault wiped from localStorage.', 'warning');
    }

    function init() {
        U.$('vault-create-btn').addEventListener('click', handleCreate);
        U.$('vault-unlock-btn').addEventListener('click', handleUnlock);
        U.$('vault-pass').addEventListener('keypress', (e) => { if (e.key === 'Enter') handleUnlock(); });
        U.$('vault-setup-pass2').addEventListener('keypress', (e) => { if (e.key === 'Enter') handleCreate(); });

        U.$('vault-setup-pass').addEventListener('input', (e) => {
            U.renderStrength(U.$('vault-strength-bar'), U.$('vault-strength-text'), e.target.value);
        });

        U.$('vault-lock-btn').addEventListener('click', handleLock);
        U.$('note-new-btn').addEventListener('click', handleNew);
        U.$('note-save-btn').addEventListener('click', handleSave);
        U.$('note-delete-btn').addEventListener('click', handleDelete);
        U.$('vault-change-pass-btn').addEventListener('click', openRekey);
        U.$('rekey-cancel').addEventListener('click', () => {
            U.clearFields(['rekey-current', 'rekey-new', 'rekey-confirm']);
            U.$('vault-rekey').style.display = 'none';
        });
        U.$('rekey-save').addEventListener('click', handleRekey);
        U.$('rekey-new').addEventListener('input', (e) => {
            U.renderStrength(U.$('rekey-strength-bar'), U.$('rekey-strength-text'), e.target.value);
        });
        U.$('vault-export-btn').addEventListener('click', handleExport);
        ['vault-import-btn', 'vault-import-btn2'].forEach((id) => {
            const btn = U.$(id);
            if (btn) btn.addEventListener('click', () => U.$('vault-import-input').click());
        });
        U.$('vault-import-input').addEventListener('change', (e) => {
            if (e.target.files.length) handleImportFile(e.target.files[0]);
        });
        U.$('vault-wipe-btn').addEventListener('click', handleWipe);

        U.$('note-search').addEventListener('input', (e) => {
            renderNoteList(e.target.value.toLowerCase());
        });

        // auto-save while typing (debounced)
        const autoSave = () => {
            if (!activeNoteId || !V.isUnlocked()) return;
            clearTimeout(saveTimer);
            saveTimer = setTimeout(async () => {
                try {
                    V.updateNote(activeNoteId, U.$('note-title').value.trim(), U.$('note-body').value);
                    await V.persist();
                    U.$('note-status').textContent = 'auto-saved: ' + new Date().toLocaleTimeString();
                } catch (err) {
                    U.toast('Auto-save failed: ' + err.message, 'error');
                }
            }, 1200);
        };
        U.$('note-title').addEventListener('input', autoSave);
        U.$('note-body').addEventListener('input', autoSave);

        V.onExternalChange(() => {
            lockUI('Vault changed in another tab — locked here to avoid overwriting it.');
        });

        showGate();
    }

    return { init, showGate };
})();
