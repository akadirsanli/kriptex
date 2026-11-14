/* ==========================================================================
   tabs/compress-tab.js — streamed zlib compression in a Web Worker.
   Handles multi-megabyte texts without blocking the UI; supports both
   base64 text transport and binary .z file import/export.
   ========================================================================== */
'use strict';

KX.tabs = KX.tabs || {};

KX.tabs.compress = (() => {
    const U = KX.utils;

    const PROFILES = {
        balanced: { level: 6, memLevel: 8, windowBits: 15 },
        max:      { level: 9, memLevel: 9, windowBits: 15 },
        fast:     { level: 1, memLevel: 4, windowBits: 15 }
    };

    /** Inflating more than this from a small payload is treated as an attack. */
    const MAX_OUTPUT = 256 * 1024 * 1024;

    let profile = 'balanced';
    let lastPacked = null; // Uint8Array of the most recent compression

    function setProgress(fraction, label) {
        U.$('cmp-progress').style.display = 'block';
        U.$('cmp-progress-fill').style.width = Math.round(fraction * 100) + '%';
        U.$('cmp-progress-text').textContent = label;
    }

    function clearProgress() {
        U.$('cmp-progress').style.display = 'none';
        U.$('cmp-progress-fill').style.width = '0';
    }

    /** Only fall back to the main thread when the *worker* is unavailable. */
    function isWorkerFailure(err) {
        if (typeof Worker === 'undefined') return true;
        return /worker/i.test(String(err && err.message));
    }

    async function compressBytes(bytes) {
        try {
            return await KX.workers.runCompression('deflate', bytes, PROFILES[profile],
                (f) => setProgress(f, `deflating... ${Math.round(f * 100)}%`));
        } catch (e) {
            if (!isWorkerFailure(e)) throw e;
            return KX.workers.runCompressionFallback('deflate', bytes, PROFILES[profile]);
        }
    }

    async function decompressBytes(bytes) {
        setProgress(0.02, 'inflating...');
        try {
            return await KX.workers.runCompression('inflate', bytes, null,
                (f) => setProgress(f, `inflating... ${Math.round(f * 100)}%`), MAX_OUTPUT);
        } catch (e) {
            if (!isWorkerFailure(e)) throw e;
            return KX.workers.runCompressionFallback('inflate', bytes, null, MAX_OUTPUT);
        }
    }

    function renderStats(stats) {
        U.animateValue(U.$('cmp-stat-original'), stats.originalSize, (v) => U.formatBytes(Math.round(v)));
        U.animateValue(U.$('cmp-stat-compressed'), stats.packedSize, (v) => U.formatBytes(Math.round(v)));
        U.animateValue(U.$('cmp-stat-ratio'), stats.ratio, (v) => v.toFixed(1) + '%');
        U.animateValue(U.$('cmp-stat-time'), stats.ms, (v) => Math.round(v) + ' ms');
        U.animateValue(U.$('cmp-stat-speed'), stats.speed, (v) => v.toFixed(2) + ' MB/s');
        U.animateValue(U.$('cmp-stat-pages'), stats.pages, (v) => '~' + U.formatCount(Math.round(v)));
    }

    async function compressText(text) {
        const t0 = performance.now();
        setProgress(0, 'encoding...');
        const input = U.utf8Encode(text);
        const originalSize = input.length;

        const packed = await compressBytes(input);
        if (originalSize > 0 && packed.length === 0) {
            throw new Error('compression produced no output');
        }
        lastPacked = packed;

        setProgress(1, 'encoding base64...');
        const b64 = U.bufToB64(packed);
        const ms = performance.now() - t0;

        U.$('cmp-output').value = b64;
        U.$('cmp-output-count').textContent = U.formatCount(b64.length);
        renderStats({
            originalSize,
            packedSize: packed.length,
            ratio: originalSize > 0 ? (1 - packed.length / originalSize) * 100 : 0,
            ms,
            speed: (originalSize / 1048576) / Math.max(0.001, ms / 1000),
            pages: Math.max(1, Math.round(text.length / 1800))
        });
        return packed;
    }

    async function decompressToText(b64) {
        const t0 = performance.now();
        setProgress(0, 'decoding base64...');
        const packed = U.b64ToBuf(b64);
        const raw = await decompressBytes(packed);
        setProgress(1, 'decoding utf-8...');
        const text = U.utf8Decode(raw);
        const ms = performance.now() - t0;

        U.$('cmp-output').value = text;
        U.$('cmp-output-count').textContent = U.formatCount(text.length);
        renderStats({
            originalSize: packed.length,
            packedSize: raw.length,
            ratio: 0,
            ms,
            speed: (raw.length / 1048576) / Math.max(0.001, ms / 1000),
            pages: Math.max(1, Math.round(text.length / 1800))
        });
        U.$('cmp-stat-ratio').textContent = 'n/a';
        return text;
    }

    function init() {
        const input = U.$('cmp-input');
        const output = U.$('cmp-output');

        input.addEventListener('input', () => {
            U.$('cmp-input-count').textContent = U.formatCount(input.value.length);
        });

        document.querySelectorAll('#cmp-modes .mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#cmp-modes .mode-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                profile = btn.dataset.mode;
            });
        });

        U.$('compress-btn').addEventListener('click', async () => {
            const text = input.value;
            if (!text) return U.toast('Enter text to compress.', 'warning');
            const btn = U.$('compress-btn');
            btn.disabled = true;
            try {
                await compressText(text);
                U.toast('Compression complete — payload is base64, copy or download.', 'success');
            } catch (err) {
                U.toast('Compression failed: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                clearProgress();
            }
        });

        U.$('decompress-btn').addEventListener('click', async () => {
            const text = input.value.trim();
            if (!text) return U.toast('Paste the base64 payload into the source box.', 'warning');
            try {
                await decompressToText(text);
                U.toast('Payload restored to plain text.', 'success');
            } catch (err) {
                U.toast('Not a valid compressed payload.', 'error');
            } finally {
                clearProgress();
            }
        });

        U.$('cmp-copy-btn').addEventListener('click', () => {
            U.copyText(output.value, 'Payload copied.');
        });

        U.$('cmp-download-btn').addEventListener('click', () => {
            if (!output.value) return;
            U.downloadBlob(
                new Blob([output.value], { type: 'text/plain;charset=utf-8' }),
                U.timestampedName('kriptex-packed', 'b64.txt')
            );
            U.toast('Base64 payload downloaded.', 'success');
        });

        U.$('cmp-download-bin-btn').addEventListener('click', () => {
            if (!lastPacked) return U.toast('Nothing packed yet — compress something first.', 'warning');
            U.downloadBlob(
                new Blob([lastPacked], { type: 'application/octet-stream' }),
                U.timestampedName('kriptex-packed', 'z')
            );
            U.toast('Binary .z container downloaded.', 'success');
        });

        /* .txt → auto-compress → .z download */
        const txtDrop = U.$('cmp-file-drop');
        const txtInput = U.$('cmp-file-input');

        const handleTextFile = async (file) => {
            try {
                const text = await file.text();
                input.value = text;
                U.$('cmp-input-count').textContent = U.formatCount(text.length);
                const packed = await compressText(text);
                U.downloadBlob(new Blob([packed], { type: 'application/octet-stream' }), file.name + '.z');
                U.toast(`${file.name} compressed → ${file.name}.z`, 'success');
            } catch (err) {
                U.toast('File compression failed: ' + err.message, 'error');
            } finally {
                clearProgress();
            }
        };

        /* .z / .b64 → auto-decompress → show + offer .txt */
        const zDrop = U.$('dcmp-file-drop');
        const zInput = U.$('dcmp-file-input');

        const handlePackedFile = async (file) => {
            try {
                let packed;
                if (/\.(z|zz|zlib)$/i.test(file.name)) {
                    packed = new Uint8Array(await file.arrayBuffer());
                } else {
                    packed = U.b64ToBuf(await file.text());
                }
                const raw = await decompressBytes(packed);
                const text = U.utf8Decode(raw);
                output.value = text;
                U.$('cmp-output-count').textContent = U.formatCount(text.length);
                U.animateValue(U.$('cmp-stat-pages'), Math.max(1, Math.round(text.length / 1800)),
                    (v) => '~' + U.formatCount(Math.round(v)));
                U.downloadBlob(
                    new Blob([text], { type: 'text/plain;charset=utf-8' }),
                    file.name.replace(/\.(z|zz|zlib|b64|txt)$/i, '') + '.restored.txt'
                );
                U.toast(`${file.name} restored and downloaded as .txt`, 'success');
            } catch (err) {
                U.toast('Could not decompress that file.', 'error');
            } finally {
                clearProgress();
            }
        };

        const wireDrop = (zone, fileInput, handler) => {
            zone.addEventListener('click', () => fileInput.click());
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('dragover');
                if (e.dataTransfer.files.length) handler(e.dataTransfer.files[0]);
            });
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length) handler(e.target.files[0]);
                fileInput.value = '';
            });
        };

        wireDrop(txtDrop, txtInput, handleTextFile);
        wireDrop(zDrop, zInput, handlePackedFile);

        /* double-click the source box to paste from clipboard */
        input.addEventListener('dblclick', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    input.value = text;
                    U.$('cmp-input-count').textContent = U.formatCount(text.length);
                    U.toast(`Pasted ${U.formatCount(text.length)} chars from clipboard.`, 'info');
                }
            } catch (e) { /* clipboard permission denied — ignore */ }
        });
    }

    return { init };
})();
