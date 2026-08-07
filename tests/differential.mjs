// ESCHARS differential test: the native C (compiled into ESChars-cli.exe)
// vs the Node reference implementations, over the vector corpus plus
// large (360K / 1M) inputs. No Illustrator required.
//
// The CLI shares the exact production code paths with the DLL
// (eschars-cli.c #includes eschars.c), so byte-exact equality here is
// evidence the DLL's methods compute correctly.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  refB64Encode, refB64Decode, refHexEncode, refCrc32, refFnv1a32, refPackBytes, refUnpackBytes,
  refTranslate, unitsFromUtf8, unitsToPacked, identityTableHex, rot13TableHex
} from "./refs.mjs";
import { VECTORS, LARGE_CASES } from "./vectors.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXE = join(ROOT, "native", "bin", "ESChars-cli.exe");

function ensureCli() {
  if (existsSync(EXE)) return;
  const ps = spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", "native/build.ps1", "-Cli"], {
    cwd: ROOT, stdio: "inherit"
  });
  if (ps.status !== 0) {
    throw new Error("failed to build ESChars-cli.exe (MSVC Build Tools required). Build output above.");
  }
}

// ---- frame protocol client ----

function frame(bytes) {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

function invokeCli(cmd, argBuffers) {
  const req = Buffer.concat([Buffer.from(cmd + "\n"), ...argBuffers.map(frame)]);
  const res = spawnSync(EXE, [], { input: req, maxBuffer: 256 * 1024 * 1024, encoding: null });
  if (res.status !== 0) {
    throw new Error(`CLI exited ${res.status} for ${cmd}: ${res.stderr?.toString() || ""}`);
  }
  const raw = res.stdout;
  // response: [tag][payload][\n]
  const tag = raw[0];
  const payload = raw.subarray(1, raw.length - 1);
  if (tag === 0x53 /* S */) {
    const len = payload.readUInt32LE(0);
    return { kind: "S", bytes: payload.subarray(4, 4 + len) };
  }
  if (tag === 0x49 /* I */) {
    return { kind: "I", value: payload.readInt32LE(0) };
  }
  if (tag === 0x45 /* E */) {
    return { kind: "E", code: payload.readInt32LE(0) };
  }
  throw new Error(`unexpected response tag 0x${tag.toString(16)} for ${cmd}`);
}

const utf8 = (s) => Buffer.from(s, "utf8");
const ascii = (s) => Buffer.from(s, "ascii");

function buildArgs(v) {
  switch (v.cmd) {
    case "b64encode": return [utf8(v.input)];
    case "b64decode": return [ascii(v.input)];
    case "hexEncode": return [utf8(v.input)];
    case "hexDecode": return [ascii(v.input)];
    case "crc32":
    case "fnv1a32": return [utf8(v.input)];
    case "packBytes": return [utf8(v.input)];
    case "unpackBytes": return [utf8(String.fromCharCode(...v.inputPacked))];
    case "translate": {
      const table = v.tableOverride !== undefined ? v.tableOverride : (v.table === "identity" ? identityTableHex() : rot13TableHex());
      return [utf8(v.input), ascii(table)];
    }
    case "b64ToHex": return [ascii(v.input)];
    case "charCodeAt": return [utf8(v.input), ascii(String(v.index))];
    case "fromCharCode": return [ascii(String(v.unit))];
    default: throw new Error("unknown cmd " + v.cmd);
  }
}

let pass = 0;
let fail = 0;

function ok(cond, name, why, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL ${name}: ${why}${detail ? " — " + detail : ""}`);
  }
}

function compareExpected(v, res) {
  if (res.kind === "E") {
    ok(v.expectError !== undefined && res.code === v.expectError, v.name, v.why,
      `native error ${res.code}${v.expectError !== undefined ? ", expected " + v.expectError : " (unexpected)"}`);
    return;
  }
  if (v.expectError !== undefined) {
    ok(false, v.name, v.why, "expected native error but got result");
    return;
  }
  switch (v.cmd) {
    case "b64encode":
      ok(res.bytes.toString("ascii") === v.expectB64, v.name, v.why, `got ${res.bytes.toString("ascii")}`);
      break;
    case "b64decode":
    case "hexDecode":
      ok(res.bytes.equals(v.expectBytes), v.name, v.why);
      break;
    case "hexEncode":
    case "b64ToHex":
      ok(res.bytes.toString("ascii") === v.expectHex, v.name, v.why, `got ${res.bytes.toString("ascii")}`);
      break;
    case "crc32":
    case "fnv1a32":
      ok((res.value >>> 0) === v.expectU32, v.name, v.why, `got 0x${(res.value >>> 0).toString(16)}`);
      break;
    case "packBytes": {
      const units = unitsFromUtf8(res.bytes);
      ok(JSON.stringify(units) === JSON.stringify(v.expectPackedUnits), v.name, v.why,
        `got ${JSON.stringify(units)}`);
      break;
    }
    case "unpackBytes":
      ok(res.bytes.equals(v.expectBytes), v.name, v.why);
      break;
    case "translate":
      ok(res.bytes.equals(v.expectBytes), v.name, v.why);
      break;
    case "charCodeAt":
      if (v.expectUnit !== v.expectUnit) {
        ok(res.value === -1, v.name, v.why, `got ${res.value} (wrapper maps -1 to NaN)`);
      } else {
        ok(res.value === v.expectUnit, v.name, v.why, `got ${res.value}`);
      }
      break;
    case "fromCharCode": {
      const s = res.bytes.toString("utf8");
      ok(s === v.expectChar, v.name, v.why, `got "${s}"`);
      break;
    }
    default:
      ok(false, v.name, "unknown cmd " + v.cmd);
  }
}

// ---- main ----

ensureCli();

for (const v of VECTORS) {
  let res;
  try {
    res = invokeCli(v.cmd, buildArgs(v));
  } catch (e) {
    ok(false, v.name, v.why, e.message);
    continue;
  }
  compareExpected(v, res);
}

// Large cases: native vs refs at 360K / 1M (byte-exact, the MB-scale proof).
for (const c of LARGE_CASES) {
  const inputBytes = utf8(c.input);
  const b64 = refB64Encode(c.input);
  const lanes = [
    ["b64encode", inputBytes, utf8(b64)],
    ["hexEncode", inputBytes, utf8(refHexEncode(c.input))],
    ["crc32", inputBytes, refCrc32(c.input)],
    ["fnv1a32", inputBytes, refFnv1a32(c.input)],
    ["packBytes", inputBytes, null],
    ["b64ToHex", ascii(b64), utf8(Buffer.from(refB64Decode(b64)).toString("hex"))]
  ];
  for (const [cmd, inBuf, expect] of lanes) {
    let res;
    try {
      res = invokeCli(cmd, [inBuf]);
    } catch (e) {
      ok(false, `${cmd}@${c.name}`, "large lane", e.message);
      continue;
    }
    if (res.kind === "E") {
      ok(false, `${cmd}@${c.name}`, "large lane", `native error ${res.code}`);
      continue;
    }
    if (cmd === "packBytes") {
      // round trip: native pack -> (decode UTF-8 units) -> refUnpackBytes
      // must restore the exact input bytes
      const units = unitsFromUtf8(res.bytes);
      const back = refUnpackBytes(unitsToPacked(units));
      ok(back.equals(inputBytes), `packBytes@${c.name}`, "large pack/unpack round trip",
        `got ${back.length} bytes, expected ${inputBytes.length}`);
      continue;
    }
    if (cmd === "crc32" || cmd === "fnv1a32") {
      ok((res.value >>> 0) === expect, `${cmd}@${c.name}`, "large lane integer vs ref",
        `got 0x${(res.value >>> 0).toString(16)}, expected 0x${expect.toString(16)}`);
      continue;
    }
    ok(res.bytes.equals(expect), `${cmd}@${c.name}`, "large lane byte-exact vs ref");
  }
}

console.log(`[eschars differential] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
