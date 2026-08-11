## v1.1.0 — 2026-08-10

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

Release-candidate gate on the tagged release commit passed:

- `npm run build:native`: clean; `ESChars.dll` rebuilt with 23 exports including the four trim exports.
- `npm run build:accel`: clean; regenerated `ESCHARS.accel.jsx`, `ESCHARS.accel.min.jsx`, `ESCHARS.manifest.json`, `ESCHARS.facade.jsx`, `ESCHARS.jsx`, and `eschars-core.esm.mjs`.
- `npm test`: 49 core assertions, 73 byte/transform differential checks, and 1380 trim differential checks passed.
- `npm run typecheck`: clean.
- `npm run live-verify`: 17 live smoke checks and 12 bounded live benchmark lanes passed in Illustrator 30.6.0 / ExtendScript 4.5.6.
- `npm pack --dry-run --json`: package contents verified; release assets and permanent trim differential included, evidence-only trim benchmark/selftest artifacts excluded.
- Downstream ESSTR integration was rebuilt against the release ESCHARS artifact and passed `npm run live-verify:accel`.

## Release Assets

- `ESCHARS.accel.jsx`
- `ESCHARS.accel.min.jsx`
- `ESCHARS.jsx`
- `ESChars.dll`
- `eschars-core.esm.mjs`
