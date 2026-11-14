/* ==========================================================================
   core/utils.js — shared helpers (DOM, formatting, encoding, toasts)
   ========================================================================== */
'use strict';

window.KX = window.KX || {};

KX.utils = (() => {
    const $ = (id) => document.getElementById(id);

    const TOAST_PREFIX = { success: '[ OK ]', error: '[ERR ]', warning: '[WARN]', info: '[INFO]' };

    let toastTimer = null;

    function toast(message, type = 'success') {
        const el = $('status-message');
        if (!el) return;
        const prefix = document.createElement('span');
        prefix.className = 'tag-prefix';
        prefix.textContent = TOAST_PREFIX[type] || TOAST_PREFIX.info;
        const body = document.createElement('span');
        body.textContent = message;
        el.replaceChildren(prefix, body);
        el.className = 'status-toast ' + type;
        el.style.display = 'flex';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.style.display = 'none'; }, 4200);
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
    }

    const formatCount = (n) => Number(n).toLocaleString('en-US');

    const formatSeconds = (ms) => (ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s');

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function timestampedName(prefix, ext) {
        return prefix + '-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.' + ext;
    }

    function copyText(text, okMessage) {
        if (!text) return;
        if (!navigator.clipboard) {
            toast('Clipboard API unavailable in this context.', 'error');
            return;
        }
        navigator.clipboard.writeText(text)
            .then(() => toast(okMessage, 'success'))
            .catch(() => toast('Clipboard copy failed — permission denied.', 'error'));
    }

    /** Clear the value of one or more fields by id (used when locking secrets). */
    function clearFields(ids) {
        ids.forEach((id) => { const el = $(id); if (el) el.value = ''; });
    }

    /** Chunked base64 encode — safe for buffers of any size (no call-stack blowup). */
    function bufToB64(buf) {
        const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        const CHUNK = 0x8000;
        let bin = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(bin);
    }

    function b64ToBuf(b64) {
        const bin = atob(b64.replace(/\s+/g, ''));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    const utf8Encode = (s) => new TextEncoder().encode(s);
    const utf8Decode = (b) => new TextDecoder().decode(b);

    const bytesToHex = (bytes) =>
        Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

    const randomBytes = (n) => {
        if (!globalThis.crypto || !crypto.getRandomValues) {
            throw new Error('Secure random number generator unavailable in this context.');
        }
        return crypto.getRandomValues(new Uint8Array(n));
    };

    /** Animate a numeric stat (disabled when fx are off). */
    function animateValue(el, target, format, duration = 550) {
        if (!el) return;
        if (document.body.classList.contains('fx-off')) {
            el.textContent = format(target);
            return;
        }
        const start = performance.now();
        const frame = (now) => {
            const p = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = format(target * eased);
            if (p < 1) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    /* ---------- passphrase strength ---------- */

    /** Passwords that are common regardless of how "complex" they look. */
    const COMMON_PASSWORDS = new Set([
        'password', 'password1', 'password1!', 'password123', 'passw0rd', 'p@ssw0rd',
        'qwerty', 'qwertyuiop', 'qwerty123', 'qwertyuiop1!', 'asdfgh', 'zxcvbn',
        'letmein', 'welcome', 'welcome1', 'admin', 'root', 'toor', 'changeme',
        'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess', 'football',
        'baseball', 'superman', 'trustno1', 'abc123', '123456', '12345678',
        '1234567890', '111111', '000000', '123456789', 'letmein1', 'secret',
        'master', 'shadow', 'michael', 'jennifer', 'hunter', 'buster'
    ]);

    /** Short keyboard/date runs that satisfy naive complexity rules. */
    const WEAK_RUNS = [
        'qwerty', 'asdf', 'zxcv', '1234', '4321', 'abcd', '0000', '1111',
        'password', 'letmein', 'admin', 'welcome', 'iloveyou'
    ];

    /**
     * Rough entropy estimate in bits for a human-chosen passphrase.
     * Deliberately pessimistic: distinguishes "long but predictable" from
     * genuinely random, which a length/charset counter cannot do.
     */
    function entropyBits(pass) {
        if (!pass) return 0;
        let pool = 0;
        if (/[a-z]/.test(pass)) pool += 26;
        if (/[A-Z]/.test(pass)) pool += 26;
        if (/[0-9]/.test(pass)) pool += 10;
        if (/[^A-Za-z0-9]/.test(pass)) pool += 33;
        if (!pool) pool = 1;

        const unique = new Set(pass).size;
        const effectiveLength = pass.length * (0.35 + 0.65 * (unique / pass.length));
        let bits = effectiveLength * Math.log2(pool);

        const lower = pass.toLowerCase();
        if (COMMON_PASSWORDS.has(lower)) bits = Math.min(bits, 10);
        if (WEAK_RUNS.some((run) => lower.includes(run))) bits = Math.min(bits, 24);
        if (/^(.)\1+$/.test(pass)) bits = Math.min(bits, 6);
        return Math.max(0, Math.round(bits));
    }

    function strengthLabel(bits) {
        if (!bits) return { label: 'strength: —', color: 'var(--err)' };
        if (bits < 28) return { label: 'strength: very weak', color: '#ff4d5e' };
        if (bits < 40) return { label: 'strength: weak', color: '#ff8c42' };
        if (bits < 60) return { label: 'strength: fair', color: '#ffb000' };
        if (bits < 80) return { label: 'strength: strong', color: 'var(--acc)' };
        return { label: 'strength: excellent', color: 'var(--acc)' };
    }

    function renderStrength(barEl, textEl, pass) {
        const bits = entropyBits(pass);
        const { label, color } = strengthLabel(bits);
        barEl.style.width = (pass.length ? Math.min(100, bits) : 0) + '%';
        barEl.style.background = color;
        textEl.textContent = pass.length ? label + ' · ~' + bits + ' bits' : label;
    }

    /** Bias-free random index via rejection sampling on CSPRNG output. */
    function secureIndex(length) {
        const limit = Math.floor(4294967296 / length) * length;
        const buf = new Uint32Array(1);
        let x;
        do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
        return x % length;
    }

    const securePick = (chars) => chars[secureIndex(chars.length)];

    /** Fisher–Yates shuffle using the CSPRNG (in place). */
    function secureShuffle(items) {
        for (let i = items.length - 1; i > 0; i--) {
            const j = secureIndex(i + 1);
            const tmp = items[i];
            items[i] = items[j];
            items[j] = tmp;
        }
        return items;
    }

    /* ---------- confirmation dialog ---------- */

    let modalState = null;

    function closeModal(result) {
        const modal = $('modal');
        if (!modal) return;
        modal.hidden = true;
        document.body.style.removeProperty('overflow');
        const current = modalState;
        modalState = null;
        if (current && current.previousFocus && current.previousFocus.focus) {
            current.previousFocus.focus();
        }
        if (current && current.resolve) current.resolve(result);
    }

    function wireModal() {
        const modal = $('modal');
        if (!modal || wireModal.done) return;
        wireModal.done = true;

        const cancel = $('modal-cancel');
        const confirm = $('modal-confirm');
        if (cancel) cancel.addEventListener('click', () => closeModal(false));
        if (confirm) confirm.addEventListener('click', () => closeModal(true));

        const scrim = modal.querySelector('[data-modal-cancel]');
        if (scrim) scrim.addEventListener('click', () => closeModal(false));

        document.addEventListener('keydown', (event) => {
            if (modal.hidden) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeModal(false);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                closeModal(true);
            }
        });
    }

    /**
     * Promise-based replacement for window.confirm().
     * Resolves true when the user confirms.
     */
    function confirmAction(options) {
        const opts = options || {};
        const modal = $('modal');
        if (!modal) return Promise.resolve(window.confirm(opts.body || 'Are you sure?'));

        wireModal();

        const title = $('modal-title');
        const body = $('modal-body');
        const confirm = $('modal-confirm');
        const previousFocus = document.activeElement;

        if (title) title.textContent = opts.title || 'Confirm';
        if (body) body.textContent = opts.body || '';
        if (confirm) {
            confirm.textContent = opts.confirmLabel || 'Confirm';
            confirm.className = 'btn ' + (opts.danger === false ? 'btn-primary' : 'btn-danger');
        }

        modal.hidden = false;
        document.body.style.overflow = 'hidden';
        if (confirm) confirm.focus();

        return new Promise((resolve) => {
            modalState = { resolve, previousFocus };
        });
    }

    return {
        $, toast, formatBytes, formatCount, formatSeconds, downloadBlob, timestampedName,
        copyText, clearFields, bufToB64, b64ToBuf, utf8Encode, utf8Decode, bytesToHex,
        randomBytes, animateValue, entropyBits, strengthLabel, renderStrength,
        secureIndex, securePick, secureShuffle, confirmAction
    };
})();
