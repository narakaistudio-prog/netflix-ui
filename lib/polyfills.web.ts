// @ts-nocheck
/**
 * Web-only runtime polyfills for old Smart TV browsers (Chromium 69).
 * Imported first in app/_layout.tsx. Keep dependency-free and ES5-style.
 */
(function installTvPolyfills() {
    var G = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {};
    if (typeof G.globalThis === 'undefined') {
        try { Object.defineProperty(G, 'globalThis', { configurable: true, enumerable: false, writable: true, value: G }); }
        catch (e) { try { G.globalThis = G; } catch (_) {} }
    }
    if (typeof G.queueMicrotask !== 'function') {
        G.queueMicrotask = function (cb) { G.Promise.resolve().then(cb).catch(function (err) { setTimeout(function () { throw err; }, 0); }); };
    }
    if (G.Array && !G.Array.prototype.flat) {
        G.Array.prototype.flat = function (depth) {
            var d = depth === undefined ? 1 : Number(depth);
            var flatten = function (arr, current) {
                var out = [];
                for (var i = 0; i < arr.length; i++) {
                    var v = arr[i];
                    if (current < d && Object.prototype.toString.call(v) === '[object Array]') { out = out.concat(flatten(v, current + 1)); }
                    else { out.push(v); }
                }
                return out;
            };
            return flatten(this, 0);
        };
    }
    if (G.Array && !G.Array.prototype.flatMap) {
        G.Array.prototype.flatMap = function (cb, thisArg) {
            var mapped = [];
            for (var i = 0; i < this.length; i++) { if (i in this) mapped.push(cb.call(thisArg, this[i], i, this)); }
            return mapped.reduce(function (acc, v) { return acc.concat(v); }, []);
        };
    }
    if (G.Array && !G.Array.prototype.at) {
        G.Array.prototype.at = function (index) { var i = Number(index); if (isNaN(i)) i = 0; if (i < 0) i = this.length + i; return this[i]; };
    }
    if (G.Object && !G.Object.fromEntries) {
        G.Object.fromEntries = function (entries) {
            var obj = {};
            var arr = G.Array.from ? G.Array.from(entries) : Array.prototype.slice.call(entries);
            for (var i = 0; i < arr.length; i++) obj[arr[i][0]] = arr[i][1];
            return obj;
        };
    }
    if (G.Object && !G.Object.hasOwn) {
        G.Object.hasOwn = function (obj, prop) { return Object.prototype.hasOwnProperty.call(Object(obj), prop); };
    }
    if (G.Promise && !G.Promise.prototype.finally) {
        G.Promise.prototype.finally = function (onFinally) {
            var C = this.constructor;
            var handler = typeof onFinally === 'function' ? onFinally : function () {};
            return this.then(
                function (value) { return C.resolve(handler()).then(function () { return value; }); },
                function (reason) { return C.resolve(handler()).then(function () { throw reason; }); }
            );
        };
    }
    if (G.Promise && !G.Promise.allSettled) {
        G.Promise.allSettled = function (promises) {
            var list = G.Array.from ? G.Array.from(promises) : Array.prototype.slice.call(promises);
            return G.Promise.all(list.map(function (p) {
                return G.Promise.resolve(p).then(
                    function (value) { return { status: 'fulfilled', value: value }; },
                    function (reason) { return { status: 'rejected', reason: reason }; }
                );
            }));
        };
    }
    if (G.String && !G.String.prototype.replaceAll) {
        G.String.prototype.replaceAll = function (search, replace) {
            if (search instanceof RegExp && !search.global) throw new TypeError('replaceAll must be called with a global RegExp');
            if (search instanceof RegExp) return this.replace(search, replace);
            return this.split(search).join(replace);
        };
    }
    if (G.String && !G.String.prototype.matchAll) {
        G.String.prototype.matchAll = function (regexp) {
            var re = regexp instanceof RegExp ? regexp : new RegExp(regexp, 'g');
            if (!re.global) throw new TypeError('matchAll must be called with a global RegExp');
            var clone = new RegExp(re.source, re.flags || 'g');
            var matches = [];
            var m = clone.exec(this);
            while (m) { matches.push(m); if (clone.lastIndex === m.index) clone.lastIndex++; m = clone.exec(this); }
            return matches;
        };
    }
})();
