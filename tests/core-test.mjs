// ESCHARS core test: Node reference implementations vs the vector corpus.
// Pure Node — no C, no Illustrator. Validates the reference logic that the
// differential harness and the live probe are measured against.
import assert from "node:assert/strict";
import {
  refB64Encode, refB64Decode, refHexEncode, refHexDecode, refCrc32, refFnv1a32,
  refPackBytes, refUnpackBytes, refTranslate, refCharCodeAt, refFromCharCode,
  unitsFromUtf8, identityTableHex, rot13TableHex
} from "./refs.mjs";
import { VECTORS } from "./vectors.mjs";

const TABLE_HEX = { identity: identityTableHex(), rot13: rot13TableHex() };

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

for (const v of VECTORS) {
  try {
    switch (v.cmd) {
      case "b64encode":
        ok(refB64Encode(v.input) === v.expectB64, v.name, v.why, `got ${refB64Encode(v.input)}`);
        break;
      case "b64decode":
        ok(refB64Decode(v.input).equals(v.expectBytes), v.name, v.why);
        break;
      case "hexEncode":
        ok(refHexEncode(v.input) === v.expectHex, v.name, v.why, `got ${refHexEncode(v.input)}`);
        break;
      case "hexDecode":
        ok(refHexDecode(v.input).equals(v.expectBytes), v.name, v.why);
        break;
      case "crc32":
        ok(refCrc32(v.input) === v.expectU32, v.name, v.why, `got 0x${refCrc32(v.input).toString(16)}`);
        break;
      case "fnv1a32":
        ok(refFnv1a32(v.input) === v.expectU32, v.name, v.why, `got 0x${refFnv1a32(v.input).toString(16)}`);
        break;
      case "packBytes": {
        const packed = refPackBytes(v.input);
        ok(JSON.stringify(unitsFromUtf8(Buffer.from(packed, "utf8"))) === JSON.stringify(v.expectPackedUnits),
          v.name, v.why, `got ${JSON.stringify(unitsFromUtf8(Buffer.from(packed, "utf8")))}`);
        break;
      }
      case "unpackBytes": {
        const packedStr = String.fromCharCode(...v.inputPacked);
        ok(refUnpackBytes(packedStr).equals(v.expectBytes), v.name, v.why);
        break;
      }
      case "translate": {
        const table = v.tableOverride !== undefined ? v.tableOverride : TABLE_HEX[v.table];
        const got = refTranslate(v.input, table);
        if (v.expectError !== undefined) {
          ok(false, v.name, v.why, "expected error but ref succeeded");
        } else {
          ok(got.equals(v.expectBytes), v.name, v.why);
        }
        break;
      }
      case "b64ToHex": {
        const bytes = refB64Decode(v.input);
        ok(bytes.toString("hex") === v.expectHex, v.name, v.why, `got ${bytes.toString("hex")}`);
        break;
      }
      case "charCodeAt": {
        const got = refCharCodeAt(v.input, v.index);
        ok(Object.is(got, v.expectUnit) || (got !== got && v.expectUnit !== v.expectUnit), v.name, v.why, `got ${got}`);
        break;
      }
      case "fromCharCode": {
        if (v.expectError !== undefined) {
          let threw = false;
          try { refFromCharCode(v.unit); } catch (e) { threw = true; }
          ok(threw, v.name, v.why);
        } else {
          ok(refFromCharCode(v.unit) === v.expectChar, v.name, v.why);
        }
        break;
      }
      default:
        ok(false, v.name, "unknown command " + v.cmd);
    }
  } catch (e) {
    if (v.expectError !== undefined) {
      // The ref throwing IS the expected behavior (C returns an error code,
      // the ref throws) — except translate-badtable/fromCharCode-surrogate
      // which are also covered by the explicit checks above.
      ok(true, v.name, v.why + " (ref threw as expected)");
    } else {
      ok(false, v.name, v.why, "ref threw: " + e.message);
    }
  }
}

console.log(`[eschars core-test] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
