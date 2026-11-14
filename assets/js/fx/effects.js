/* ==========================================================================
   fx/effects.js — digital rain canvas, mouse spotlight, cursor ring,
   panel tilt, boot typing effect. Toggle via Settings (body.fx-off).
   ========================================================================== */
'use strict';

KX.fx = (() => {
    const U = KX.utils;

    const state = {
        enabled: localStorage.getItem('kriptex-fx') !== 'off',
        reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        coarse: window.matchMedia('(pointer: coarse)').matches,
        mouse: { x: innerWidth / 2, y: innerHeight / 3, active: false },
        ring: { x: innerWidth / 2, y: innerHeight / 3 },
        running: false
    };

    const canvas = U.$('fx-canvas');
    const ctx = canvas.getContext('2d');
    const ringEl = U.$('cursor-ring');
    const spotEl = U.$('spotlight');

    const GLYPHS = 'アイウエオカキクケコサシスセソ01<>[]{}$#=+*';
    const FONT_SIZE = 15;
    let columns = [];
    let bursts = [];
    let dpr = 1;
    let accColor = '#33ff66';
    let acc2Color = '#00e5ff';

    function readThemeColors() {
        const cs = getComputedStyle(document.documentElement);
        accColor = cs.getPropertyValue('--acc').trim() || accColor;
        acc2Color = cs.getPropertyValue('--acc2').trim() || acc2Color;
    }

    function resize() {
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.floor(innerWidth * dpr);
        canvas.height = Math.floor(innerHeight * dpr);
        canvas.style.width = innerWidth + 'px';
        canvas.style.height = innerHeight + 'px';
        seedRain();
    }

    function seedRain() {
        const count = Math.floor(innerWidth / FONT_SIZE);
        columns = [];
        for (let i = 0; i < count; i++) {
            columns.push({
                x: i * FONT_SIZE,
                y: Math.random() * innerHeight,
                speed: 1.2 + Math.random() * 2.4,
                length: 6 + Math.floor(Math.random() * 14)
            });
        }
    }

    const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

    function hexA(hex, alpha) {
        let h = hex.replace('#', '');
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        const n = parseInt(h, 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
    }

    function frame() {
        if (!state.running) return;

        ctx.fillStyle = 'rgba(5, 7, 5, 0.14)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${FONT_SIZE * dpr}px "JetBrains Mono", monospace`;

        const mouseCol = state.mouse.active ? state.mouse.x : -9999;

        for (const col of columns) {
            // columns near the cursor run faster and brighter
            const dist = Math.abs(col.x - mouseCol);
            const boost = dist < 160 ? (1 - dist / 160) : 0;
            col.y += (col.speed + boost * 3.2) * (FONT_SIZE * 0.55);

            for (let t = 0; t < col.length; t++) {
                const gy = col.y - t * FONT_SIZE;
                if (gy < -FONT_SIZE || gy > innerHeight + FONT_SIZE) continue;
                const head = t === 0;
                const alpha = head ? 0.95 : (1 - t / col.length) * (0.45 + boost * 0.4);
                ctx.fillStyle = head && boost > 0.25 ? hexA(acc2Color, 0.95) : hexA(accColor, alpha);
                ctx.fillText(randomGlyph(), col.x * dpr, gy * dpr);
            }

            if (col.y - col.length * FONT_SIZE > innerHeight) {
                col.y = -FONT_SIZE * 2;
                col.speed = 1.2 + Math.random() * 2.4;
            }
        }

        // click bursts — a bright column drop at the click position
        for (let i = bursts.length - 1; i >= 0; i--) {
            const b = bursts[i];
            b.y += 14;
            b.life -= 0.02;
            if (b.life <= 0 || b.y > innerHeight + 40) { bursts.splice(i, 1); continue; }
            ctx.fillStyle = hexA(acc2Color, b.life * 0.9);
            ctx.fillText(randomGlyph(), b.x * dpr, b.y * dpr);
        }

        // cursor ring follows with easing
        if (ringEl && !state.coarse) {
            state.ring.x += (state.mouse.x - state.ring.x) * 0.2;
            state.ring.y += (state.mouse.y - state.ring.y) * 0.2;
            ringEl.style.transform = `translate(${state.ring.x - 15}px, ${state.ring.y - 15}px)`;
        }

        requestAnimationFrame(frame);
    }

    function onMouseMove(e) {
        state.mouse.x = e.clientX;
        state.mouse.y = e.clientY;
        state.mouse.active = true;
        if (!state.enabled || state.reduced) return;
        spotEl.style.setProperty('--sx', e.clientX + 'px');
        spotEl.style.setProperty('--sy', e.clientY + 'px');
        if (ringEl) ringEl.style.opacity = '1';
    }

    function onClick(e) {
        if (!state.enabled || state.reduced) return;
        const col = Math.round(e.clientX / FONT_SIZE) * FONT_SIZE;
        for (let i = 0; i < 10; i++) {
            bursts.push({ x: col + (Math.random() - 0.5) * 30, y: e.clientY - i * FONT_SIZE, life: 1 });
        }
    }

    /* Panel tilt + glow tracking */
    function bindPanels() {
        document.addEventListener('mousemove', (e) => {
            const panel = e.target.closest && e.target.closest('.term-panel, .drop-zone');
            if (!panel) return;
            const r = panel.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width;
            const py = (e.clientY - r.top) / r.height;
            panel.style.setProperty('--mx', (px * 100) + '%');
            panel.style.setProperty('--my', (py * 100) + '%');
            if (panel.classList.contains('term-panel') && state.enabled && !state.coarse && !state.reduced) {
                panel.style.setProperty('--ry', ((px - 0.5) * 3.2) + 'deg');
                panel.style.setProperty('--rx', ((0.5 - py) * 3.2) + 'deg');
            }
        });
        document.addEventListener('mouseout', (e) => {
            const panel = e.target.closest && e.target.closest('.term-panel');
            if (panel) {
                panel.style.setProperty('--rx', '0deg');
                panel.style.setProperty('--ry', '0deg');
            }
        });
        document.addEventListener('mouseover', (e) => {
            if (!ringEl) return;
            const hit = e.target.closest && e.target.closest('button, a, input, textarea, select, label, .drop-zone, .note-item');
            ringEl.classList.toggle('hovering', !!hit);
        });
    }

    /* Boot typing effect for the header subtitle */
    function typeSubtitle() {
        const el = U.$('typed-subtitle');
        if (!el) return;
        const text = './kriptex --local --no-server --audit-me';
        if (state.reduced) { el.textContent = text; return; }
        let i = 0;
        const tick = () => {
            el.textContent = text.slice(0, ++i);
            if (i < text.length) setTimeout(tick, 34);
        };
        setTimeout(tick, 350);
    }

    function setEnabled(on) {
        state.enabled = on;
        document.body.classList.toggle('fx-off', !on);
        if (on && !state.running) {
            state.running = true;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            requestAnimationFrame(frame);
        }
        if (!on) state.running = false;
    }

    function init() {
        readThemeColors();
        resize();
        window.addEventListener('resize', resize);
        document.addEventListener('mousemove', onMouseMove, { passive: true });
        document.addEventListener('click', onClick, { passive: true });
        document.addEventListener('mouseleave', () => {
            state.mouse.active = false;
            if (ringEl) ringEl.style.opacity = '0';
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) state.running = false;
            else if (state.enabled) { state.running = true; requestAnimationFrame(frame); }
        });
        bindPanels();
        if (!state.enabled) document.body.classList.add('fx-off');
        else { state.running = true; requestAnimationFrame(frame); }
        typeSubtitle();
    }

    return { init, setEnabled, readThemeColors, isEnabled: () => state.enabled };
})();
