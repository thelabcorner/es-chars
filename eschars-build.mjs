#!/usr/bin/env node
// ESCHARS build: bundles the TypeScript wrapper into
//   dist/ESCHARS.jsx               - bannerless IIFE (COM-eval / $.evalFile safe),
//                                    defines var ESCHARS (the facade)
//   dist/eschars-core.esm.mjs      - ESM bundle of the core for Node harnesses
//   dist/ESCHARS.accel.jsx         - (--accel) ESPACK v0.4 self-extracting
//                                    bundle: ESChars.dll payload + ESCHARS
//                                    facade + load-by-name adapter
//   dist/ESCHARS.accel.min.jsx     - (--accel) minified release bundle
//   dist/ESCHARS.manifest.json     - (--accel) merge-spec manifest sidecar
//   dist/ESCHARS.facade.jsx        - (--accel) loader-free facade for
//                                    espack-merge composers
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var DIST = join(ROOT, 'dist');
var ENTRY = join(ROOT, 'src', 'index.ts');

function findEsbuild() {
  if (process.env.ESBUILD_PATH && existsSync(process.env.ESBUILD_PATH)) return process.env.ESBUILD_PATH;
  var direct = join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
  if (existsSync(direct)) return direct;
  var cacheDirs = [
    join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx'),
    join(process.env.USERPROFILE || '', 'AppData', 'Local', 'npm-cache', '_npx')
  ];
  for (var i = 0; i < cacheDirs.length; i++) {
    try {
      var entries = readdirSync(cacheDirs[i]);
      for (var j = 0; j < entries.length; j++) {
        var p = join(cacheDirs[i], entries[j], 'node_modules', 'esbuild', 'bin', 'esbuild');
        if (existsSync(p)) return p;
      }
    } catch (ignore) {}
  }
  return 'npx esbuild';
}

function esmBuild(entry, outfile) {
  execFileSync(process.execPath, [
    findEsbuild(), entry, '--bundle', '--outfile=' + outfile,
    '--format=esm', '--platform=node', '--target=es2019',
    '--log-level=warning'
  ], { stdio: 'inherit' });
}

function jsxBuild(entry, outfile) {
  execFileSync(process.execPath, [
    findEsbuild(), entry, '--bundle', '--outfile=' + outfile,
    '--format=iife', '--global-name=ESCHARS', '--platform=neutral', '--target=es5',
    '--log-level=warning'
  ], { stdio: 'inherit' });
}

mkdirSync(DIST, { recursive: true });

// 1. ESM core bundle (Node harnesses import this).
esmBuild(ENTRY, join(DIST, 'eschars-core.esm.mjs'));

// 2. JSX bundle with the ES3 shim prepended. ExtendScript (SpiderMonkey 2014)
//    lacks Object.defineProperty and Function.prototype.bind, which esbuild's
//    ES5 export helpers require.
var jsx = join(DIST, 'ESCHARS.jsx');
jsxBuild(ENTRY, jsx);

var shim = [
  'if (typeof Object.defineProperty !== "function") {',
  '  Object.defineProperty = function (obj, prop, desc) {',
  '    if (desc) {',
  '      if (typeof desc.get === "function") {',
  '        if (typeof obj.__defineGetter__ === "function") { obj.__defineGetter__(prop, desc.get); }',
  '        else { obj[prop] = desc.get(); }',
  '      } else if ("value" in desc) {',
  '        obj[prop] = desc.value;',
  '      }',
  '    }',
  '    return obj;',
  '  };',
  '  Object.getOwnPropertyDescriptor = function (obj, prop) {',
  '    return { value: obj[prop], writable: true, enumerable: true, configurable: true };',
  '  };',
  '  Object.getOwnPropertyNames = function (obj) {',
  '    var a = [], k;',
  '    for (k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) { a.push(k); } }',
  '    return a;',
  '  };',
  '}',
  'if (typeof Function.prototype.bind !== "function") {',
  '  Function.prototype.bind = function (thisArg) {',
  '    var fn = this;',
  '    var args = Array.prototype.slice.call(arguments, 1);',
  '    return function () {',
  '      return fn.apply(thisArg, args.concat(Array.prototype.slice.call(arguments)));',
  '    };',
  '  };',
  '}',
  ''
].join('\n');

var finalJsx = shim + readFileSync(jsx, 'utf8');
finalJsx = finalJsx.replace(/"use strict";?/g, '');
writeFileSync(jsx, finalJsx);

// 3. Accelerated self-extracting bundle (ESCHARS.accel.jsx): ESPACK "1 + n".
//    ESChars.dll is the payload; the current sibling ESPACK loader (v0.4.0)
//    embeds/discovers the shared ESB64Native accelerator and emits the v1
//    merge manifest. The adapter loads by PAYLOAD NAME ("ESChars"), never by
//    index, because merged bundles have unstable payload indexes.
var ACCELERATOR = [
  '',
  '(function () {',
  '  // ESCHARS espack adapter: ESPAK.load("ESChars") materializes ESChars.dll',
  '  // (via the shared accelerator when available), then asks the ESCHARS',
  '  // facade to load that extracted absolute DLL path. Auto-enables on eval;',
  '  // ESCHARS.useEspack() is the opt-in/idempotent form. ESCHARS.espack holds',
  '  // the last outcome.',
  '  if (typeof ESPAK !== "object" || !ESPAK || typeof ESPAK.load !== "function") return;',
  '  if (typeof ESCHARS !== "object" || !ESCHARS || typeof ESCHARS.load !== "function") return;',
  '  var cached = null;',
  '  function useEspack() {',
  '    // Merge architecture v1: load by NAME, never load(0).',
  '    var l = ESPAK.load("ESChars");',
  '    if (!l || !l.ok || !l.path) {',
  '      cached = { ok: false, reason: (l && l.error) || "ESPAK load failed" };',
  '      return cached;',
  '    }',
  '    try {',
  '      var lib = ESCHARS.load({ path: l.path });',
  '      cached = { ok: !!lib, mode: l.mode, path: l.path };',
  '    } catch (e) {',
  '      cached = { ok: false, reason: String(e), path: l.path };',
  '    }',
  '    return cached;',
  '  }',
  '  ESCHARS.useEspack = useEspack;',
  '  ESCHARS.espack = useEspack();',
  '  var g = null;',
  '  try { if (typeof $ !== "undefined" && $.global) { g = $.global; } } catch (e1) {}',
  '  if (g) {',
  '    g.ESCHARS = ESCHARS;',
  '    g.ESPAK = ESPAK;',
  '  }',
  '}());',
  ''
].join('\n');

function buildAccel() {
  var espackBuild = join(ROOT, '..', 'espack', 'espack-build.mjs');
  var dll = join(ROOT, 'native', 'bin', 'ESChars.dll');
  if (!existsSync(espackBuild)) {
    console.log('[eschars-build] accel skipped: espack repo not found at ' + join(ROOT, '..', 'espack'));
    return;
  }
  if (!existsSync(dll)) {
    console.log('[eschars-build] accel skipped: ' + dll + ' missing (run npm run build:native)');
    return;
  }
  var accelBundle = join(DIST, '.eschars-accel-bundle.jsx');
  var manifestOut = join(DIST, 'ESCHARS.manifest.json');
  execFileSync(process.execPath, [espackBuild, '--embed', dll, '--accel-version', '2', '--out', accelBundle,
    '--name', 'eschars', '--manifest-out', manifestOut, '--quiet'], { stdio: 'inherit' });
  var bundleText = readFileSync(accelBundle, 'utf8');
  var facadeText = readFileSync(join(DIST, 'ESCHARS.jsx'), 'utf8');
  var facadeOut = facadeText + '\n' + ACCELERATOR +
    '// ESCHARS.facade.jsx - loader-free facade + espack adapter (composer appends to a merged bundle; requires ESPAK on $.global)\n';
  writeFileSync(join(DIST, 'ESCHARS.facade.jsx'), facadeOut);
  var accelOut = bundleText + '\n' + facadeText + '\n' + ACCELERATOR +
    '// ESCHARS.accel.jsx - self-extracting single-file bundle (espack v0.4 + ESCHARS + native DLL gate)\n';
  writeFileSync(join(DIST, 'ESCHARS.accel.jsx'), accelOut);
  console.log('[eschars-build] wrote ' + join(DIST, 'ESCHARS.accel.jsx') + ' (' + accelOut.length + ' bytes)');
  console.log('[eschars-build] wrote ' + manifestOut + ' and ' + join(DIST, 'ESCHARS.facade.jsx'));
  minifyAccel(accelOut);
}

function minifyAccel(accelOut) {
  var skillDir = join(ROOT, '..', 'agent-skills', 'adobe-extendscript-minification');
  var minifyScript = join(skillDir, 'scripts', 'minify-jsx.py');
  var minifyConfig = join(skillDir, 'configs', 'conservative.json');
  if (!existsSync(minifyScript) || !existsSync(minifyConfig)) {
    console.log('[eschars-build] accel minify skipped: minification skill not found at ' + skillDir);
    return;
  }
  var m = accelOut.match(/^\/\*[\s\S]*?\*\//);
  var banner = m ? m[0] : '';
  var body = m ? accelOut.substring(m[0].length) : accelOut;
  var bodyPath = join(DIST, '.eschars-accel-bundle.body.jsx');
  var minPath = join(DIST, '.eschars-accel-bundle.min.jsx');
  writeFileSync(bodyPath, body, 'utf8');
  execFileSync('python', [minifyScript, '--in', bodyPath, '--config', minifyConfig,
    '--out', minPath], { stdio: 'inherit' });
  var minBody = readFileSync(minPath, 'utf8');
  var minOut = (banner ? banner + '\n' : '') + minBody;
  var minFinal = join(DIST, 'ESCHARS.accel.min.jsx');
  writeFileSync(minFinal, minOut, 'utf8');
  console.log('[eschars-build] wrote ' + minFinal + ' (' + minOut.length + ' bytes, banner preserved)');
}

if (process.argv.includes('--accel')) {
  buildAccel();
}

console.log('[eschars-build] wrote ' + join(DIST, 'ESCHARS.jsx') + ' and ' + join(DIST, 'eschars-core.esm.mjs'));
