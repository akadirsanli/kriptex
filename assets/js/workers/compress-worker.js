/* ==========================================================================
   workers/compress-worker.js — streamed DEFLATE/INFLATE off the main thread.

   Protocol
     in : { id, job: 'deflate'|'inflate', data: Uint8Array, opts, maxOut }
     out: { type: 'progress', id, done, total }
          { type: 'done', id, out }            (buffer transferred)
          { type: 'error', id, error }
   ========================================================================== */
'use strict';

/* global pako */
importScripts('../../vendor/pako.min.js');

var CHUNK = 4 * 1024 * 1024;

self.onmessage = function (event) {
    var msg = event.data;
    if (!msg || !msg.id) return;

    try {
        var input = msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data);
        var total = input.length;
        var parts = [];
        var partLen = 0;
        var overflowed = false;
        var limit = Number(msg.maxOut) || 0;

        var engine = msg.job === 'deflate'
            ? new pako.Deflate(msg.opts || {})
            : new pako.Inflate();

        engine.onData = function (chunk) {
            if (overflowed) return;
            partLen += chunk.length;
            if (limit && partLen > limit) {
                overflowed = true;
                return;
            }
            parts.push(chunk);
        };

        for (var offset = 0; offset < total || (total === 0 && offset === 0); offset += CHUNK) {
            var end = Math.min(offset + CHUNK, total);
            var last = end >= total;
            engine.push(input.subarray(offset, end), last);
            if (overflowed) {
                throw new Error('Expansion limit exceeded (' + Math.round(limit / 1048576) + ' MB).');
            }
            if (engine.err) throw new Error(engine.msg || 'compression failed');
            self.postMessage({ type: 'progress', id: msg.id, done: end, total: Math.max(total, 1) });
            if (last) break;
        }

        var out = new Uint8Array(partLen);
        var pos = 0;
        for (var i = 0; i < parts.length; i++) {
            out.set(parts[i], pos);
            pos += parts[i].length;
        }
        self.postMessage({ type: 'done', id: msg.id, out: out }, [out.buffer]);
    } catch (err) {
        self.postMessage({
            type: 'error',
            id: msg.id,
            error: String(err && err.message ? err.message : err)
        });
    }
};
