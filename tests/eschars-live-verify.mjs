#!/usr/bin/env node
// ESChars live verification: runs the probe and the microbenchmark inside
// the REAL Illustrator engine through COM Tool V2, asserts the
// probe checks, and prints the benchmark table with medians.
//
// Requires: Illustrator (launched on demand with --launch) + COM Tool V2.
//   npm run live-verify
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLegacyComToolV2Runner } from '../../extendscript-toolchain/src/comtool-v2-compat.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBE = join(ROOT, 'probes', 'eschars-probe.jsx');
const BENCH = join(ROOT, 'probes', 'eschars-benchmark.jsx');
const ACCEL = join(ROOT, 'dist', 'ESCHARS.accel.jsx');
const ACCEL_MIN = join(ROOT, 'dist', 'ESCHARS.accel.min.jsx');
const COM = createLegacyComToolV2Runner();
process.on('exit', function () { try { COM.close(); } catch (ignore) {} });

function runTool(args) {
  const env = COM.run(args, { timeoutMs: 600000 });
  if (!env.ok) {
    console.error('live-verify: tool error: ' + JSON.stringify(env).slice(0, 1500));
    process.exit(1);
  }
  return env;
}

function runEval(file) {
  const env = runTool(['eval', '--file', file.replace(/\\/g, '/'), '--launch']);
  // envelope {"ok":true,"op":"eval","result": ...} -> probe's wrapped
  // {"ok":true,"result":<report>} -> report
  const wrapped = env.result;
  if (wrapped && typeof wrapped === 'object' && 'result' in wrapped) {
    return wrapped.result;
  }
  if (wrapped && typeof wrapped === 'object' && wrapped.ok === true) {
    return wrapped; // tool may unwrap in some paths
  }
  return wrapped;
}

function verifyAcceleratedArtifact(label, file) {
  console.log('live-verify: evaluating ' + label + ' in Illustrator...');
  runTool(['eval', '--file', file.replace(/\\/g, '/'), '--launch']);
  const state = runTool([
    'eval',
    '--expr', '$.global.ESCHARS && $.global.ESCHARS.espack',
    '--expr', '$.global.ESCHARS && $.global.ESCHARS.isLoaded()',
    '--expr', '$.global.ESCHARS && $.global.ESCHARS.crc32("123456789")',
    '--launch'
  ]).result;
  const espak = state && state[0];
  const loaded = state && state[1];
  const crc = state && state[2];
  if (!espak || espak.ok !== true || espak.mode !== 'native' || !espak.path ||
      loaded !== true || crc !== 3421780262) {
    console.error('live-verify: ' + label + ' behavioral gate failed: ' + JSON.stringify(state).slice(0, 1800));
    process.exit(1);
  }
  console.log('live-verify: ' + label + ' OK (native payload ' + espak.path + ')');
}

// ---- probe ----

console.log('live-verify: running smoke probe in Illustrator...');
const probeEnv = runEval(PROBE);
// The probe returns its plain object directly through COM Tool V2.
// Fall back to the historical checkpoint file only for older/partial return
// paths; checkpoint serialization itself is best-effort in ExtendScript.
import { readFileSync } from 'node:fs';
function readProbeReport() {
  if (probeEnv && typeof probeEnv === 'object' && Array.isArray(probeEnv.checks)) {
    return probeEnv;
  }
  const candidates = [
    join(process.env.TEMP || '', 'eschars-probe.json'),
    join(process.env.LOCALAPPDATA || '', 'Temp', 'eschars-probe.json')
  ];
  for (const p of candidates) {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { /* try next */ }
  }
  return probeEnv; // surface whatever came back
}
const report = readProbeReport();
if (!report || report.ok !== true) {
  console.error('live-verify: probe failed: ' + JSON.stringify(report && report.error).slice(0, 1500));
  process.exit(1);
}
const bad = (report.checks || []).filter((c) => !c.ok);
if (bad.length > 0) {
  console.error('live-verify: ' + bad.length + ' probe check(s) failed:');
  for (const c of bad) console.error('  FAIL ' + c.name + (c.detail ? ' — ' + c.detail : ''));
  process.exit(1);
}
console.log('live-verify: probe OK (' + report.checks.length + ' checks, engine ' + report.engine + ')');

// ---- accelerated artifacts ----

verifyAcceleratedArtifact('ESCHARS.accel.jsx', ACCEL);
verifyAcceleratedArtifact('ESCHARS.accel.min.jsx', ACCEL_MIN);

// ---- benchmark ----

console.log('live-verify: running bounded microbenchmark in Illustrator...');
const bench = runEval(BENCH);
if (!bench || bench.ok !== true) {
  console.error('live-verify: benchmark failed: ' + JSON.stringify(bench && bench.error).slice(0, 1500));
  process.exit(1);
}

const lanes = bench.lanes || {};
const failedLanes = Object.keys(lanes).filter((k) => lanes[k].error);
if (failedLanes.length > 0) {
  console.error('live-verify: ' + failedLanes.length + ' benchmark lane(s) errored:');
  for (const k of failedLanes) console.error('  FAIL ' + k + ' — ' + JSON.stringify(lanes[k].error));
  process.exit(1);
}
const invalidLanes = Object.keys(lanes).filter((k) => lanes[k].us !== undefined && lanes[k].us < 0);
if (invalidLanes.length > 0) {
  console.error('live-verify: ' + invalidLanes.length + ' benchmark lane(s) reported negative timings:');
  for (const k of invalidLanes) console.error('  FAIL ' + k + ' — ' + lanes[k].us);
  process.exit(1);
}

console.log('live-verify: benchmark OK (' + Object.keys(lanes).length + ' lanes, engine ' + bench.engine + ')');
console.log('');
console.log('| Lane | us (median) |');
console.log('|---|---|');
for (const k of Object.keys(lanes).sort()) {
  console.log('| ' + k + ' | ' + lanes[k].us.toFixed(1) + ' |');
}

// boundary us/KB
const points = ['1k', '4k', '16k', '64k'];
const kb = { '1k': 1, '4k': 4, '16k': 16, '64k': 64 };
console.log('');
console.log('| Boundary point | us | us/KB |');
console.log('|---|---|---|');
for (const p of points) {
  const k = 'boundary.' + p;
  if (lanes[k] && lanes[k].us !== undefined) {
    console.log('| ' + p + ' | ' + lanes[k].us.toFixed(1) + ' | ' + (lanes[k].us / kb[p]).toFixed(2) + ' |');
  }
}

// sanity assertions (generous bounds; the point is catching regressions, not noise)
const sanity = [
  ['native.b64encode.64k', 25000],
  ['native.hexEncode.16k', 5000],
  ['native.crc32.64k', 25000],
  ['native.b64ToHex.64k', 40000]
];
let sane = true;
for (const [k, limit] of sanity) {
  if (lanes[k] && lanes[k].us !== undefined && lanes[k].us > limit) {
    console.error('live-verify: ' + k + ' = ' + lanes[k].us.toFixed(0) + ' us exceeds sanity limit ' + limit);
    sane = false;
  }
}
if (!sane) process.exit(1);
console.log('');
console.log('live-verify: all lanes within sanity bounds');
