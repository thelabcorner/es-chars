## v1.1.2 - 2026-09-23

SemVer: patch - native ABI/tooling migration with no public JS API changes.

## Changed

- Migrated the native ExternalObject ABI from the vendored Adobe `SoSharedLibDefs.h` to the pinned, independently written [ESABI v0.3.0](https://github.com/thelabcorner/esabi/releases/tag/v0.3.0) dependency (`deps/esabi`, commit `3e99040`). The runtime contract is unchanged: same four lifecycle exports, same 19 methods, same tag/error values, same 8-byte packing and cdecl boundary.
- `native/SoSharedLibDefs.h` is removed; the ESABI headers now ship in the package and are the single ABI declaration source.
- `native/build.ps1` fails fast when the ESABI submodule is missing, with the `git submodule update --init --recursive` hint.
- The JSX facade is now produced by the shared ESTC toolchain (`extendscript.estc.config.mjs`) instead of the in-build esbuild ES3 shim; compatibility helpers stay bundle-local and no host globals are patched.
- New release-gate scripts: `npm run estc:static`, `npm run estc:live-parse`, `npm run verify`, and `npm run release:gate` (also wired to `prepublishOnly`).
- `tests/eschars-live-verify.mjs` now behaviorally verifies both accelerated artifacts (`ESCHARS.accel.jsx`, `ESCHARS.accel.min.jsx`) after loading them in Illustrator.
- The accelerated bundles embed the shared ESB64Native accelerator at cache version v2 (the allocator-exhaustion fix from the v1.1.1 hotfix line).
- `ESCHARS.version()` now reports `ESChars 1.1.2`.

## Compatibility

- Public API unchanged; existing callers do not need to change.
- Binary/runtime contract unchanged; the DLL is loadable exactly as before (same exports and calling convention).

## Verification

Release-candidate gate on the release commit passed:

- `npm run build:native`: clean; `ESChars.dll` rebuilt against ESABI v0.3.0 with 23 exports (4 lifecycle + 19 methods).
- `npm run verify`: strict typecheck clean; `npm run build:accel` regenerated all dist artifacts; `npm test` passed 49 core assertions, 73 byte/transform differential checks, and 1380 trim differential checks; `npm run estc:static` passed on all four JSX artifacts.
- `npm run estc:live-parse`: all four artifacts parsed in Illustrator 30.6.0 / ExtendScript 4.5.6.
- `npm run live-verify`: 17 live smoke checks passed, both accelerated artifacts loaded with the native ESPAK payload, and 12 bounded benchmark lanes passed.

## Release Assets

- `ESCHARS.accel.jsx`
- `ESCHARS.accel.min.jsx`
- `ESCHARS.jsx`
- `ESChars.dll`
- `eschars-core.esm.mjs`
