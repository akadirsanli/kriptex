/* ==========================================================================
   tabs/generator-tab.js — CSPRNG password & passphrase generation
   ========================================================================== */
'use strict';

KX.tabs = KX.tabs || {};

KX.generators = (() => {
    const U = KX.utils;

    const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const LOWER = 'abcdefghijklmnopqrstuvwxyz';
    const DIGITS = '0123456789';
    const SYMBOLS = '!@#$%^&*()_+~`|}{[]:;?><,./-=';

    /** Size of the character pool for the selected classes. */
    function poolSize(upper, lower, digits, symbols) {
        let size = 0;
        if (upper) size += UPPER.length;
        if (lower) size += LOWER.length;
        if (digits) size += DIGITS.length;
        if (symbols) size += SYMBOLS.length;
        return size;
    }

    /** Entropy of a uniformly drawn password in bits. */
    function passwordEntropy(length, upper, lower, digits, symbols) {
        const size = poolSize(upper, lower, digits, symbols);
        return size > 1 ? Math.round(length * Math.log2(size)) : 0;
    }

    /**
     * Generate a password. When the requested length allows it, at least one
     * character from every enabled class is guaranteed, then the result is
     * shuffled with the CSPRNG so the guaranteed characters are not positional.
     */
    function password(length, upper, lower, digits, symbols) {
        const classes = [];
        if (upper) classes.push(UPPER);
        if (lower) classes.push(LOWER);
        if (digits) classes.push(DIGITS);
        if (symbols) classes.push(SYMBOLS);
        const pool = classes.join('');
        if (!pool) return '';

        const chars = [];
        if (length >= classes.length) {
            classes.forEach((cls) => chars.push(U.securePick(cls)));
        }
        while (chars.length < length) chars.push(U.securePick(pool));
        U.secureShuffle(chars);
        return chars.slice(0, length).join('');
    }

    const WORDS = KX.wordlist || [];

    const WORD_BITS = WORDS.length ? Math.log2(WORDS.length) : 0;

    /** Entropy of a passphrase in bits (words + the optional extras). */
    function passphraseEntropy(count, addDigits, addSymbol) {
        let bits = count * WORD_BITS;
        if (addDigits) bits += Math.log2(100);
        if (addSymbol) bits += Math.log2(7);
        return Math.round(bits);
    }

    function passphrase(count, addDigits, addSymbol, capitalize) {
        if (!WORDS.length) throw new Error('Wordlist failed to load.');
        const words = [];
        for (let i = 0; i < count; i++) {
            let w = WORDS[U.secureIndex(WORDS.length)];
            if (capitalize) w = w.charAt(0).toUpperCase() + w.slice(1);
            words.push(w);
        }
        let out = words.join('-');
        if (addDigits) out += U.securePick('0123456789') + U.securePick('0123456789');
        if (addSymbol) out += U.securePick('!@#$%&*?');
        return out;
    }

    function entropyLabel(bits) {
        if (bits >= 128) return { text: `~${bits} bits — excellent`, color: 'var(--acc)' };
        if (bits >= 80) return { text: `~${bits} bits — strong`, color: 'var(--acc)' };
        if (bits >= 60) return { text: `~${bits} bits — fair`, color: '#ffb000' };
        return { text: `~${bits} bits — weak`, color: '#ff4d5e' };
    }

    return {
        password, passphrase, poolSize, passwordEntropy, passphraseEntropy,
        entropyLabel, wordCount: WORDS.length, WORD_BITS
    };
})();

KX.tabs.generator = (() => {
    const U = KX.utils;

    function renderEntropy(el, bits) {
        if (!el) return;
        const info = KX.generators.entropyLabel(bits);
        el.textContent = info.text;
        el.style.color = info.color;
    }

    function init() {
        const slider = U.$('pass-length');

        const syncSlider = () => {
            U.$('len-val').textContent = slider.value;
            const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
            slider.style.setProperty('--fill', pct + '%');
        };
        slider.addEventListener('input', syncSlider);
        syncSlider();

        U.$('tool-gen-btn').addEventListener('click', () => {
            const upper = U.$('inc-upper').checked;
            const lower = U.$('inc-lower').checked;
            const digits = U.$('inc-num').checked;
            const symbols = U.$('inc-sym').checked;
            if (!upper && !lower && !digits && !symbols) {
                return U.toast('Select at least one character pool.', 'warning');
            }
            const length = parseInt(slider.value, 10);
            U.$('tool-gen-output').value = KX.generators.password(length, upper, lower, digits, symbols);
            renderEntropy(U.$('pass-entropy'), KX.generators.passwordEntropy(length, upper, lower, digits, symbols));
        });

        U.$('tool-copy-btn').addEventListener('click', () => {
            U.copyText(U.$('tool-gen-output').value, 'Password copied.');
        });

        const updatePassphraseEntropy = () => {
            const count = Math.min(12, Math.max(3, parseInt(U.$('word-count').value, 10) || 4));
            renderEntropy(U.$('passphrase-entropy'), KX.generators.passphraseEntropy(
                count, U.$('add-number').checked, U.$('add-symbol').checked
            ));
        };
        U.$('word-count').addEventListener('input', updatePassphraseEntropy);
        U.$('add-number').addEventListener('change', updatePassphraseEntropy);
        U.$('add-symbol').addEventListener('change', updatePassphraseEntropy);
        updatePassphraseEntropy();

        U.$('passphrase-gen-btn').addEventListener('click', () => {
            const count = Math.min(12, Math.max(3, parseInt(U.$('word-count').value, 10) || 4));
            U.$('word-count').value = count;
            try {
                U.$('passphrase-output').value = KX.generators.passphrase(
                    count, U.$('add-number').checked, U.$('add-symbol').checked,
                    U.$('capitalize-words').checked
                );
                updatePassphraseEntropy();
            } catch (err) {
                U.toast('Passphrase generation failed: ' + err.message, 'error');
            }
        });

        U.$('passphrase-copy-btn').addEventListener('click', () => {
            U.copyText(U.$('passphrase-output').value, 'Passphrase copied.');
        });
    }

    return { init };
})();
