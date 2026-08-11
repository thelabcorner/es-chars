// Native trimModern* differential: ESChars-cli.exe (#includes the exact
// eschars.c code) vs Node's modern String.prototype.trim/trimStart/trimEnd.
//
// Corpus: every codepoint in the strip set + the keep classes (U+180E,
// U+0085, U+200B) + multi-byte content + random mixes + edge cases.
// Excludes NUL (truncates the C-string channel, documented boundary) and
// lone surrogates (the UTF-8 byte channel replaces them with U+FFFD before
// the scanner can see them — documented boundary).
//
// Run: node tests/trim-differential.mjs
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXE = join(ROOT, "native", "bin", "ESChars-cli.exe");

const STRIP = [
  0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0,
  0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF
];
const KEEP = [0x180E, 0x0085, 0x200B];

const corpus = [];
const push = (s) => corpus.push(s);

push(""); push("abc"); push(" \t\r\n"); push("\u00A0"); push("\uFEFF");
push("\u3000abc\u3000"); push("\u2028\u2029abc\u202F");

for (const cp of STRIP) {
  const ch = String.fromCodePoint(cp);
  push(ch); push(ch + "abc"); push("abc" + ch); push(ch + "abc" + ch);
  push(ch.repeat(3) + "abc" + ch.repeat(2));
}
for (const cp of KEEP) {
  const ch = String.fromCodePoint(cp);
  push(ch + "abc" + ch);
  push(ch.repeat(2) + "abc" + ch.repeat(2));
}
push("\u0009\u000B\u000C\u0020\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFFabc");
push("abc\uFEFF\u3000\u205F\u202F\u2029\u2028\u200A\u2000\u1680\u00A0\u0020\u000C\u000B\u0009");
push("\u200B\u180E\u0085abc\u0085\u180E\u200B");

push("  \u4E2D\u6587\u5167\u5BB9  ");
push("  \u{1F600}\u{1F680}emoji  ");
push("\u00E9\u00E8\u00EA accent\u00E9\u00E8  ");
push("\uD83D\uDE00\uD83D\uDE80 abc \uD83D\uDE00\uD83D\uDE80");

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed / 0x7FFFFFFF; };
const pool = [...STRIP, ...KEEP, 0x41, 0x42, 0x7A, 0xE9, 0x4E2D, 0x1F600];
for (let i = 0; i < 200; i++) {
  let s = "";
  const n = Math.floor(rnd() * 12);
  for (let j = 0; j < n; j++) s += String.fromCodePoint(pool[Math.floor(rnd() * pool.length)]);
  push(s);
}

const utf8 = (s) => Buffer.from(s, "utf8");

function frame(bytes) {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}
function invokeCli(cmd, argBuffers) {
  const req = Buffer.concat([Buffer.from(cmd + "\n"), ...argBuffers.map(frame)]);
  const res = spawnSync(EXE, [], { input: req, maxBuffer: 64 * 1024 * 1024, encoding: null });
  if (res.status !== 0) throw new Error(`CLI exited ${res.status} for ${cmd}`);
  const tag = res.stdout[0];
  const payload = res.stdout.subarray(1, res.stdout.length - 1);
  if (tag === 0x53) {
    const len = payload.readUInt32LE(0);
    return Buffer.from(payload.subarray(4, 4 + len));
  }
  if (tag === 0x45) throw new Error(`native error ${payload.readInt32LE(0)} for ${cmd}`);
  throw new Error(`unexpected tag 0x${tag.toString(16)}`);
}

let pass = 0, fail = 0;
const fails = [];
function check(name, input, native, expected) {
  if (native.equals(expected)) { pass++; return; }
  fail++;
  if (fails.length < 12) {
    fails.push(`${name} input=${JSON.stringify(input)} native=${native.toString("hex")} want=${expected.toString("hex")}`);
  }
}

for (const input of corpus) {
  const inb = utf8(input);
  check("trim", input, invokeCli("trimModern", [inb]), utf8(input.trim()));
  check("trimStart", input, invokeCli("trimModernLeft", [inb]), utf8(input.trimStart()));
  check("trimEnd", input, invokeCli("trimModernRight", [inb]), utf8(input.trimEnd()));
  const lb = utf8(input.trimStart()).length;
  const rb = utf8(input.trimEnd()).length;
  const wantBounds = `${inb.length - lb},${Math.max(rb, inb.length - lb)}`;
  const got = invokeCli("trimModernBounds", [inb]).toString("utf8");
  if (got === wantBounds) pass++; else { fail++; fails.push(`bounds input=${JSON.stringify(input)} got=${got} want=${wantBounds}`); }
}

console.log(`[trim-differential] ${pass} passed, ${fail} failed (${corpus.length} corpus strings x 4 lanes)`);
for (const f of fails) console.log("  FAIL: " + f);
process.exit(fail ? 1 : 0);
