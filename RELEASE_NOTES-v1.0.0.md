## v1.0.0 — 2026-08-10

**SemVer: major** — first public release: establishes the full ESCHARS API
surface (per-call native `charCodeAt`/`fromCharCode`, the packed bulk channel,
and the whole-workload-native transforms) and the `ESChars.dll`
ExternalObject contract; nothing prior to migrate from.

Gate: 49 Node core assertions / 73/73 differential checks (byte-exact vs Node
reference implementations, incl. 360 K / 1 M lanes) / strict typecheck clean /
native source rebuild clean via numbered DLL (`ESCharsReleaseGate.dll`) / 17/17
live smoke checks + 12 bounded live benchmark lanes, Illustrator 30.6.0
(ExtendScript engine 4.5.6). All green on this commit.

### Added

- **Per-call native `charCodeAt` / `fromCharCode`** — parity with the engine
  primitive (~1 µs/call) for unit access without the batch API; `NaN` out of
  range, lone surrogates throw `10002` — see [API](https://github.com/thelabcorner/es-chars#api).
- **Packed bulk channel (`packBytes` / `unpackBytes`)** — 2-bytes-per-char
  read/write; the only non-wedging per-unit path at 360 K (measured 1.75x
  reads / 3.7x writes at 16 K–64 K) — see [Performance](https://github.com/thelabcorner/es-chars#performance).
- **Whole-workload-native transforms** — `b64encode`/`b64decode`,
  `hexEncode`/`hexDecode`, IEEE CRC-32, FNV-1a 32-bit, arbitrary-byte
  `translate` (256-byte lookup), and the single-call `b64ToHex` chain;
  11,900x / 4,800x over pure-JSX, boundary ~7 µs/KB linear to 1 M — see
  [Performance: Whole-workload-native transforms](https://github.com/thelabcorner/es-chars#whole-workload-native-transforms).
- **ES3-clean wrapper** — feature-detected load with `searchFolders`
  prepend, per-DLL binding verification (`ERR.BINDING` with per-method
  report), typed error mapping (`Error #` → codes `20` / `1000` /
  `10001`–`10003`), native-only hard failure — see [Security Model](https://github.com/thelabcorner/es-chars#security-model).
- **Node differential harness** — `ESChars-cli.exe` `#include`s the exact
  DLL source; 49-vector corpus + 360 K / 1 M lanes, byte-exact vs Node
  reference implementations, no Illustrator required — see [Validation](https://github.com/thelabcorner/es-chars#validation).
- **ESPACK v0.4.0 self-extracting bundle** — `ESCHARS.accel.jsx` /
  `ESCHARS.accel.min.jsx`: one-file release artifact embedding
  `ESChars_v1.dll` + the shared `ESB64Native_v1.dll` accelerator (byte-exact,
  sha256-verified); adapter loads by name (`ESPAK.load("ESChars")`, never
  index 0) — see [Get the Release](https://github.com/thelabcorner/es-chars#get-the-release).

### Fixed

- **FNV-1a hex correction** — the parent prototype's README claimed
  `hash("abc")` = `0x1A47A1CB`; the spec-exact FNV-1a 32-bit value is
  `0x1A47E90B` (440,921,867), verified BigInt-exact and cross-checked against
  the canonical `"a"` / `"foobar"` vectors. `fnv1a32` reproduces the spec
  value exactly — see [Research corrections](https://github.com/thelabcorner/es-chars#research-corrections).
- **`hexTableValid` operator-precedence mis-classification** — esbuild's ES5
  pass stripped corrective parentheses; ExtendScript's ES3 parser then bound
  `!` to the first comparison only, rejecting lowercase hex. Each range check
  is now isolated in its own variable; verified live: `translate` rot13 passes
  in a fresh Illustrator session — see [Research corrections](https://github.com/thelabcorner/es-chars#research-corrections).

### Performance

- Whole-workload-native vs pure-JSX, Illustrator 30.6.0 medians: `hexEncode`
  16 K — 136 µs vs 1,621,941 µs (**11,900x**); `translate` rot13 16 K —
  92 µs vs 442,478 µs (**4,800x**); boundary ~7 µs/KB, near-perfectly linear
  1 K → 1 M (1 MB base64 in 7.6 ms) — see [Performance](https://github.com/thelabcorner/es-chars#performance).

### Security

- Native-only by design with hard failure — no pure-JS fallback (a fallback
  for payloads >= 128 K would wedge the engine). DLL loads from the local
  filesystem only (beside the script, `searchFolders`, or absolute path);
  every public method binding-verified at load; channel rules (NUL
  truncation, surrogate window) degrade via documented hex transport rather
  than corrupting data; catchable error codes only, negative codes never
  produced — see [Security Model](https://github.com/thelabcorner/es-chars#security-model).

### Compatibility

- Windows x64 for the native layer (`ESChars.dll`, PE64); wrapper is ES3-clean
  and runs in any ExtendScript host; developed and tested on Illustrator
  30.6.0; Premiere/After Effects **unverified** here (ThioUtils precedent);
  Node >= 18 for build/test harnesses — see [Compatibility](https://github.com/thelabcorner/es-chars#compatibility).

### Assets

- `ESCHARS.accel.jsx` / `ESCHARS.accel.min.jsx` — self-extracting ESPACK v0.4.0
  bundle (one-file release path; wrapper + `ESChars.dll` + shared
  `ESB64Native` accel)
- `ESCHARS.jsx` — ES3 wrapper facade (place `ESChars.dll` beside it or on
  `searchFolders`)
- `ESChars.dll` — native ExternalObject DLL for your own staging
- `eschars-core.esm.mjs` — ESM core for Node harnesses
- `ESCHARS.manifest.json` + `ESCHARS.facade.jsx` — composition inputs for
  `espack-merge` consumers (NOT release assets; produced by
  `npm run build:accel`)

License: GPL-3.0-or-later.
