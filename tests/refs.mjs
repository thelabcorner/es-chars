// ESCHARS Node reference implementations — the pure-logic mirrors of the
// C in native/eschars.c. The differential harness compares the native CLI
// against these. All string ops are byte-oriented on UTF-8 bytes, exactly
// like the C side (ExtendScript hands the DLL UTF-8 bytes).
import { crc32 as nodeCrc32 } from "node:zlib";

// ---- byte helpers -------------------------------------------------------

export function utf8Bytes(s) {
  return Buffer.from(s, "utf8");
}

export function bytesToLatin1(b) {
  return Buffer.from(b).toString("latin1");
}

// ---- UTF-8 <-> UTF-16 code units (charCodeAt semantics) ----------------

// Decode UTF-8 bytes to an array of UTF-16 code units (surrogate pairs
// become 2 units, exactly like String.charCodeAt sees them).
export function unitsFromUtf8(b) {
  const out = [];
  let i = 0;
  while (i < b.length) {
    const c0 = b[i];
    let cp;
    let n;
    if (c0 < 0x80) { cp = c0; n = 1; }
    else if (c0 < 0xe0) { cp = ((c0 & 0x1f) << 6) | (b[i + 1] & 0x3f); n = 2; }
    else if (c0 < 0xf0) { cp = ((c0 & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f); n = 3; }
    else { cp = ((c0 & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f); n = 4; }
    if (cp > 0xffff) {
      const u = cp - 0x10000;
      out.push(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
    } else {
      out.push(cp);
    }
    i += n;
  }
  return out;
}

export function refCharCodeAt(s, index) {
  const units = unitsFromUtf8(utf8Bytes(s));
  return index >= 0 && index < units.length ? units[index] : NaN;
}

export function refFromCharCode(u) {
  if (u < 0 || u > 0xffff || (u >= 0xd800 && u <= 0xdfff)) {
    throw new Error("surrogate or out of range: " + u);
  }
  return String.fromCharCode(u);
}

// ---- base64 -------------------------------------------------------------

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function refB64Encode(s) {
  const b = utf8Bytes(s);
  const out = [];
  for (let i = 0; i < b.length; i += 3) {
    const v = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8) | (i + 2 < b.length ? b[i + 2] : 0);
    out.push(B64_ALPHABET[(v >> 18) & 63], B64_ALPHABET[(v >> 12) & 63]);
    out.push(i + 1 < b.length ? B64_ALPHABET[(v >> 6) & 63] : "=");
    out.push(i + 2 < b.length ? B64_ALPHABET[v & 63] : "=");
  }
  return out.join("");
}

export function refB64Decode(s) {
  // mirrors the C: trims trailing '=' / CR / LF, rejects length % 4 == 1
  // and non-alphabet characters; outputs raw bytes.
  let t = s.replace(/[=\r\n]+$/g, "");
  if (t.length % 4 === 1) throw new Error("invalid base64 length");
  const out = [];
  for (let i = 0; i + 4 <= t.length; i += 4) {
    const a = B64_ALPHABET.indexOf(t[i]);
    const b = B64_ALPHABET.indexOf(t[i + 1]);
    const c = B64_ALPHABET.indexOf(t[i + 2]);
    const d = B64_ALPHABET.indexOf(t[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("invalid base64 char");
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    out.push((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  }
  const rem = t.length % 4;
  if (rem === 2) {
    const a = B64_ALPHABET.indexOf(t[t.length - 2]);
    const b = B64_ALPHABET.indexOf(t[t.length - 1]);
    if (a < 0 || b < 0) throw new Error("invalid base64 char");
    out.push(((a << 18) | (b << 12)) >> 16);
  } else if (rem === 3) {
    const a = B64_ALPHABET.indexOf(t[t.length - 3]);
    const b = B64_ALPHABET.indexOf(t[t.length - 2]);
    const c = B64_ALPHABET.indexOf(t[t.length - 1]);
    if (a < 0 || b < 0 || c < 0) throw new Error("invalid base64 char");
    const v = (a << 18) | (b << 12) | (c << 6);
    out.push((v >> 16) & 0xff, (v >> 8) & 0xff);
  }
  return Buffer.from(out);
}

// ---- hex ----------------------------------------------------------------

export function refHexEncode(s) {
  return utf8Bytes(s).toString("hex");
}

export function refHexDecode(h) {
  if (typeof h !== "string" || h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) {
    throw new Error("bad hex");
  }
  return Buffer.from(h, "hex");
}

// ---- hashes -------------------------------------------------------------

export function refCrc32(s) {
  return nodeCrc32(utf8Bytes(s)) >>> 0;
}

export function refFnv1a32(s) {
  const b = utf8Bytes(s);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ---- packed channel -----------------------------------------------------

export function refPackBytes(s) {
  const b = utf8Bytes(s);
  const out = [];
  for (let i = 0; i + 1 < b.length; i += 2) {
    out.push(String.fromCharCode(b[i] | (b[i + 1] << 8)));
  }
  if (b.length % 2 === 1) {
    out.push(String.fromCharCode(b[b.length - 1]));
  }
  return out.join("");
}

export function refUnpackBytes(packed) {
  const out = [];
  for (let i = 0; i < packed.length; i++) {
    const cp = packed.charCodeAt(i);
    out.push(cp & 0xff);
    if (cp >= 0x100) out.push((cp >> 8) & 0xff);
  }
  return Buffer.from(out);
}

// Chunked units -> packed string (mirrors the JSX-side packed-write idiom:
// N/2 fromCharCode calls then one native unpackBytes). Chunking avoids the
// engine's argument-count limits on huge fromCharCode.apply calls.
export function unitsToPacked(units) {
  let out = "";
  const CHUNK = 8192;
  for (let i = 0; i < units.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, units.slice(i, i + CHUNK));
  }
  return out;
}

// ---- translate ----------------------------------------------------------

// tableHex: 512 hex chars -> 256 bytes; result[i] = table[input[i]].
export function refTranslate(s, tableHex) {
  if (typeof tableHex !== "string" || tableHex.length !== 512 || !/^[0-9a-fA-F]{512}$/.test(tableHex)) {
    throw new Error("bad table");
  }
  const tab = Buffer.from(tableHex, "hex");
  const b = utf8Bytes(s);
  const out = Buffer.alloc(b.length);
  for (let i = 0; i < b.length; i++) out[i] = tab[b[i]];
  return out;
}

// ---- table builders -----------------------------------------------------

export function identityTableHex() {
  const bytes = [];
  for (let i = 0; i < 256; i++) bytes.push(i);
  return Buffer.from(bytes).toString("hex");
}

export function rot13TableHex() {
  const bytes = [];
  for (let i = 0; i < 256; i++) {
    let v = i;
    if (i >= 97 && i <= 109) v = i + 13;
    else if (i >= 110 && i <= 122) v = i - 13;
    else if (i >= 65 && i <= 77) v = i + 13;
    else if (i >= 78 && i <= 90) v = i - 13;
    bytes.push(v);
  }
  return Buffer.from(bytes).toString("hex");
}
