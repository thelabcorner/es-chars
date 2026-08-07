<div align="center">

# ESCHARS: Native charCodeAt + Bulk Byte/Unit Operations for Adobe ExtendScript (ES3)

## ExtendScript charCodeAt = E.S.CHARS

### The drop-in native speed library for byte-unit work in Adobe Illustrator, InDesign, Photoshop & any ExtendScript host

[![Engine: ES3](https://img.shields.io/badge/ExtendScript-ES3-green)](#compatibility)
[![Native: x64 Windows](https://img.shields.io/badge/native-x64%20Windows-blue)](#build)
[![Boundary: ~7 us/KB](https://img.shields.io/badge/boundary~%7C%7C~7%20us%2FKB-orange)](#whole-workload-native-transforms)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL%203.0--or--later-blue)](https://www.gnu.org/licenses/gpl-3.0.html)

</div>

---

> **From the same team: [ESON](https://github.com/thelabcorner/eson) — strict JSON for ExtendScript, [ESB64](https://github.com/thelabcorner/es-b64) — WHATWG base64 + UTF-8, [ArcFit.dev](https://arcfit.dev) — deterministic arc warp for Illustrator.**

---

## Why ESCHARS?

**ExtendScript's `charCodeAt` costs ~0.95 µs/unit — and the per-unit transform pattern (`charCodeAt` + `push`/`join`/`fromCharCode`) wedges the engine at >= 128 K input** (reproduced twice; 64 K completes, 128 K hangs, restart required; measured live on Illustrator 30.6.0, COM `DoJavaScript`, `$.hiresTimer` medians of 3–7 runs). Every script that does bulk byte or unit work — base64, hex, CRC, geometry hashing, binary job files — either hand-rolls a codec (slow, easy to get wrong) or injects a polyfill. ESCHARS moves the work native-side through a live-verified `ExternalObject` DLL and a thin ES3 JSX wrapper, turning the pathological case into a non-issue.

The library is **native-only with a hard failure if the DLL is missing** — there are deliberately **no pure-JS fallbacks**, because the wedge makes large-payload fallback impossible (a "fallback" for >= 128 K would be a trap). For small payloads the engine primitive is already ~1 µs/call; the wins are the batch/packed channel and the whole-workload-native transforms.

## Performance (live, Illustrator 30.6.0, median µs)

| Lane | 16 K units | 64 K | 360 K | 1 M |
|---|---|---|---|---|
| Pure-JS `charCodeAt` sum loop | 11,930 | 47,703 | **wedges >= 128 K (restart)** | — |
| `split('')` + `charCodeAt(0)` | 21,267 | — | — | — |
| **`packBytes` + N/2 `charCodeAt` (bulk read)** | **6,820 (1.75x)** | **27,099 (1.76x)** | **150,858 — runs fine** | — |
| Pure-JS write (`fromCharCode` + push/join) | 437,861 | — | — | — |
| **Packed write (N/2 `fromCharCode` + `unpackBytes`)** | **117,386 (3.7x)** | — | — | — |
| Per-call native `charCodeAt` (parity lane) | ~16,000 | — | — | — |

**The bulk winner is the packed 2-bytes-per-char channel** (`packBytes`/`unpackBytes`): consistent ~1.75x on per-unit reads, ~3.7x on per-unit writes, and the only non-wedging per-unit option at 360 K. Caveat: packing is byte-oriented (units 0–255); pairs whose second byte would be 0xD8–0xDF hit the UTF-8 surrogate window — guaranteed safe for ASCII/Latin-1 inputs. Full 16-bit units stay 1:1 (chars are 16-bit).

### Whole-workload-native transforms

When the transform itself can move native, per-unit JSX disappears entirely — the biggest wins.

| Lane | Native | Pure JSX | Speedup |
|---|---|---|---|
| `hexEncode` 16 K | 136 µs | 1,621,941 µs (1.6 s!) | **11,900x** |
| `translate` rot13 16 K | 92 µs | 442,478 µs | **4,800x** |
| `hexEncode` 360 K | 3,346 µs | wedges >= 128 K | — |
| `translate` rot13 360 K | 2,234 µs | — | — |
| `crc32` 360 K | 1,794 µs | — | — |
| `b64ToHex` (chained, 1 call) 360 K | 6,241 µs | — | — |
| `b64encode` 1 K / 16 K / 64 K / 360 K / 1 M | 23 / 105 / 393 / 2,382 / 7,562 µs | — | — |

**Boundary overhead is ~7 µs/KB and nearly perfectly linear** (5-point curve, 1 K → 1 M) — the string channel is not the bottleneck; MB-scale payloads are safe (1 MB base64 in 7.6 ms). The pure-JS per-unit transform pattern is the engine's pathological case: 1.6 s at just 16 K, wedge at >= 128 K — the native versions run 4,800–11,900x faster *and* remove the wedge entirely.

**Channel rules (measured):**
- **NUL truncates**: the string channel is C-null-terminated — payloads containing U+0000 are cut at the first NUL. Keep byte payloads NUL-free or use the staged/length protocol (see "Follow-ups").
- **Surrogate window**: packed values 0xD800–0xDFFF cannot round-trip (UTF-8 cannot encode lone surrogates). ASCII/Latin-1 data is safe; for arbitrary byte tables use the **hex transport** (512 hex chars for a 256-byte table — `translate` takes exactly this).
- **Pipeline in one call**: `b64ToHex` does decode+encode in one boundary crossing (6.2 ms vs two calls ~8.7 ms at 360 K); chain transforms native-side when the pipeline is fixed.

## Features

- **Per-call native `charCodeAt`/`fromCharCode`**: ~1 µs/call parity with the engine primitive — useful when you need unit access without the batch API; benchmark before trusting as a speed path (the win is the batch surface).
- **Bulk packed channel** (`packBytes`/`unpackBytes`): 2-bytes-per-char read/write, the only non-wedging per-unit path at 360 K.
- **Whole-workload-native transforms**: `b64encode`/`b64decode`, `hexEncode`/`hexDecode`, IEEE CRC-32, FNV-1a 32-bit, arbitrary-byte `translate` (256-byte lookup table), and the `b64ToHex` chain.
- **ES3-clean wrapper**: feature-detected load-by-absolute-path with `searchFolders` prepend, per-DLL binding verification, typed error mapping (`Error #` → error codes), native-only hard failure.
- **Node differential tests**: the native C is compiled into a console harness (`ESChars-cli.exe`) sharing the *exact* production code paths (the DLL source is `#include`d), and byte-exact differential-tested against Node reference implementations over a 49-vector corpus plus 360 K / 1 M lanes — no Illustrator required.
- **Live probes**: smoke + microbenchmark run inside the real engine via COM (`probes/`).
- **No runtime dependencies**: the production bundle is one file.

## Which build should you use?

| | **JSX bundle** | **DLL** |
|---|---|---|
| Files | `dist/ESCHARS.jsx` | `native/bin/ESChars.dll` |
| Size | ~8 KB (wrapper) | ~20 KB (native) |
| What it is | The ES3 wrapper facade + ES3 shims | The native ExternalObject DLL |
| Required by | Your `.jsx` scripts | Resolved by the wrapper at runtime |

The DLL must be loadable from the host (placed beside the script, on `ExternalObject.searchFolders`, or loaded by absolute path — the wrapper tries all of these). The JSX bundle `evalFile`s the wrapper and calls `ESCHARS.load()`.

## API

```jsx
// load (cached; idempotent) — throws if the DLL is missing (native-only)
ESCHARS.load();
ESCHARS.isLoaded();   // bool
ESCHARS.version();    // "ESChars 1.0.0 ..."
ESCHARS.bindings();   // [{ name, ok }] per-method binding report
ESCHARS.unload();

// per-call (parity with the engine primitive; ~1 us/call)
ESCHARS.charCodeAt(str, index);     // number; NaN out of range (surrogate pairs = 2 units)
ESCHARS.fromCharCode(unit);        // string; lone surrogates throw 10002

// bulk channel
ESCHARS.packBytes(str);            // 2-bytes-per-char packed string (byte-oriented)
ESCHARS.unpackBytes(packed);       // inverse (the bulk fromCharCode replacement)

// whole-workload-native transforms
ESCHARS.b64encode(str);            // base64 string
ESCHARS.b64decode(str);           // decoded bytes (NUL-truncated at JS boundary)
ESCHARS.hexEncode(str);            // lowercase hex
ESCHARS.hexDecode(hex);           // bytes from hex
ESCHARS.crc32(str);                // unsigned 32-bit CRC-32
ESCHARS.fnv1a32(str);              // unsigned 32-bit FNV-1a
ESCHARS.translate(str, hexTable);  // per-byte lookup; hexTable = 512 hex chars
ESCHARS.b64ToHex(str);             // base64 decode + hex encode in ONE call
```

### Error contract

Methods throw `Error` with `.number` set (ExtendScript convention). Codes:

| Code | Meaning |
|---|---|
| `20` | bad argument list (`kESErrBadArgumentList`) |
| `1000` | wrapper: DLL not loaded (call `ESCHARS.load()` first) |
| `10001` | native: input too large for the channel |
| `10002` | native: lone surrogate cannot cross the UTF-8 boundary |
| `10003` | native: malformed hex / bad translate table |

Negative codes are **fatal and uncatchable** — never produced by the DLL.

## Quickstart

```jsx
#target illustrator
(function () {
    // eval the bundle (adjust path to your layout)
    $.evalFile(File("C:/path/to/eschars/dist/ESCHARS.jsx"));
    ESCHARS.load();

    // bulk read: N/2 charCodeAt + arithmetic instead of N charCodeAt
    var s = "...";
    var p = ESCHARS.packBytes(s);
    var sum = 0, i, c;
    for (i = 0; i < p.length; i++) {
        c = p.charCodeAt(i);
        sum += (c & 255) + (c >> 8);
    }

    // native transforms
    var b64 = ESCHARS.b64encode(s);
    var hex = ESCHARS.hexEncode(s);
    var crc = ESCHARS.crc32(s);
    ESCHARS.unload();
}());
```

## Build

```
npm install                          # esbuild + typescript
npm run build                        # bundles src/index.ts -> dist/ESCHARS.jsx (+ eschars-core.esm.mjs)
npm run build:native                 # compiles native/eschars.c -> native/bin/ESChars.dll
npm test                             # Node differential tests (core-test + differential; no Illustrator)
npm run typecheck                    # tsc --noEmit (strict)
npm run live-verify                  # smoke + benchmark inside Illustrator via COM
```

## File layout

```
eschars/
├── .gitignore
├── LICENSE                          # GPL-3.0-or-later
├── package.json
├── tsconfig.json
├── eschars-build.mjs                # esbuild bundler (TS -> JSX + ESM)
├── README.md
├── native/
│   ├── eschars.c                    # DLL source (4 ES* exports + 15 methods)
│   ├── eschars-cli.c                # console differential harness (#includes eschars.c)
│   ├── SoSharedLibDefs.h            # canonical Adobe ABI header (keep its license notice intact)
│   └── build.ps1                    # auto-discovers MSVC + SDK; -Name/-Cli switches
├── src/
│   ├── index.ts                     # ES3-safe wrapper (the bundle entry point)
│   └── globals.d.ts                 # ExternalObject / $ / File declarations
├── dist/                            # generated: ESCHARS.jsx, eschars-core.esm.mjs
├── tests/
│   ├── refs.mjs                     # Node reference implementations
│   ├── vectors.mjs                  # 49-vector corpus + 360 K / 1 M large cases
│   ├── core-test.mjs                # refs vs vectors (pure Node)
│   ├── differential.mjs             # native CLI vs refs (byte-exact, incl. large lanes)
│   └── eschars-live-verify.mjs      # COM-driven live smoke + benchmark driver
├── probes/
│   ├── eschars-probe.jsx            # smoke test (full API, returns JSON check report)
│   └── eschars-benchmark.jsx        # microbenchmark (wedge-safe lanes, medians)
└── examples/
    └── 01-bulk-transform.jsx        # runnable bulk-transform example
```

## Native build details

The DLL uses the **documented Adobe `ExternalObject` direct interface** (`TaggedData` / `SoSharedLibDefs.h`), modeled on Adobe's own `AdobeXMPScript` (decompiled) and ThioJoe's ThioUtils:

- `ESGetVersion` returns literal `1`; `ESFreeMem` = `free`; returned strings are malloc'd UTF-8 (freed by ExtendScript).
- Every method is `long fn(TaggedData* argv, long argc, TaggedData* retval)`.
- `ESInitialize` signature string: `getVersion_s,add_ff,charCodeAt_sd,fromCharCode_d,fnv1a32_s,packBytes_s,unpackBytes_s,hexEncode_s,hexDecode_s,crc32_s,translate_ss,b64ToHex_s,b64encode_s,b64decode_s,fail_u`.
- Custom catchable errors `>= 10000`; negative codes are fatal/uncatchable — never returned.
- Built with MSVC x64 (`/O2 /LD /SUBSYSTEM:WINDOWS`); `build.ps1` auto-discovers VS2019/VS2022 BuildTools + Windows SDK.

### Per-DLL binding caveat

On a single DLL build, some `ESInitialize` signature entries may bind while others throw `"is not a function"` / `"Error #"` — the pattern is **per-DLL build** (verified stable across rebuilds, not random per session). Mitigation: `ESCHARS.load()` verifies all public methods after load and throws `ERR.BINDING` with a per-method report if any are missing. If you hit it, rebuild with a **fresh DLL file name** (the host locks loaded DLLs — `build.ps1 -Name ESChars2.dll`) and re-probe. The prototype had **zero** binding failures across 7 builds; risk is low but real.

### Numbered-build workflow

```
powershell -File native/build.ps1                # -> bin/ESChars.dll
powershell -File native/build.ps1 -Name ESChars2.dll   # iteration while host is running
```

A loaded DLL stays locked until the host exits (`LNK1104` on rebuild). Pass `-Name ESCharsN.dll` to build an iteration without closing Illustrator. Delete numbered binaries after the experiment.

## Validation status

| Item | Status | How verified |
|---|---|---|
| charCodeAt ~0.95 µs/unit | Verified | Live median, 16 K loop, 30.6.0 |
| Pure-JS wedge >= 128 K | Verified | 2 reproductions, 64 K ok / 128 K hang, restart each |
| Native hex 11,900x / transform 4,800x | Verified | Live medians + byte-exact correctness |
| Boundary ~7 µs/KB linear to 1 M | Verified | 5-point curve, medians |
| packBytes/unpackBytes 1.75x/3.7x | Verified | Live medians 16 K/64 K + round-trip equality |
| FNV-1a("abc") = 0x1A47E90B | Verified | BigInt-exact vs FNV spec (note: the ArcFitEso prototype README's 0x1A47A1CB claim was wrong — algorithm matches the spec and the `"a"`=0xE40C292C / `"foobar"`=0xBF9CF968 vectors) |
| NUL truncation / surrogate window | Verified | Live failures, then hex-table fix |
| Node corpus byte-exact (incl. 360 K / 1 M) | Verified | differential.mjs: 73/73 |
| Other hosts (AE/Premiere/PS) | **Unverified** | ThioUtils precedent suggests the direct interface works; not tested here |
| Multi-MB (> 1 M) direct strings | **Extrapolated** | Linear from 1 K–1 M curve; 10 M stalled an older POC — stay cautious |

## Compatibility

- **Engine**: Adobe ExtendScript ES3 (SpiderMonkey 2014). The wrapper is ES3-clean (no `let`/`const`/arrows/Promise/Map); esbuild targets ES5 with an injected shim for `Object.defineProperty` and `Function.prototype.bind`.
- **Native**: Windows x64 only (PE64 DLL; no macOS scope). The same DLL should work in Premiere/After Effects (ThioUtils precedent) but that is **unverified** here.
- **Illustrator**: developed and tested on Illustrator 2026 (30.6.0). Re-probe per host version.

## Research corrections

This library corrects one claim from its parent prototype (the ArcFitEso POC, `agent-skills/externalobject-extendscript/prototypes/arcfit-eso/`): the prototype's README listed `hash("abc")` = `440920331` = `0x1A47A1CB` as "canonical FNV-1a". The correct FNV-1a 32-bit hash of `"abc"` is **`0x1A47E90B`** (440,921,867) — verified BigInt-exact against the FNV spec algorithm (`hash = offset_basis; for each octet: hash ^= octet; hash *= FNV_prime` mod 2³²) and cross-checked against the canonical vectors FNV-1a(`"a"`) = `0xE40C292C` and FNV-1a(`"foobar"`) = `0xBF9CF968`, both of which the implementation reproduces exactly.

## Follow-ups (only after the above is stable)

- URL-safe base64 variant
- UTF-8 transcode helpers
- Stage/length binary channel for NUL-containing payloads
- Multi-host probe (Premiere / After Effects) if scope expands

## License

GPL-3.0-or-later. `native/SoSharedLibDefs.h` keeps its own Adobe sample-license header (vendored from `references/canonical-samples/`); the rest is GPL-3.0-or-later like the eson-family repos.
