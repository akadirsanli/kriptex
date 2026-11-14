/* ==========================================================================
   fx/effects.js — ambient background (digital rain), spotlight, cursor ring.
   Decoration only: disabling it changes nothing about how the app works.
   ========================================================================== */
'use strict';

KX.fx = (() => {
    const U = KX.utils;

    const state = {
        enabled: localStorage.getItem('kriptex-fx') !== 'off',
        reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        coarse: window.matchMedia('(pointer: coarse)').matches,
        mouse: { x: window.innerWidth / 2, y: window.innerHeight / 3, active: false },
        ring: { x: window.innerWidth / 2, y: window.innerHeight / 3 },
        running: false
    };

    const canvas = U.$('fx-canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;
    const ringEl = U.$('cursor-ring');
    const spotEl = U.$('spotlight');

    const GLYPHS = 'アイウエオカキクケコサシスセソ01<>[]{}$#=+*';
    const FONT_SIZE = 18;
    const STEP = FONT_SIZE * 0.62;

    let columns = [];
    let dpr = 1;
    let accent = '#38f08c';

    function readThemeColors() {
        const cs = getComputedStyle(document.documentElement);
        accent = cs.getPropertyValue('--accent').trim() || accent;
    }

    function resize() {
        if (!canvas) return;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.floor(window.innerWidth * dpr);
        canvas.height = Math.floor(window.innerHeight * dpr);
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        seedRain();
    }

    function seedRain() {
        const count = Math.floor(window.innerWidth / (FONT_SIZE * 2));
        columns = [];
        for (let i = 0; i < count; i++) {
            columns.push({
                x: (i + 0.5) * (FONT_SIZE * 2),
                y: Math.random() * window.innerHeight,
                speed: 0.6 + Math.random() * 1.4,
                length: 5 + Math.floor(Math.random() * 12)
            });
        }
    }

    const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

    function hexToRgba(hex, alpha) {
        let h = String(hex).replace('#', '').trim();
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        const n = parseInt(h, 16);
        if (Number.isNaN(n) || h.length !== 6) return `rgba(56, 240, 140, ${alpha})`;
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }

    function frame() {
        if (!state.running || !ctx) return;

        ctx.fillStyle = 'rgba(3, 6, 5, 0.16)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${FONT_SIZE * dpr}px "JetBrains Mono", monospace`;

        for (const col of columns) {
            col.y += col.speed * STEP;

            for (let t = 0; t < col.length; t++) {
                const gy = col.y - t * FONT_SIZE;
                if (gy < -FONT_SIZE || gy > window.innerHeight + FONT_SIZE) continue;
                const head = t === 0;
                const alpha = head ? 0.55 : (1 - t / col.length) * 0.22;
                ctx.fillStyle = hexToRgba(accent, alpha);
                ctx.fillText(randomGlyph(), col.x * dpr, gy * dpr);
            }

            if (col.y - col.length * FONT_SIZE > window.innerHeight) {
                col.y = -FONT_SIZE * 2;
                col.speed = 0.6 + Math.random() * 1.4;
            }
        }

        if (ringEl && !state.coarse) {
            state.ring.x += (state.mouse.x - state.ring.x) * 0.18;
            state.ring.y += (state.mouse.y - state.ring.y) * 0.18;
            ringEl.style.transform = `translate(${state.ring.x - 15}px, ${state.ring.y - 15}px)`;
        }

        requestAnimationFrame(frame);
    }

    function onMouseMove(event) {
        state.mouse.x = event.clientX;
        state.mouse.y = event.clientY;
        state.mouse.active = true;

        if (!state.enabled || state.reduced) return;
        if (spotEl) {
            spotEl.style.setProperty('--sx', event.clientX + 'px');
            spotEl.style.setProperty('--sy', event.clientY + 'px');
        }
        if (ringEl) ringEl.style.opacity = state.coarse ? '0' : '0.7';
    }

    function onMouseOver(event) {
        if (!ringEl || !event.target.closest) return;
        const hit = event.target.closest(
            'button, a, input, textarea, select, label, .dropzone, .note-item, .theme-btn, .theme-dot'
        );
        ringEl.classList.toggle('hovering', !!hit);
    }

    function setEnabled(on) {
        state.enabled = on;
        document.body.classList.toggle('fx-off', !on);
        if (on && !state.running && !state.reduced) {
            state.running = true;
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            requestAnimationFrame(frame);
        }
        if (!on) state.running = false;
    }

    function init() {
        readThemeColors();
        resize();

        window.addEventListener('resize', resize);
        document.addEventListener('mousemove', onMouseMove, { passive: true });
        document.addEventListener('mouseover', onMouseOver, { passive: true });
        document.addEventListener('mouseleave', () => {
            state.mouse.active = false;
            if (ringEl) ringEl.style.opacity = '0';
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                state.running = false;
            } else if (state.enabled && !state.reduced) {
                state.running = true;
                requestAnimationFrame(frame);
            }
        });

        document.body.classList.toggle('fx-off', !state.enabled);

        if (state.enabled && !state.reduced) {
            state.running = true;
            requestAnimationFrame(frame);
        }
    }

    return { init, setEnabled, readThemeColors, isEnabled: () => state.enabled };
})();
