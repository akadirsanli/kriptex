/* ==========================================================================
   tabs/file-tab.js — file sealing / opening (.krx container)
   ========================================================================== */
'use strict';

KX.tabs = KX.tabs || {};

KX.tabs.file = (() => {
    const U = KX.utils;

    /** Verifying larger files doubles peak memory, so cap the self-check. */
    const VERIFY_MAX_BYTES = 64 * 1024 * 1024;

    let selectedFile = null;

    function showProgress(text) {
        U.$('file-progress').style.display = 'block';
        U.$('progress-text').textContent = text;
    }

    function hideProgress() {
        U.$('file-progress').style.display = 'none';
    }

    function bytesEqual(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    function init() {
        const dropZone = U.$('drop-zone');
        const fileInput = U.$('file-input');
        const pass = U.$('file-password');
        const pass2 = U.$('file-password2');

        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) pickFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) pickFile(e.target.files[0]);
        });

        function pickFile(file) {
            selectedFile = file;
            U.$('file-name').textContent = file.name;
            U.$('file-size').textContent = U.formatBytes(file.size);
            U.$('file-info').style.display = 'block';
            U.toast(`Loaded ${file.name} (${U.formatBytes(file.size)})`, 'info');
        }

        U.$('clear-file').addEventListener('click', () => {
            selectedFile = null;
            fileInput.value = '';
            U.$('file-info').style.display = 'none';
        });

        U.$('toggle-file-pass').addEventListener('click', function () {
            const show = pass.type === 'password';
            pass.type = show ? 'text' : 'password';
            pass2.type = show ? 'text' : 'password';
            this.innerHTML = `<i class="fas ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
        });

        U.$('file-encrypt-btn').addEventListener('click', async () => {
            if (!selectedFile) return U.toast('Select a file first.', 'warning');
            if (!pass.value) return U.toast('Set a file passphrase.', 'warning');
            if (pass.value !== pass2.value) return U.toast('Passphrases do not match.', 'error');

            const btn = U.$('file-encrypt-btn');
            btn.disabled = true;
            try {
                showProgress('reading file...');
                const buffer = await selectedFile.arrayBuffer();
                showProgress('deriving key and sealing file...');
                const sealed = await KX.crypto.sealFile(buffer, pass.value, selectedFile.name);

                let verified = false;
                if (buffer.byteLength <= VERIFY_MAX_BYTES) {
                    showProgress('verifying container...');
                    const sealedBytes = new Uint8Array(await sealed.blob.arrayBuffer());
                    const opened = await KX.crypto.openFile(sealedBytes, pass.value, sealed.filename);
                    verified = bytesEqual(new Uint8Array(await opened.blob.arrayBuffer()), new Uint8Array(buffer));
                    if (!verified) throw new Error('container failed its round-trip check');
                }

                U.downloadBlob(sealed.blob, sealed.filename);
                U.toast(
                    `Sealed ${sealed.meta.name} → ${sealed.filename}` +
                    (verified ? ' · verified' : ' · verification skipped (large file)'),
                    'success'
                );
            } catch (err) {
                U.toast('Sealing failed: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                hideProgress();
            }
        });

        U.$('file-decrypt-btn').addEventListener('click', async () => {
            if (!selectedFile) return U.toast('Select a .krx file first.', 'warning');
            if (!pass.value) return U.toast('Enter the file passphrase.', 'warning');

            const btn = U.$('file-decrypt-btn');
            btn.disabled = true;
            try {
                showProgress('reading container...');
                const buffer = await selectedFile.arrayBuffer();
                showProgress('deriving key and opening container...');
                const opened = await KX.crypto.openFile(buffer, pass.value, selectedFile.name);
                U.downloadBlob(opened.blob, opened.filename);
                U.toast(`Restored ${opened.filename} (${U.formatBytes(opened.meta.size)}) in ${opened.stats.time} ms.`, 'success');
            } catch (err) {
                U.toast('Open failed — wrong passphrase or corrupted container.', 'error');
            } finally {
                btn.disabled = false;
                hideProgress();
            }
        });
    }

    return { init };
})();
