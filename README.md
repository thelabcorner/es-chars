<div align="center">

# ESCHARS: Native charCodeAt + Bulk Byte/Unit Operations for Adobe ExtendScript (ES3)

## ExtendScript charCodeAt = E.S.CHARS

### The drop-in native speed library for byte-unit work in Adobe Illustrator, InDesign, Photoshop & any ExtendScript host

[![Differential: Node reference](https://img.shields.io/badge/differential-vs%20Node%20reference%2073%2F73-purple)](#validation)
[![Native: x64 Windows](https://img.shields.io/badge/native-x64%20Windows-blue)](#development)
[![Boundary: ~7 us/KB](https://img.shields.io/badge/boundary~%7C%7C~7%20us%2FKB-orange)](#whole-workload-native-transforms)
[![Adobe: Creative Suite](https://img.shields.io/badge/Adobe%20-Creative%20Suite-red?logo=adobe&logoColor=white)](https://extendscript.docsforadobe.dev/)
[![Engine: ES3](https://img.shields.io/badge/ExtendScript-ES3-green)](#compatibility)
[![Size](https://img.shields.io/badge/wrapper-~11%20KB-orange)](#which-build-should-i-use)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL%203.0--or--later-blue)](https://www.gnu.org/licenses/gpl-3.0.html)

</div>

---

## Part Of The Same Toolkit

> Production-grade ExtendScript infrastructure for Illustrator-era JavaScript engines.

<table>
<tr>
<td width="50%" valign="top">

### Runtime Primitives

**[ESON](https://github.com/thelabcorner/eson)**  
Strict RFC 8259 JSON for ExtendScript.

**[ESB64](https://github.com/thelabcorner/es-b64)**  
Base64 and UTF-8 utilities.

**[ESARR](https://github.com/thelabcorner/es-arr)**  
ES5+ Array compatibility methods.

**[ESSTR](https://github.com/thelabcorner/es-str)**  
String whitespace and trim methods.

**[ESCHARS](https://github.com/thelabcorner/es-chars)**  
Native bulk byte operations.

</td>
<td width="50%" valign="top">

### Build & Integration Tools

**[ESHTTP](https://github.com/thelabcorner/es-http)**  
HTTP transport for ExtendScript automation.

**[ESPACK](https://github.com/thelabcorner/espack)**  
Self-extracting ExternalObject bundles.

**[ESOBF](https://github.com/thelabcorner/esobf)**  
Obfuscation for shipped JSX bundles.

</td>
</tr>
</table>

Also from the same team: **[ArcFit.dev](https://arcfit.dev)**, deterministic arc warp for Illustrator.

---

## Table of Contents

- [Why ESCHARS?](#why-eschars)
- [Features](#features)
- [Which build should I use?](#which-build-should-i-use)
- [Get the Release](#get-the-release)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API](#api)
- [Validation](#validation)
- [Performance](#performance)
  - [Whole-workload-native transforms](#whole-workload-native-transforms)
- [Security Model](#security-model)
- [Compatibility](#compatibility)
- [Engine quirks that shaped the design](#engine-quirks-that-shaped-the-design)
- [Development](#development)
  - [Native build details](#native-build-details)
- [Repository layout](#repository-layout)
- [Research corrections](#research-corrections)
- [Known limitations](#known-limitations)
- [Credits](#credits)
- [License](#license)

---

## Why ESCHARS?

**ExtendScript's `charCodeAt` costs ~0.95 µs/unit — and the per-unit transform pattern (`charCodeAt` + `push`/`join`/`fromCharCode`) wedges the engine at >= 128 K input** (reproduced twice; 64 K completes, 128 K hangs, restart required; measured live on Illustrator 30.6.0, COM `DoJavaScript`, `$.hiresTimer` medians of 3–7 runs). Every script that does bulk byte or unit work — base64, hex, CRC, geometry hashing, binary job files — either hand-rolls a codec (slow, easy to get wrong) or injects a polyfill. ESCHARS moves the work native-side through a live-verified `ExternalObject` DLL and a thin ES3 JSX wrapper, turning the pathological case into a non-issue.

The library is **native-only with a hard failure if the DLL is missing** — there are deliberately **no pure-JS fallbacks**, because the wedge makes large-payload fallback impossible (a "fallback" for >= 128 K would be a trap). For small payloads the engine primitive is already ~1 µs/call; the wins are the batch/packed channel and the whole-workload-native transforms.

---

## Features

- **Per-call native `charCodeAt`/`fromCharCode`**: ~1 µs/call parity with the engine primitive — useful when you need unit access without the batch API; benchmark before trusting as a speed path (the win is the batch surface).
- **Bulk packed channel** (`packBytes`/`unpackBytes`): 2-bytes-per-char read/write, the only non-wedging per-unit path at 360 K.
- **Whole-workload-native transforms**: `b64encode`/`b64decode`, `hexEncode`/`hexDecode`, IEEE CRC-32, FNV-1a 32-bit, arbitrary-byte `translate` (256-byte lookup table), and the `b64ToHex` chain.
- **ES3-clean wrapper**: feature-detected load-by-absolute-path with `searchFolders` prepend, per-DLL binding verification, typed error mapping (`Error #` → error codes), native-only hard failure.
- **Node differential tests**: the native C is compiled into a console harness (`ESChars-cli.exe`) sharing the *exact* production code paths (the DLL source is `#include`d), and byte-exact differential-tested against Node reference implementations over a 49-vector corpus plus 360 K / 1 M lanes — no Illustrator required.
- **Live probes**: smoke + microbenchmark run inside the real engine via COM (`probes/`).
- **No runtime dependencies**: the production bundle is one file.

---

## Which build should I use?

| | **JSX bundle** | **DLL** | **ESPACK accel bundle** |
|---|---|---|---|
| Files | `dist/ESCHARS.jsx` | `native/bin/ESChars.dll` | `dist/ESCHARS.accel.jsx` / `.min.jsx` |
| Size | ~11 KB (wrapper) | ~96 KB (native) | ~185 KB / ~164 KB minified |
| What it is | The ES3 wrapper facade + ES3 shims | The native ExternalObject DLL | Self-extracting ESPACK v0.4 bundle: loader + `ESChars.dll` payload + ESCHARS facade |
| Required by | Your `.jsx` scripts | Resolved by the wrapper at runtime | One-file release path; no separate DLL placement |

The DLL must be loadable from the host (placed beside the script, on `ExternalObject.searchFolders`, or loaded by absolute path — the wrapper tries all of these). The JSX bundle `evalFile`s the wrapper and calls `ESCHARS.load()`.

**Rule of thumb:** use `ESCHARS.accel.min.jsx` from the release when you want one file in the Scripts folder. Use `ESCHARS.jsx` + `ESChars.dll` when you own DLL staging yourself. Use `ESCHARS.manifest.json` + `ESCHARS.facade.jsx` when composing several ESPACK consumers into one merged bundle.

---

## Get the Release

<div align="center">

**All production bundles ship as GitHub release assets — this repo holds sources. Grab the runnable builds from the [Releases page](https://github.com/thelabcorner/es-chars/releases).**

[![Release: v1.0.0](https://img.shields.io/badge/release-v1.0.0-blue)](https://github.com/thelabcorner/es-chars/releases/tag/v1.0.0)
[![Released: 2026-08-10](https://img.shields.io/badge/released-2026--08--10-lightgrey)](https://github.com/thelabcorner/es-chars/releases/tag/v1.0.0)
[![Downloads](https://img.shields.io/github/downloads/thelabcorner/es-chars/total?color=blueviolet)](https://github.com/thelabcorner/es-chars/releases)

</div>

**How it works, in three steps:**

1. Open the [Releases page](https://github.com/thelabcorner/es-chars/releases).
2. Pick the **latest stable** tag.
3. Download the asset that matches your use case:

| You are... | Take this release | And this asset |
|---|---|---|
| Dropping one file into the Scripts folder with zero install steps (self-extracting `ESChars.dll` included) | v1.0.0 | `ESCHARS.accel.min.jsx` |
| Auditing or debugging the self-extracting bundle before minification | v1.0.0 | `ESCHARS.accel.jsx` |
| Loading the native DLL from your own `ExternalObject` setup | v1.0.0 | `ESCHARS.jsx` + `ESChars.dll` |
| Composing several ESPACK consumers into one merged bundle | main | `npm run build:accel` → `ESCHARS.manifest.json` + `ESCHARS.facade.jsx` (composer inputs, not release assets) |
| Running Node-side tests or reading the core facade | v1.0.0 | `eschars-core.esm.mjs` |
| Building from source / reading the implementation | main | the repo |

> **Rule of thumb: start with the latest stable tag.** Every release asset is
> produced by `npm run build` + `npm run build:accel` from the exact tagged
> commit, and no release is tagged before it passes the full gate: 49 Node
> core assertions, 73/73 differential checks (byte-exact vs Node reference,
> incl. 360 K / 1 M lanes), strict typecheck, and the live smoke + benchmark
> battery in Illustrator.

> **Staying current:** releases follow [SemVer](https://semver.org/)
> (`v1.0.0`): patch = bug fix, minor = new feature, major = breaking change.
> Watch the repository → *Releases* to get notified, and read the release
> notes before upgrading across a major bump.

---

## Installation

```jsx
#target illustrator
$.evalFile(File("C:/path/to/eschars/dist/ESCHARS.jsx"));
ESCHARS.load();   // cached, idempotent — throws if the DLL is missing (native-only)
```

The DLL must be loadable from the host (placed beside the script, on `ExternalObject.searchFolders`, or loaded by absolute path — the wrapper tries all of these).

---

## Quick Start

```jsx
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
```

---

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

---

## Validation

| Check | Command | Result |
|---|---|---|
| charCodeAt ~0.95 µs/unit | Live median, 16 K loop, 30.6.0 | Verified |
| Pure-JS wedge >= 128 K | 2 reproductions, 64 K ok / 128 K hang, restart each | Verified |
| Native hex 11,900x / transform 4,800x | Live medians + byte-exact correctness | Verified |
| Boundary ~7 µs/KB linear to 1 M | 5-point curve, medians | Verified |
| packBytes/unpackBytes 1.75x/3.7x | Live medians 16 K/64 K + round-trip equality | Verified |
| FNV-1a("abc") = 0x1A47E90B | BigInt-exact vs FNV spec (note: the ArcFitEso prototype README's 0x1A47A1CB claim was wrong — algorithm matches the spec and the `"a"`=0xE40C292C / `"foobar"`=0xBF9CF968 vectors) | Verified |
| NUL truncation / surrogate window | Live failures, then hex-table fix | Verified |
| Node differential corpus (49 vectors + 360 K / 1 M lanes) | `npm test` | 73/73 |
| TypeScript strict | `npm run typecheck` | clean |
| Live engine smoke + benchmark | `npm run live-verify` | Verified (Illustrator 30.6.0) |
| Other hosts (AE/Premiere/PS) | — | **Unverified** — ThioUtils precedent suggests the direct interface works; not tested here |
| Multi-MB (> 1 M) direct strings | — | **Extrapolated** — linear from 1 K–1 M curve; 10 M stalled an older POC — stay cautious |

The differential oracle is the Node reference implementations in `tests/refs.mjs`, run against the native `ESChars-cli.exe` (which `#include`s the exact DLL source) — byte-exact, no Illustrator required. Live probes re-run smoke + microbenchmark inside the real engine via COM.

---

## Performance

Live, Illustrator 30.6.0, median µs (COM `DoJavaScript`, `$.hiresTimer` medians of 3–7 runs).

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
- **NUL truncates**: the string channel is C-null-terminated — payloads containing U+0000 are cut at the first NUL. Keep byte payloads NUL-free or use the staged/length protocol (see "Known limitations").
- **Surrogate window**: packed values 0xD800–0xDFFF cannot round-trip (UTF-8 cannot encode lone surrogates). ASCII/Latin-1 data is safe; for arbitrary byte tables use the **hex transport** (512 hex chars for a 256-byte table — `translate` takes exactly this).
- **Pipeline in one call**: `b64ToHex` does decode+encode in one boundary crossing (6.2 ms vs two calls ~8.7 ms at 360 K); chain transforms native-side when the pipeline is fixed.

---

## Security Model

ESCHARS loads and executes a native DLL (`ESChars.dll`) via `ExternalObject` — there is **no pure-JS fallback**, by design: a "fallback" for payloads ≥ 128 K would wedge the engine, so the library fails hard rather than failing silently. The trust surface is bounded:

- The DLL is loaded from the **local filesystem only** — beside the script, on `ExternalObject.searchFolders`, or by absolute path; never fetched remotely.
- Every public method is **binding-verified at `ESCHARS.load()` time** (per-DLL-build binding failures throw `ERR.BINDING` with a per-method report — a missing or partial DLL never silently half-works).
- Errors are **typed and catchable**: `Error` with `.number` (codes `20`, `1000`, `10001`–`10003`). Negative codes are fatal and uncatchable in this engine and are never produced by the DLL.
- The string channel truncates at NUL and cannot transport lone surrogates; the library degrades via documented rules (hex transport, staged/length protocol) rather than corrupting data.

---

## Compatibility

| Target | Status |
|---|---|
| ExtendScript ES3 (SpiderMonkey 2014) — wrapper is ES3-clean (no `let`/`const`/arrows/`Promise`/`Map`); esbuild targets ES5 with an injected shim for `Object.defineProperty` and `Function.prototype.bind` | Bundled |
| Windows x64 (PE64 DLL; no macOS scope) | Native layer; the same DLL should work in Premiere/After Effects (ThioUtils precedent) but that is **unverified** here |
| Illustrator 2026 (30.6.0) | Developed and tested; re-probe per host version |
| Node.js (test harnesses) | Differential tests run without Illustrator (ESChars-cli.exe vs reference implementations) |

---

## Engine quirks that shaped the design

All measured live on Illustrator 30.6.0 / ExtendScript 4.5.6.

- **Per-unit string transforms wedge at >= 128 K input.** The `charCodeAt` + `push`/`join`/`fromCharCode` pattern hangs the engine at 128 K (reproduced twice; 64 K completes; restart required). There is no pure-JS large-payload lane — hence the native-only design.
- **`charCodeAt` costs ~0.95 µs/unit.** The per-call native lane is a parity path, not a speed win; the wins are the batch/packed channel and whole-workload-native transforms.
- **The ExternalObject string channel is NUL-terminated.** Payloads containing U+0000 are cut at the first NUL; keep byte payloads NUL-free or use the staged/length protocol.
- **Packed values 0xD800–0xDFFF cannot cross the UTF-8 boundary** (UTF-8 cannot encode lone surrogates). ASCII/Latin-1 data is safe; arbitrary byte tables travel as hex (512 hex chars per 256-byte table — `translate` takes exactly this).
- **`ESInitialize` bindings can fail per-DLL-build.** Some signature entries may bind while others throw `"is not a function"` / `"Error #"` — the pattern is per-DLL-build, stable across rebuilds. `ESCHARS.load()` verifies all public methods after load (see [Development](#native-build-details)).
- **A loaded DLL stays locked until the host exits** (LNK1104 on rebuild) — iterate with numbered DLL file names.
- **Negative error codes are fatal and uncatchable.** The catchable contract is codes `20` / `1000` / `10001`–`10003`; the DLL never emits negative codes.
- **esbuild's ES5 pass can strip corrective parentheses the ES3 parser needs** — the `hexTableValid` compound condition mis-classified lowercase hex until each range check was isolated in its own variable (see [Research corrections](#research-corrections)).

---

## Development

```
npm install                          # esbuild + typescript
npm run build                        # bundles src/index.ts -> dist/ESCHARS.jsx (+ eschars-core.esm.mjs)
npm run build:native                 # compiles native/eschars.c -> native/bin/ESChars.dll
npm run build:accel                  # dist/ESCHARS.accel.jsx + .min.jsx + manifest/facade (ESPACK v0.4)
npm test                             # Node differential tests (core-test + differential; no Illustrator)
npm run typecheck                    # tsc --noEmit (strict)
npm run live-verify                  # smoke + benchmark inside Illustrator via COM
```

**Merge architecture (ESPACK v0.4.0).** `build:accel` also emits composition
artifacts for hosts that bundle multiple ESPACK consumers in one file:
`dist/ESCHARS.manifest.json` (schema v1, byte-identical to
`espack-build --manifest-out`) and `dist/ESCHARS.facade.jsx` (loader-free facade
+ adapter, requires `ESPAK` on `$.global`). A composer merges manifests with
`espack-merge.mjs` into ONE loader and appends the facades. The adapter loads
the payload **by name** (`ESPAK.load("ESChars")`) — index 0 is not a stable API
under a merged bundle. The standalone `ESCHARS.accel.jsx` is unchanged in
composition and remains the one-file release asset.

### Native build details

The DLL uses the **documented Adobe `ExternalObject` direct interface** (`TaggedData` / `SoSharedLibDefs.h`), modeled on Adobe's own `AdobeXMPScript` (decompiled) and ThioJoe's ThioUtils:

- `ESGetVersion` returns literal `1`; `ESFreeMem` = `free`; returned strings are malloc'd UTF-8 (freed by ExtendScript).
- Every method is `long fn(TaggedData* argv, long argc, TaggedData* retval)`.
- `ESInitialize` signature string: `getVersion_s,add_ff,charCodeAt_sd,fromCharCode_d,fnv1a32_s,packBytes_s,unpackBytes_s,hexEncode_s,hexDecode_s,crc32_s,translate_ss,b64ToHex_s,b64encode_s,b64decode_s,fail_u`.
- Custom catchable errors `>= 10000`; negative codes are fatal/uncatchable — never returned.
- Built with MSVC x64 (`/O2 /LD /SUBSYSTEM:WINDOWS`); `build.ps1` auto-discovers VS2019/VS2022 BuildTools + Windows SDK.

#### Per-DLL binding caveat

On a single DLL build, some `ESInitialize` signature entries may bind while others throw `"is not a function"` / `"Error #"` — the pattern is **per-DLL build** (verified stable across rebuilds, not random per session). Mitigation: `ESCHARS.load()` verifies all public methods after load and throws `ERR.BINDING` with a per-method report if any are missing. If you hit it, rebuild with a **fresh DLL file name** (the host locks loaded DLLs — `build.ps1 -Name ESChars2.dll`) and re-probe. The prototype had **zero** binding failures across 7 builds; risk is low but real.

#### Numbered-build workflow

```
powershell -File native/build.ps1                # -> bin/ESChars.dll
powershell -File native/build.ps1 -Name ESChars2.dll   # iteration while host is running
```

A loaded DLL stays locked until the host exits (`LNK1104` on rebuild). Pass `-Name ESCharsN.dll` to build an iteration without closing Illustrator. Delete numbered binaries after the experiment.

---

## Repository layout

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
├── dist/                            # generated: ESCHARS.jsx, eschars-core.esm.mjs, ESPACK accel artifacts
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

---

## Research corrections

This library corrects one claim from its parent prototype (the ArcFitEso POC, `agent-skills/externalobject-extendscript/prototypes/arcfit-eso/`): the prototype's README listed `hash("abc")` = `440920331` = `0x1A47A1CB` as "canonical FNV-1a". The correct FNV-1a 32-bit hash of `"abc"` is **`0x1A47E90B`** (440,921,867) — verified BigInt-exact against the FNV spec algorithm (`hash = offset_basis; for each octet: hash ^= octet; hash *= FNV_prime` mod 2³²) and cross-checked against the canonical vectors FNV-1a(`"a"`) = `0xE40C292C` and FNV-1a(`"foobar"`) = `0xBF9CF968`, both of which the implementation reproduces exactly.

### hexTableValid operator precedence (fixed)

The `hexTableValid` wrapper function (validates the 512-char hex table for `translate`) originally used a single compound condition: `!((c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70))`. esbuild's ES5 pass correctly removed the inner parentheses (which are redundant per JS operator precedence), producing `!(c >= 48 && c <= 57 || c >= 97 && c <= 102 || c >= 65 && c <= 70)`. ExtendScript's ES3 parser, however, binds `!` to the first comparison only when the inner parens are absent — mis-classifying lowercase hex (`a`–`f`) as invalid while accepting uppercase (`A`–`F`) and digits. The fix isolates each range check in its own local variable, forcing correct grouping regardless of parser quirks. Verified live: `translate` rot13 now passes in a fresh Illustrator session.

---

## Known limitations

- URL-safe base64 variant
- UTF-8 transcode helpers
- Stage/length binary channel for NUL-containing payloads
- Multi-host probe (Premiere / After Effects) if scope expands

---

## Credits

ESCHARS stands on the shoulders of the ExtendScript community:

- **[docsforadobe](https://github.com/docsforadobe) and the docsforadobe.dev community:** maintainers of the de-facto reference documentation for the ExtendScript runtime, including the `ExternalObject` interface this library is built on.
- **Adobe's AdobeXMPScript** (decompiled): the canonical `ExternalObject` direct-interface precedent the DLL's ABI is modeled on; `native/SoSharedLibDefs.h` keeps Adobe's own sample-license header (vendored from `references/canonical-samples/`).
- **ThioJoe's ThioUtils:** the precedent that the direct interface works beyond Illustrator (see Compatibility).
- **The ArcFitEso prototype** (`agent-skills/externalobject-extendscript/prototypes/arcfit-eso/`): the parent POC this library corrects (see Research corrections).

---

## License

GPL-3.0-or-later. `native/SoSharedLibDefs.h` keeps its own Adobe sample-license header (vendored from `references/canonical-samples/`); the rest is GPL-3.0-or-later like the eson-family repos.

---

<p align="center"><small>ESCHARS: ExtendScript charCodeAt. Built for the engine, measured on the engine, native where it counts.</small></p>
