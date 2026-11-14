/* ==========================================================================
   core/workers.js — thin wrappers around the two dedicated workers.

   The worker sources are real files (not blob: URLs) so a strict
   `worker-src 'self'` Content-Security-Policy can be enforced.  Input buffers
   are passed by structured clone, never transferred: the caller keeps a valid
   copy for the main-thread fallback path.
   ========================================================================== */
'use strict';

KX.workers = (() => {
    const COMPRESS_WORKER = 'assets/js/workers/compress-worker.js';
    const CRACK_WORKER = 'assets/js/workers/crack-worker.js';

    let nextId = 0;

    function abortError() {
        if (typeof DOMException === 'function') {
            return new DOMException('The operation was aborted.', 'AbortError');
        }
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        return err;
    }

    /**
     * Stream-compress or decompress a Uint8Array off-thread.
     * @param {'deflate'|'inflate'} job
     * @param {Uint8Array} input
     * @param {object|null} opts pako options for deflate
     * @param {(fraction:number)=>void} [onProgress]
     * @param {number} [maxOut] abort inflation past this many output bytes
     */
    function runCompression(job, input, opts, onProgress, maxOut) {
        return new Promise((resolve, reject) => {
            let worker;
            try {
                worker = new Worker(COMPRESS_WORKER);
            } catch (e) {
                reject(e);
                return;
            }
            const id = ++nextId;
            let settled = false;

            const cleanup = () => {
                try { worker.terminate(); } catch (e) { /* already gone */ }
            };
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                fn(value);
            };

            worker.onmessage = (event) => {
                const msg = event.data || {};
                if (msg.id !== id) return;
                if (msg.type === 'progress') {
                    if (onProgress) onProgress(Math.min(1, msg.done / msg.total));
                } else if (msg.type === 'done') {
                    finish(resolve, msg.out);
                } else if (msg.type === 'error') {
                    finish(reject, new Error(msg.error || 'compression failed'));
                }
            };
            worker.onerror = (event) => {
                finish(reject, new Error(event.message || 'compression worker failed'));
            };

            // Structured clone: keeps `input` intact if we have to fall back.
            worker.postMessage({ id, job, data: input, opts, maxOut: maxOut || 0 });
        });
    }

    /** Main-thread fallback (workers blocked by policy, or creation failed). */
    function runCompressionFallback(job, input, opts, maxOut) {
        if (typeof pako === 'undefined') return Promise.reject(new Error('pako unavailable'));
        try {
            const out = job === 'deflate' ? pako.deflate(input, opts) : pako.inflate(input);
            if (maxOut && out.length > maxOut) {
                return Promise.reject(new Error('Expansion limit exceeded.'));
            }
            return Promise.resolve(out);
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /**
     * Try one dictionary batch against a target digest.  Cancellation is done
     * by terminating the worker, which is the only way to interrupt a
     * synchronous hash loop.
     * @param {string} algorithm
     * @param {string} target lowercase hex digest
     * @param {string[]} words
     * @param {boolean} mutate
     * @param {{signal?: AbortSignal, onProgress?: (p:{tested:number,ms:number})=>void}} [options]
     */
    function runCrackBatch(algorithm, target, words, mutate, options) {
        const opts = options || {};
        return new Promise((resolve, reject) => {
            if (opts.signal && opts.signal.aborted) {
                reject(abortError());
                return;
            }
            let worker;
            try {
                worker = new Worker(CRACK_WORKER);
            } catch (e) {
                reject(e);
                return;
            }
            const id = ++nextId;
            let settled = false;
            let onAbort = null;

            const cleanup = () => {
                if (opts.signal && onAbort) opts.signal.removeEventListener('abort', onAbort);
                try { worker.terminate(); } catch (e) { /* already gone */ }
            };
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                fn(value);
            };

            onAbort = () => finish(reject, abortError());
            if (opts.signal) opts.signal.addEventListener('abort', onAbort);

            worker.onmessage = (event) => {
                const msg = event.data || {};
                if (msg.id !== id) return;
                if (msg.type === 'progress') {
                    if (opts.onProgress) opts.onProgress({ tested: msg.tested, ms: msg.ms });
                } else if (msg.type === 'found') {
                    finish(resolve, { found: true, word: msg.word, tested: msg.tested, ms: msg.ms });
                } else if (msg.type === 'exhausted') {
                    finish(resolve, { found: false, tested: msg.tested, ms: msg.ms });
                } else if (msg.type === 'error') {
                    finish(reject, new Error(msg.error || 'recovery failed'));
                }
            };
            worker.onerror = (event) => {
                finish(reject, new Error(event.message || 'recovery worker failed'));
            };

            worker.postMessage({ id, type: 'run', algorithm, target, words, mutate: !!mutate });
        });
    }

    return { runCompression, runCompressionFallback, runCrackBatch };
})();
