/**
 * ESCHARS — native charCodeAt / fromCharCode + bulk byte-unit operations
 * for Adobe ExtendScript (ES3), backed by the ESChars ExternalObject DLL.
 *
 * Native-only library: every function requires the DLL (load() first).
 * There are deliberately NO pure-JS fallbacks — large-payload pure-JS
 * per-unit loops wedge the ExtendScript engine (measured: OK at 64 K,
 * hang at >= 128 K, restart required), so a "fallback" would be a trap.
 *
 * This source is written in an ES3-safe subset (var, function, no
 * getters/arrows/maps) and bundled by esbuild (ES5 target + shim) into
 * dist/ESCHARS.jsx defining the global `ESCHARS`.
 *
 * Channel rules (measured, Illustrator 30.6.0):
 *  - NUL truncates the string channel (payloads with U+0000 are cut).
 *  - Surrogate window 0xD800-0xDFFF cannot round-trip through the UTF-8
 *    boundary; arbitrary byte tables travel as 512-char hex (translate).
 */

/* Error contract (mirrors native codes; wrapper adds its own below 10000).
 * Native codes: kESErrBadArgumentList = 20; custom >= 10000
 * (10001 too large, 10002 surrogate, 10003 bad hex). Negative codes are
 * FATAL and uncatchable — never produced by the DLL. */
export var ERR = {
  /* wrapper-level */
  UNKNOWN: 0,
  NOT_LOADED: 1000,
  NOT_FOUND: 1001,
  UNSUPPORTED: 1002,
  BINDING: 1003,
  /* native-level (eschars.c ESCHARS_ERROR_BASE + n) */
  NATIVE_TOO_LARGE: 10001,
  NATIVE_SURROGATE: 10002,
  NATIVE_BAD_HEX: 10003
};

/* Public method surface of the DLL (order matters: critical methods
 * first — per-DLL binding is build-specific, see load()). */
export var LIVE_API = [
  "getVersion",
  "add",
  "charCodeAt",
  "fromCharCode",
  "packBytes",
  "unpackBytes",
  "hexEncode",
  "hexDecode",
  "crc32",
  "fnv1a32",
  "translate",
  "b64ToHex",
  "b64encode",
  "b64decode"
];

var cached: any = null;

function makeError(code: number, message: string): Error {
  var e = new Error(message);
  (e as any).number = code;
  return e;
}

/* ---- pure helpers (Node-testable; no ExtendScript globals) ---- */

/* Integer (possibly negative intval) -> unsigned 32-bit. */
export function toU32(n: number): number {
  return n >>> 0;
}

/* A translate table is exactly 512 hex chars (256 bytes). */
export function hexTableValid(t: string): boolean {
  var i: number, c: number;
  if (typeof t !== "string" || t.length !== 512) {
    return false;
  }
  for (i = 0; i < 512; i++) {
    c = t.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70))) {
      return false;
    }
  }
  return true;
}

/* Error code -> human text (used by tests and diagnostics). */
export function describeError(code: number): string {
  switch (code) {
    case ERR.NOT_LOADED: return "native DLL not loaded (call ESCHARS.load() first)";
    case ERR.NOT_FOUND: return "ESChars.dll not found / failed to load";
    case ERR.UNSUPPORTED: return "ExternalObject unavailable in this runtime";
    case ERR.BINDING: return "method not bound on this DLL build (per-DLL binding caveat)";
    case ERR.NATIVE_TOO_LARGE: return "native: input too large for the channel";
    case ERR.NATIVE_SURROGATE: return "native: lone surrogate cannot cross the UTF-8 boundary";
    case ERR.NATIVE_BAD_HEX: return "native: malformed hex input";
    case 20: return "native: bad argument list (kESErrBadArgumentList)";
    default: return "error " + code;
  }
}

/* ---- load / unload ---- */

function defaultDllName(): string {
  return "ESChars.dll";
}

/* Candidate absolute DLL paths derived from the running script location
 * plus the explicit opts.path. Returns unique forward-slash paths. */
export function candidatePaths(opts?: any): string[] {
  var out: string[] = [];
  var i: number, j: number;
  var dirs: string[] = [];
  var rels = ["", "native", "native/bin", "../native", "../native/bin"];
  var seen: any = {};

  if (opts && typeof opts.path === "string" && opts.path.length > 0) {
    out.push(opts.path);
    seen[opts.path] = 1;
  }
  try {
    if (typeof $ !== "undefined" && $.fileName) {
      var f = new File($.fileName);
      var dir = String(f.parent.fsName);
      if (dir.charAt(dir.length - 1) !== "/") {
        dir += "/";
      }
      dirs.push(dir);
    }
  } catch (ignore) {
    /* no $.fileName context (e.g. Node) */
  }
  for (i = 0; i < dirs.length; i++) {
    for (j = 0; j < rels.length; j++) {
      var base = rels[j] === "" ? dirs[i] : dirs[i] + rels[j] + "/";
      var p = base + defaultDllName();
      if (!seen[p]) {
        seen[p] = 1;
        out.push(p);
      }
    }
  }
  return out;
}

function verifyBindings(lib: any): any[] {
  var report: any[] = [];
  var i: number;
  for (i = 0; i < LIVE_API.length; i++) {
    report.push({ name: LIVE_API[i], ok: typeof lib[LIVE_API[i]] === "function" });
  }
  return report;
}

function hasCriticalBindings(report: any[]): boolean {
  var i: number;
  for (i = 0; i < report.length; i++) {
    if (!report[i].ok) {
      return false;
    }
  }
  return true;
}

/* Load the DLL (cached; idempotent). opts:
 *   path — absolute DLL path override (e.g. "C:/.../ESChars2.dll")
 * Returns the ExternalObject instance. Throws ERR.NOT_FOUND /
 * ERR.UNSUPPORTED / ERR.BINDING on failure (native-only: no fallback). */
export function load(opts?: any): any {
  if (cached) {
    return cached;
  }
  if (typeof ExternalObject === "undefined" || typeof ExternalObject.search !== "function") {
    throw makeError(ERR.UNSUPPORTED, describeError(ERR.UNSUPPORTED) + " (this runtime has no ExternalObject)");
  }
  var paths = candidatePaths(opts);
  var i: number;
  var lastErr: any = null;
  var bindingFailure: any = null;
  for (i = 0; i < paths.length; i++) {
    try {
      var lib = new ExternalObject("lib:" + paths[i]);
      if (lib && Number(lib.version) === 1) {
        var report = verifyBindings(lib);
        if (!hasCriticalBindings(report)) {
          bindingFailure = makeError(ERR.BINDING,
            "ESChars.dll loaded from " + paths[i] +
            " but some methods are not bound on this build (" +
            describeError(ERR.BINDING) + "): " + bindingReportText(report));
          break;
        }
        cached = lib;
        return lib;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (bindingFailure) {
    throw bindingFailure;
  }
  throw makeError(ERR.NOT_FOUND,
    "ESChars.dll not found or failed to load. Tried: " + paths.join(" | ") +
    (lastErr ? " (last error: " + String(lastErr) + ")" : "") +
    ". Build it with: powershell -File native/build.ps1");
}

export function bindingReportText(report: any[]): string {
  var bad: string[] = [];
  var i: number;
  for (i = 0; i < report.length; i++) {
    if (!report[i].ok) {
      bad.push(report[i].name);
    }
  }
  return bad.length === 0 ? "all bound" : "missing: " + bad.join(",");
}

export function isLoaded(): boolean {
  return cached !== null;
}

export function unload(): void {
  if (cached) {
    try {
      cached.unload();
    } catch (ignore) {
      /* already terminated */
    }
    cached = null;
  }
}

/* ---- internal call plumbing ---- */

function requireLoaded(): any {
  if (cached) {
    return cached;
  }
  throw makeError(ERR.NOT_LOADED, describeError(ERR.NOT_LOADED));
}

function mapError(e: any, name: string): Error {
  var num: number = e && typeof e.number === "number" ? e.number : 0;
  var msg: string = e && e.message ? String(e.message) : String(e);
  return makeError(num, "ESCHARS." + name + " failed (" + msg + ")");
}

function call(name: string, args: any[]): any {
  var lib = requireLoaded();
  var fn: any = lib[name];
  if (typeof fn !== "function") {
    throw makeError(ERR.BINDING,
      "ESCHARS." + name + ": " + describeError(ERR.BINDING) +
      " (rebuild with a fresh DLL file name and re-probe)");
  }
  try {
    return fn.apply(lib, args);
  } catch (e) {
    throw mapError(e, name);
  }
}

/* ---- per-call API (parity expected with the engine primitive ~1 us/call;
        the win is the batch surface — benchmark before trusting this lane) ---- */

/* String.charCodeAt polyfill: UTF-16 code unit at index i; NaN out of
 * range (native -1 sentinel mapped back). Surrogate pairs count as 2
 * units, exactly like the engine primitive. */
export function charCodeAt(s: string, i: number): number {
  if (typeof s !== "string") {
    throw makeError(ERR.UNKNOWN, "ESCHARS.charCodeAt: string expected");
  }
  var v = Number(call("charCodeAt", [s, i]));
  return v === -1 ? NaN : v;
}

/* String.fromCharCode polyfill: single code unit -> string. Lone
 * surrogates (0xD800-0xDFFF) cannot cross the UTF-8 boundary and throw
 * ERR.NATIVE_SURROGATE (the engine primitive accepts them; this channel
 * cannot). */
export function fromCharCode(u: number): string {
  if (typeof u !== "number" || isNaN(u) || u < 0 || u > 0xFFFF) {
    throw makeError(ERR.UNKNOWN, "ESCHARS.fromCharCode: code unit 0..0xFFFF expected");
  }
  return String(call("fromCharCode", [u]));
}

/* ---- bulk channel (the 2-bytes-per-char read/write win) ---- */

/* packBytes(s): each char of the result packs TWO input bytes
 * (b0 | b1<<8); JSX then reads N units with N/2 charCodeAt + arithmetic
 * (measured ~1.75x reads). Input must be byte-oriented ASCII/Latin-1;
 * pairs whose second byte would be 0xD8-0xDF are unsafe (surrogate
 * window) — use hexEncode for arbitrary bytes. */
export function packBytes(s: string): string {
  return String(call("packBytes", [s]));
}

/* unpackBytes(packed): the inverse — the bulk fromCharCode replacement
 * (measured ~3.7x writes: N/2 fromCharCode + one native call). */
export function unpackBytes(packed: string): string {
  return String(call("unpackBytes", [packed]));
}

/* ---- whole-workload-native transforms ---- */

export function b64encode(s: string): string {
  return String(call("b64encode", [s]));
}

export function b64decode(s: string): string {
  return String(call("b64decode", [s]));
}

export function hexEncode(s: string): string {
  return String(call("hexEncode", [s]));
}

export function hexDecode(h: string): string {
  return String(call("hexDecode", [h]));
}

/* IEEE CRC-32, unsigned 32-bit. */
export function crc32(s: string): number {
  return toU32(Number(call("crc32", [s])));
}

/* FNV-1a 32-bit, unsigned 32-bit. */
export function fnv1a32(s: string): number {
  return toU32(Number(call("fnv1a32", [s])));
}

/* Per-byte table transform. hexTable is exactly 512 hex chars = 256
 * bytes (the only safe arbitrary-byte transport through the UTF-8
 * boundary); result[i] = table[input[i]]. */
export function translate(s: string, hexTable: string): string {
  if (!hexTableValid(hexTable)) {
    throw makeError(ERR.NATIVE_BAD_HEX, "ESCHARS.translate: table must be 512 hex chars");
  }
  return String(call("translate", [s, hexTable]));
}

/* base64 decode + hex encode in ONE boundary crossing (chain fixed
 * pipelines native-side to amortize the ~7 us/KB crossing). */
export function b64ToHex(s: string): string {
  return String(call("b64ToHex", [s]));
}

/* ---- diagnostics ---- */

export function bindings(): any[] {
  if (!cached) {
    return [];
  }
  return verifyBindings(cached);
}

export function version(): string {
  return String(call("getVersion", []));
}
