## v1.1.0 — [[TAG-DATE: 2026-08-10 or actual tag date]]

SemVer: minor — adds supported native modern trim edge-scan APIs while preserving the existing ESCHARS byte/character API.

## Added

- Added `trimModern`, `trimModernLeft`, and `trimModernRight` native methods with ESSTR/Node/V8 modern trim semantics.
- Added `trimModernBounds`, returning `"start,end"` UTF-8 byte offsets for callers that need edge scan positions instead of a sliced string.
- Added `npm run test:trim` and wired the trim differential into `npm test`.

## Boundary Contract

- `trimModern*` uses the direct ExternalObject string channel. Embedded NUL truncates at the C-string boundary, and lone surrogates cannot be preserved through the UTF-8 bridge.
- Callers that must preserve NUL or lone surrogate code units should gate those inputs before calling; ESSTR does this and falls back to its pure ES3 scanner.
- `trimModernBounds` reports UTF-8 byte offsets, not UTF-16 code-unit indexes.

## Verification

VERIFIED on working tree (Release-Auditor, exit 0): `npm test` — 49 core assertions, 73 byte/transform differential checks, 1380 trim differential checks passed. `npm run typecheck` — clean. `npm run build:native` — clean (23 exports incl. 4 trim).

PENDING the release-candidate gate on the new trim-capable DLL (per audit, NOT yet run): `npm run build:accel` payload byte-identity re-check, `npm run live-verify` on the trim DLL (17 smoke + 12 benchmark lanes from the v1.0.0 gate must be RE-RUN — do not carry forward), esstr hybrid live-verify:accel smoke. Replace this section with the exact RC gate numbers before publishing the body.

## Release Assets

- `ESCHARS.accel.jsx`
- `ESCHARS.accel.min.jsx`
- `ESCHARS.jsx`
- `ESChars.dll`
- `eschars-core.esm.mjs`
