/* ==========================================================================
   workers/crack-worker.js — dictionary attack against a target digest.

   Candidates are produced lazily (generators) so memory stays flat no matter
   how large the wordlist slice is.  The main thread cancels a run by calling
   worker.terminate(); progress is reported every ~120 ms.

   Protocol
     in : { id, type: 'run', algorithm, target, words, mutate }
     out: { type: 'progress', id, tested, ms }
          { type: 'found', id, word, tested, ms }
          { type: 'exhausted', id, tested, ms }
          { type: 'error', id, error }
   ========================================================================== */
'use strict';

/* global CryptoJS */
importScripts('../../vendor/crypto-js.min.js');

var ALGOS = {
    'MD5':        function (w) { return CryptoJS.MD5(w).toString(); },
    'SHA-1':      function (w) { return CryptoJS.SHA1(w).toString(); },
    'SHA-224':    function (w) { return CryptoJS.SHA224(w).toString(); },
    'SHA-256':    function (w) { return CryptoJS.SHA256(w).toString(); },
    'SHA-384':    function (w) { return CryptoJS.SHA384(w).toString(); },
    'SHA-512':    function (w) { return CryptoJS.SHA512(w).toString(); },
    'Keccak-256': function (w) { return CryptoJS.SHA3(w, { outputLength: 256 }).toString(); },
    'Keccak-512': function (w) { return CryptoJS.SHA3(w, { outputLength: 512 }).toString(); },
    'RIPEMD-160': function (w) { return CryptoJS.RIPEMD160(w).toString(); }
};

var SUFFIXES = ['!', '@', '#', '!!', '123', '1234', '2024', '2025'];

/**
 * Yield the candidate and its common mutations without building an array.
 * @param {string} word
 * @param {boolean} mutate
 */
function* candidates(word, mutate) {
    yield word;
    if (!mutate) return;

    var lower = word.toLowerCase();
    var upper = word.toUpperCase();
    var title = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    if (lower !== word) yield lower;
    if (upper !== word && upper !== lower) yield upper;
    if (title !== word && title !== lower && title !== upper) yield title;

    for (var i = 0; i <= 99; i++) yield word + i;
    for (var s = 0; s < SUFFIXES.length; s++) yield word + SUFFIXES[s];
}

self.onmessage = function (event) {
    var msg = event.data;
    if (!msg || msg.type !== 'run') return;

    var started = Date.now();
    var hash = ALGOS[msg.algorithm];
    try {
        if (!hash) throw new Error('Unsupported algorithm: ' + msg.algorithm);
        var target = String(msg.target).toLowerCase();
        var words = msg.words || [];
        var tested = 0;
        var lastReport = 0;

        for (var w = 0; w < words.length; w++) {
            var iterator = candidates(words[w], !!msg.mutate);
            var step;
            while (!(step = iterator.next()).done) {
                tested++;
                if (hash(step.value) === target) {
                    self.postMessage({
                        type: 'found', id: msg.id, word: step.value,
                        tested: tested, ms: Date.now() - started
                    });
                    return;
                }
                if ((tested & 1023) === 0) {
                    var now = Date.now();
                    if (now - lastReport > 120) {
                        lastReport = now;
                        self.postMessage({
                            type: 'progress', id: msg.id, tested: tested,
                            ms: now - started
                        });
                    }
                }
            }
        }

        self.postMessage({
            type: 'exhausted', id: msg.id, tested: tested, ms: Date.now() - started
        });
    } catch (err) {
        self.postMessage({
            type: 'error',
            id: msg.id,
            error: String(err && err.message ? err.message : err)
        });
    }
};
