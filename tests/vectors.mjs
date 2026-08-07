// ESCHARS test corpus — shared by core-test.mjs (refs vs vectors) and
// differential.mjs (native CLI vs refs). Every entry carries a `why` so
// failures point at the intended behavior.
import { rot13TableHex } from "./refs.mjs";

export const VECTORS = [
  { name: "b64-empty", why: "empty input", cmd: "b64encode", input: "", expectB64: "" },
  { name: "b64-man", why: "RFC 4648 vector", cmd: "b64encode", input: "Man", expectB64: "TWFu" },
  { name: "b64-hello", why: "hello vector", cmd: "b64encode", input: "hello", expectB64: "aGVsbG8=" },
  { name: "b64-1byte", why: "odd single byte", cmd: "b64encode", input: "a", expectB64: "YQ==" },
  { name: "b64-2byte", why: "two bytes", cmd: "b64encode", input: "ab", expectB64: "YWI=" },
  { name: "b64-utf8-nonascii", why: "UTF-8 multi-byte input (héllo wörld)", cmd: "b64encode", input: "h\u00e9llo w\u00f6rld", expectB64: "aMOpbGxvIHfDtnJsZA==" },
  { name: "b64-utf8-emoji", why: "4-byte UTF-8 (surrogate pair) input", cmd: "b64encode", input: "\ud83d\ude00", expectB64: "8J+YgA==" },
  { name: "b64decode-hello", why: "decode vector", cmd: "b64decode", input: "aGVsbG8=", expectBytes: Buffer.from("hello", "utf8") },
  { name: "b64decode-nopad", why: "tolerates missing padding", cmd: "b64decode", input: "aGVsbG8", expectBytes: Buffer.from("hello", "utf8") },
  { name: "b64decode-ws", why: "trailing newline tolerated", cmd: "b64decode", input: "aGVsbG8=\n", expectBytes: Buffer.from("hello", "utf8") },
  { name: "b64decode-binary", why: "binary payload decode", cmd: "b64decode", input: "AP8A/+A=", expectBytes: Buffer.from([0x00, 0xff, 0x00, 0xff, 0xe0]) },
  { name: "hexEncode-empty", why: "empty input", cmd: "hexEncode", input: "", expectHex: "" },
  { name: "hexEncode-ascii", why: "ASCII", cmd: "hexEncode", input: "hello", expectHex: "68656c6c6f" },
  { name: "hexEncode-utf8", why: "UTF-8 bytes hexed", cmd: "hexEncode", input: "\u00e9", expectHex: "c3a9" },
  { name: "hexDecode-ascii", why: "round trip", cmd: "hexDecode", input: "68656c6c6f", expectBytes: Buffer.from("hello", "utf8") },
  { name: "hexDecode-upper", why: "uppercase accepted", cmd: "hexDecode", input: "68656C6C6F", expectBytes: Buffer.from("hello", "utf8") },
  { name: "hexDecode-binary", why: "binary hex decode", cmd: "hexDecode", input: "00ff00ffe0", expectBytes: Buffer.from([0x00, 0xff, 0x00, 0xff, 0xe0]) },
  { name: "crc32-empty", why: "CRC-32 of empty = 0x00000000", cmd: "crc32", input: "", expectU32: 0x00000000 },
  { name: "crc32-vector", why: "check value 0xCBF43926", cmd: "crc32", input: "123456789", expectU32: 0xcbf43926 },
  { name: "crc32-utf8", why: "non-ASCII input", cmd: "crc32", input: "\u00e9\u00f6", expectU32: 0x51c06a2f },
  { name: "fnv1a-empty", why: "FNV-1a offset basis", cmd: "fnv1a32", input: "", expectU32: 0x811c9dc5 },
  { name: "fnv1a-abc", why: "canonical FNV-1a vector (BigInt-verified; note: the ArcFitEso prototype README claimed 0x1a47a1cb — wrong, algorithm matches the FNV spec + 'a'=0xe40c292c and 'foobar'=0xbf9cf968)", cmd: "fnv1a32", input: "abc", expectU32: 0x1a47e90b },
  { name: "fnv1a-utf8", why: "non-ASCII input", cmd: "fnv1a32", input: "h\u00e9llo", expectU32: 0x4aa48540 },
  { name: "pack-even", why: "even byte count packs N/2 chars", cmd: "packBytes", input: "hello", expectPackedUnits: [0x6568, 0x6c6c, 0x006f] },
  { name: "pack-odd", why: "odd byte count packs last byte alone", cmd: "packBytes", input: "hell", expectPackedUnits: [0x6568, 0x6c6c] },
  { name: "pack-utf8", why: "UTF-8 bytes packed as bytes (b0 | b1<<8: c3|a9<<8 = 0xa9c3)", cmd: "packBytes", input: "\u00e9x", expectPackedUnits: [0xa9c3, 0x0078] },
  { name: "unpack-even", why: "packed round trip", cmd: "unpackBytes", inputPacked: [0x6568, 0x6c6c, 0x006f], expectBytes: Buffer.from("hello", "utf8") },
  { name: "unpack-odd", why: "packed odd round trip", cmd: "unpackBytes", inputPacked: [0x6568, 0x6c6c], expectBytes: Buffer.from("hell", "utf8") },
  { name: "unpack-highbyte", why: "high byte extracted (low byte emitted first)", cmd: "unpackBytes", inputPacked: [0x11ff], expectBytes: Buffer.from([0xff, 0x11]) },
  { name: "translate-identity", why: "identity table passes through", cmd: "translate", input: "hello \u00e9", table: "identity", expectBytes: Buffer.from("hello \u00e9", "utf8") },
  { name: "translate-rot13", why: "rot13 table", cmd: "translate", input: "Hello, World! 123", table: "rot13", expectBytes: Buffer.from("Uryyb, Jbeyq! 123", "utf8") },
  { name: "b64ToHex-hello", why: "chained decode+encode in one call", cmd: "b64ToHex", input: "aGVsbG8=", expectHex: "68656c6c6f" },
  { name: "b64ToHex-binary", why: "binary through the chain", cmd: "b64ToHex", input: "AP8A/+A=", expectHex: "00ff00ffe0" },
  { name: "charCodeAt-basic", why: "per-call units", cmd: "charCodeAt", input: "hello", index: 1, expectUnit: 101 },
  { name: "charCodeAt-surrogate-hi", why: "high surrogate unit", cmd: "charCodeAt", input: "\ud83d\ude00", index: 0, expectUnit: 0xd83d },
  { name: "charCodeAt-surrogate-lo", why: "low surrogate unit", cmd: "charCodeAt", input: "\ud83d\ude00", index: 1, expectUnit: 0xde00 },
  { name: "charCodeAt-nonascii", why: "UTF-8 multi-byte unit", cmd: "charCodeAt", input: "h\u00e9llo", index: 1, expectUnit: 0xe9 },
  { name: "charCodeAt-oob", why: "out of range: ref=NaN (JS semantics), DLL sentinel -1 mapped by wrapper", cmd: "charCodeAt", input: "hello", index: 5, expectUnit: NaN },
  { name: "fromCharCode-ascii", why: "unit to string", cmd: "fromCharCode", unit: 97, expectChar: "a" },
  { name: "fromCharCode-nonascii", why: "two-byte UTF-8", cmd: "fromCharCode", unit: 0xe9, expectChar: "\u00e9" },
  { name: "fromCharCode-3byte", why: "three-byte UTF-8", cmd: "fromCharCode", unit: 0x4e2d, expectChar: "\u4e2d" },
  { name: "fromCharCode-surrogate", why: "lone surrogate rejected (ERR 10002)", cmd: "fromCharCode", unit: 0xd800, expectError: 10002 },
  { name: "hexDecode-odd", why: "odd hex rejected (ERR 10003)", cmd: "hexDecode", input: "abc", expectError: 10003 },
  { name: "hexDecode-badchar", why: "non-hex rejected (ERR 10003)", cmd: "hexDecode", input: "0z", expectError: 10003 },
  { name: "b64decode-badlen", why: "length % 4 == 1 rejected (ERR 20)", cmd: "b64decode", input: "a", expectError: 20 },
  { name: "b64decode-badchar", why: "non-alphabet rejected (ERR 20)", cmd: "b64decode", input: "aGVs!G8=", expectError: 20 },
  { name: "translate-badtable", why: "short table rejected (ERR 10003)", cmd: "translate", input: "x", table: "rot13", tableOverride: "00", expectError: 10003 },
  { name: "fnv1a-esc", why: "control byte in input", cmd: "fnv1a32", input: "\u001b", expectU32: 0x1e0c847a },
  { name: "crc32-78ch", why: "78-char anchor", cmd: "crc32", input: "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789", expectU32: 0x458dfc4a }
];

// Deterministic large inputs (no Math.random — reproducible).
export function asciiChunk(n) {
  const chars = [];
  for (let i = 0; i < n; i++) chars.push(String.fromCharCode(97 + (i % 26)));
  return chars.join("");
}

export function utf8Chunk(n) {
  const chars = [];
  for (let i = 0; i < n; i++) chars.push(i % 2 === 0 ? "\u00e9" : "x");
  return chars.join("");
}

export const LARGE_CASES = [
  { name: "360K ascii", input: asciiChunk(360000) },
  { name: "360K utf8", input: utf8Chunk(180000) },
  { name: "1M ascii", input: asciiChunk(1000000) },
  { name: "1M utf8", input: utf8Chunk(500000) }
];

export function rot13TableHexFor(caseName) {
  void caseName;
  return rot13TableHex();
}
