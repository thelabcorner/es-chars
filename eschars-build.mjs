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
var ESTC = join(ROOT, '..', 'extendscript-toolchain', 'bin', 'estc.mjs');
var ESB64_MANIFEST = join(ROOT, '..', 'esb64', 'dist', 'ESB64.manifest.json');

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

function estcBuild(config) {
  execFileSync(process.execPath, [ESTC, 'build', '--config', config], {
    cwd: ROOT,
    stdio: 'inherit'
  });
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (ignore) {
    return '';
  }
}

mkdirSync(DIST, { recursive: true });

// 1. ESM core bundle (Node harnesses import this).
esmBuild(ENTRY, join(DIST, 'eschars-core.esm.mjs'));

// 2. Canonical ExtendScript facade. ESTC owns ES3 normalization and keeps
// esbuild helper compatibility bundle-local instead of mutating host globals.
var jsx = join(DIST, 'ESCHARS.jsx');
estcBuild('./extendscript.estc.config.mjs');

// 3. Accelerated self-extracting bundle (ESCHARS.accel.jsx): ESPACK v2.
//    ESB64 and ESCHARS are flattened through one persistent ESPAK control
//    plane. ESChars.dll is a native capability payload and ESCHARS borrows
//    ESPACK's ExternalObject rather than opening/unloading a second owner.
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
  '    // Composition architecture v2: load by NAME, never load(0).',
  '    var l = ESPAK.load("ESChars");',
  '    if (!l || !l.ok || !l.path || !l.lib) {',
  '      cached = { ok: false, reason: (l && l.error) || "ESPAK load failed" };',
  '      return cached;',
  '    }',
  '    try {',
  '      var lib = ESCHARS.load({ lib: l.lib, path: l.path, owned: false });',
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

async function buildAccel() {
  var espackBuild = join(ROOT, '..', 'espack', 'espack-build.mjs');
  var espackMerge = join(ROOT, '..', 'espack', 'espack-merge.mjs');
  var espackLibraries = join(ROOT, '..', 'espack', 'espack-libraries.mjs');
  var dll = join(ROOT, 'native', 'bin', 'ESChars.dll');
  var manifestOut = join(DIST, 'ESCHARS.manifest.json');
  if (!existsSync(espackBuild) || !existsSync(espackMerge) || !existsSync(espackLibraries)) {
    console.log('[eschars-build] accel skipped: espack repo not found at ' + join(ROOT, '..', 'espack'));
    return;
  }
  if (!existsSync(dll)) {
    console.log('[eschars-build] accel skipped: ' + dll + ' missing (run npm run build:native)');
    return;
  }
  if (!existsSync(ESB64_MANIFEST)) {
    console.log('[eschars-build] accel skipped: ESB64 v2 manifest missing (build ../esb64 first)');
    return;
  }
  var packageInfo = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  var esb64Package = JSON.parse(readFileSync(join(ROOT, '..', 'esb64', 'package.json'), 'utf8'));
  var api = await import(new URL('../espack/espack-build.mjs', import.meta.url).href);
  var mergeApi = await import(new URL('../espack/espack-merge.mjs', import.meta.url).href);
  var libraries = await import(new URL('../espack/espack-libraries.mjs', import.meta.url).href);
  var payload = readFileSync(dll);
  var facadeText = readFileSync(join(DIST, 'ESCHARS.jsx'), 'utf8');
  var facadeOut = facadeText + '\n' + ACCELERATOR +
    '// ESCHARS.facade.jsx - ESPACK v2 activation adapter\n';
  writeFileSync(join(DIST, 'ESCHARS.facade.jsx'), facadeOut);
  var library = libraries.libraryFromFile({
    id: 'eschars', version: packageInfo.version, global: 'ESCHARS',
    path: join(DIST, 'ESCHARS.facade.jsx'),
    requires: [{ id: 'esb64', range: '^' + esb64Package.version }],
    contract: [
      { name: 'load', type: 'function' }, { name: 'isLoaded', type: 'function' },
      { name: 'unload', type: 'function' }, { name: 'crc32', type: 'function' }
    ],
    provenance: { package: packageInfo.name,
      repository: packageInfo.repository && packageInfo.repository.url,
      commit: gitHead(), artifact: 'dist/ESCHARS.facade.jsx' }
  });
  var ownManifest = api.makeManifest({
    bundleName: 'eschars', cacheDir: '',
    payloads: [{ name: 'ESChars', version: '1', len: payload.length,
      b64: payload.toString('base64'), fileName: 'ESChars_v1.dll' }],
    libraries: [library], entries: [{ id: 'eschars', range: '=' + packageInfo.version }],
    capabilities: [{ id: 'eschars.native', provider: 'eschars', mode: 'required',
      payloads: ['ESChars'], accel: null }]
  });
  var composed = mergeApi.merge({ manifests: [ESB64_MANIFEST, ownManifest],
    out: join(DIST, 'ESCHARS.accel.jsx'), manifestOut: manifestOut,
    name: 'eschars', entries: [{ id: 'eschars', range: '=' + packageInfo.version }], deferB64: true });
  var accelOut = composed.text +
    '// ESCHARS.accel.jsx - ESPACK v2 flattened ESB64 -> ESCHARS composition; one loader/control plane\n';
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
  await buildAccel();
}

console.log('[eschars-build] wrote ' + join(DIST, 'ESCHARS.jsx') + ' and ' + join(DIST, 'eschars-core.esm.mjs'));
