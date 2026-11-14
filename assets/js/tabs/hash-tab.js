/* ==========================================================================
   tabs/hash-tab.js — digest tools: text/file hashing, comparison,
   algorithm detection and dictionary-based recovery (Web Worker).
   ========================================================================== */
'use strict';

KX.tabs = KX.tabs || {};

KX.tabs.hash = (() => {
    const U = KX.utils;

    /* Small built-in list of extremely common passwords. A serious audit
       should always pair the tool with a real wordlist. */
    const COMMON_PASSWORDS = [
        '123456', 'password', '12345678', 'qwerty', '123456789', '12345', '1234',
        '111111', '1234567', 'dragon', '123123', 'baseball', 'abc123', 'football',
        'monkey', 'letmein', '696969', 'shadow', 'master', '666666', 'qwertyuiop',
        '123321', 'mustang', '1234567890', 'michael', '654321', 'superman', '1qaz2wsx',
        '7777777', '121212', '000000', 'qazwsx', '123qwe', 'killer', 'trustno1',
        'jordan', 'jennifer', 'zxcvbnm', 'asdfgh', 'hunter', 'buster', 'soccer',
        'harley', 'batman', 'andrew', 'tigger', 'sunshine', 'iloveyou', '2000',
        'charlie', 'robert', 'thomas', 'hockey', 'ranger', 'daniel', 'starwars',
        'klaster', '112233', 'george', 'computer', 'michelle', 'jessica', 'pepper',
        '1111', 'zxcvbn', '555555', '11111111', '131313', 'freedom', '777777',
        'pass', 'maggie', '159753', 'aaaaaa', 'ginger', 'princess', 'joshua',
        'cheese', 'amanda', 'summer', 'love', 'ashley', 'nicole', 'chelsea',
        'biteme', 'matthew', 'access', 'yankees', '987654321', 'dallas', 'austin',
        'thunder', 'taylor', 'matrix', 'mobilemail', 'mom', 'monitor', 'monitoring',
        'montana', 'moon', 'moscow', 'hello', 'admin', 'root', 'toor', 'changeme',
        'welcome', 'login', 'passw0rd', 'p@ssw0rd', 'password1', 'password123',
        'qwerty123', 'secret', 'test', 'test123', 'demo', 'user', 'guest',
        'default', 'temp', 'temp123', 'abc12345', 'internet', 'service', 'whatever',
        'orange', 'cookie', 'peanut', 'boomer', 'silver', 'gateway', 'merlin',
        'flower', 'hottie', 'lakers', 'maverick', 'midnight', 'phoenix', 'purple',
        'racing', 'rainbow', 'scorpion', 'stella', 'viking', 'warrior', 'wizard'
    ];

    /** Batches stay small when every word expands to ~112 mutations. */
    const BATCH_WORDS = 20000;
    const BATCH_WORDS_MUTATE = 2000;

    let wordlistFile = null;
    let cracking = false;
    let crackController = null;

    function init() {
        /* ---------- text hashing ---------- */
        U.$('hash-calculate-btn').addEventListener('click', () => {
            const text = U.$('hash-input').value;
            const algorithm = U.$('hash-algorithm').value;
            if (!text) return U.toast('Enter text to hash.', 'warning');
            try {
                U.$('hash-output').value = KX.crypto.hashText(text, algorithm);
                if (KX.crypto.isWeakHash(algorithm)) {
                    U.toast(algorithm + ' digest computed — broken for security use.', 'warning');
                } else {
                    U.toast(algorithm + ' digest computed.', 'success');
                }
            } catch (err) {
                U.toast('Hashing failed: ' + err.message, 'error');
            }
        });

        U.$('hash-copy-btn').addEventListener('click', () => {
            U.copyText(U.$('hash-output').value, 'Digest copied.');
        });

        /* ---------- file hashing ---------- */
        const drop = U.$('hash-drop-zone');
        const fileInput = U.$('hash-file-input');
        let hashFile = null;

        const pickHashFile = (file) => {
            hashFile = file;
            U.$('hash-file-name').textContent = file.name;
            U.$('hash-file-size').textContent = U.formatBytes(file.size);
            U.$('hash-file-info').style.display = 'block';
        };

        drop.addEventListener('click', () => fileInput.click());
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
        drop.addEventListener('drop', (e) => {
            e.preventDefault();
            drop.classList.remove('dragover');
            if (e.dataTransfer.files.length) pickHashFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) pickHashFile(e.target.files[0]);
        });

        U.$('file-hash-calculate-btn').addEventListener('click', async () => {
            if (!hashFile) return U.toast('Select a file first.', 'warning');
            const algorithm = U.$('file-hash-algorithm').value;
            const out = U.$('file-hash-output');
            const btn = U.$('file-hash-calculate-btn');
            btn.disabled = true;
            try {
                const digest = await KX.crypto.hashFile(hashFile, algorithm,
                    (pct) => { out.value = `computing... ${pct}%`; });
                out.value = digest;
                U.toast(algorithm + ' file digest computed.', 'success');
            } catch (err) {
                out.value = '';
                U.toast('File hashing failed: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        });

        U.$('file-hash-copy-btn').addEventListener('click', () => {
            U.copyText(U.$('file-hash-output').value, 'File digest copied.');
        });

        /* ---------- comparison ---------- */
        U.$('compare-btn').addEventListener('click', () => {
            const a = U.$('hash1').value.replace(/\s+/g, '').toLowerCase();
            const b = U.$('hash2').value.replace(/\s+/g, '').toLowerCase();
            const box = U.$('comparison-result');
            if (!a || !b) return U.toast('Provide both digests.', 'warning');
            if (a === b) {
                box.className = 'compare-result match';
                box.innerHTML = '<i class="fas fa-check"></i> digests match';
            } else {
                box.className = 'compare-result mismatch';
                box.innerHTML = '<i class="fas fa-xmark"></i> digests differ';
            }
        });

        /* ---------- recovery ---------- */
        U.$('crack-detect-btn').addEventListener('click', () => {
            const digest = U.$('crack-hash-input').value;
            const candidates = KX.crypto.detectHashAlgorithms(digest);
            if (!candidates.length) {
                U.toast('Not a plain hex digest.', 'warning');
                return;
            }
            const select = U.$('crack-algorithm');
            const supported = candidates.filter((c) =>
                Array.from(select.options).some((o) => o.value === c));
            if (supported.length) select.value = supported[0];
            U.toast(`Length suggests: ${candidates.join(' / ')} — selected ${select.value}.`, 'info');
        });

        const crackDrop = U.$('crack-drop');
        const crackInput = U.$('crack-wordlist');
        const pickWordlist = (file) => {
            wordlistFile = file;
            U.$('crack-wordlist-name').textContent = file.name;
            U.$('crack-wordlist-size').textContent = U.formatBytes(file.size);
            U.$('crack-wordlist-info').style.display = 'block';
        };
        crackDrop.addEventListener('click', () => crackInput.click());
        crackDrop.addEventListener('dragover', (e) => { e.preventDefault(); crackDrop.classList.add('dragover'); });
        crackDrop.addEventListener('dragleave', () => crackDrop.classList.remove('dragover'));
        crackDrop.addEventListener('drop', (e) => {
            e.preventDefault();
            crackDrop.classList.remove('dragover');
            if (e.dataTransfer.files.length) pickWordlist(e.dataTransfer.files[0]);
        });
        crackInput.addEventListener('change', (e) => {
            if (e.target.files.length) pickWordlist(e.target.files[0]);
        });

        U.$('crack-start-btn').addEventListener('click', startRecovery);
        U.$('crack-cancel-btn').addEventListener('click', () => {
            if (crackController) crackController.abort();
        });
    }

    function setCrackProgress(fraction, label) {
        U.$('crack-progress').style.display = 'block';
        U.$('crack-progress-fill').style.width = Math.round(Math.min(1, fraction) * 100) + '%';
        U.$('crack-progress-text').textContent = label;
    }

    function showCrackResult(found, word, tested, ms) {
        const box = U.$('crack-result');
        box.style.display = 'block';
        if (found) {
            box.className = 'crack-result found';
            box.innerHTML =
                `<i class="fas fa-key"></i> plaintext recovered after ${U.formatCount(tested)} attempts (${(ms / 1000).toFixed(1)}s)` +
                `<span class="cracked-pass"></span>`;
            box.querySelector('.cracked-pass').textContent = word;
        } else {
            box.className = 'crack-result notfound';
            box.innerHTML =
                `<i class="fas fa-circle-minus"></i> not in wordlist — ${U.formatCount(tested)} candidates tried (${(ms / 1000).toFixed(1)}s). ` +
                'Try a larger list or different algorithm.';
        }
    }

    function rateLabel(tested, ms) {
        if (!ms) return '';
        const rate = Math.round(tested / (ms / 1000));
        return ` · ${U.formatCount(rate)}/s`;
    }

    async function startRecovery() {
        if (cracking) return;
        const target = U.$('crack-hash-input').value.trim().toLowerCase();
        if (!/^[0-9a-f]+$/.test(target)) return U.toast('Paste a valid hex digest.', 'warning');

        const algorithm = U.$('crack-algorithm').value;
        const mutate = U.$('crack-mutate').checked;
        const useBuiltin = U.$('crack-builtin').checked;

        if (!useBuiltin && !wordlistFile) {
            return U.toast('Enable the built-in list or drop a custom wordlist.', 'warning');
        }

        cracking = true;
        crackController = typeof AbortController === 'function' ? new AbortController() : null;
        const signal = crackController ? crackController.signal : undefined;
        U.$('crack-start-btn').disabled = true;
        U.$('crack-cancel-btn').disabled = false;
        U.$('crack-result').style.display = 'none';

        const batchSize = mutate ? BATCH_WORDS_MUTATE : BATCH_WORDS;
        let totalTested = 0;
        let totalMs = 0;
        let rate = '';
        const started = Date.now();

        const onProgress = (p) => {
            rate = rateLabel(totalTested + p.tested, Date.now() - started);
            U.$('crack-progress-text').textContent =
                `${U.formatCount(totalTested + p.tested)} tried${rate} · ${algorithm}${mutate ? ' · mutations on' : ''}`;
        };

        const runBatch = (words) => KX.workers.runCrackBatch(algorithm, target, words, mutate,
            { signal, onProgress });

        try {
            // phase 1 — built-in list
            if (useBuiltin) {
                setCrackProgress(0.05, `trying ${COMMON_PASSWORDS.length} built-in candidates...`);
                const r = await runBatch(COMMON_PASSWORDS);
                totalTested += r.tested;
                totalMs += r.ms;
                if (r.found) return showCrackResult(true, r.word, totalTested, totalMs);
            }

            // phase 2 — custom wordlist, streamed in slices, hashed in batches
            if (wordlistFile) {
                const SLICE = 2 * 1024 * 1024;
                const size = wordlistFile.size;
                let offset = 0;
                let carry = '';
                let queue = [];

                const flush = async () => {
                    while (queue.length) {
                        const slice = queue.splice(0, batchSize);
                        const r = await runBatch(slice);
                        totalTested += r.tested;
                        totalMs += r.ms;
                        if (r.found) return r;
                    }
                    return null;
                };

                while (offset < size) {
                    if (signal && signal.aborted) break;
                    const chunk = await wordlistFile.slice(offset, offset + SLICE).text();
                    const lines = (carry + chunk).split(/\r?\n/);
                    carry = lines.pop(); // may be an incomplete line
                    offset += SLICE;

                    for (let i = 0; i < lines.length; i++) {
                        const word = lines[i].trim();
                        if (word) queue.push(word);
                    }

                    setCrackProgress(offset / size,
                        `${U.formatCount(totalTested)} tried${rate} · ${(offset / 1048576).toFixed(1)} MB read`);

                    const hit = await flush();
                    if (hit) {
                        if (hit.found) return showCrackResult(true, hit.word, totalTested, totalMs);
                    }
                    await new Promise((res) => setTimeout(res, 0));
                }

                if (!(signal && signal.aborted) && carry.trim()) {
                    queue.push(carry.trim());
                }
                const tail = await flush();
                if (tail && tail.found) return showCrackResult(true, tail.word, totalTested, totalMs);
            }

            if (signal && signal.aborted) {
                U.toast(`Recovery cancelled after ${U.formatCount(totalTested)} attempts.`, 'warning');
            } else {
                showCrackResult(false, null, totalTested, totalMs);
            }
        } catch (err) {
            if (err && err.name === 'AbortError') {
                U.toast(`Recovery cancelled after ${U.formatCount(totalTested)} attempts.`, 'warning');
            } else {
                U.toast('Recovery failed: ' + err.message, 'error');
            }
        } finally {
            cracking = false;
            crackController = null;
            U.$('crack-start-btn').disabled = false;
            U.$('crack-cancel-btn').disabled = true;
            setCrackProgress(1, `done — ${U.formatCount(totalTested)} candidates`);
        }
    }

    return { init };
})();
