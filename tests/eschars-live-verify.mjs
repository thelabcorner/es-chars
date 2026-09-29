#!/usr/bin/env node
// ESCHARS real-engine correctness verification.
// Runs the semantic smoke probe plus both accelerated shipped artifacts inside
// the real Illustrator ExtendScript engine through ESTC -> COMTool.
//
// Performance is deliberately separate in eschars-benchmark-live.mjs: benchmark
// noise or an ambiguous long-running RPC must not masquerade as correctness.
//
// Requires: Illustrator (launched on demand) + COMTool.
//   npm run live-verify
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createComToolRunner } from '../../extendscript-toolchain/src/comtool-compat.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBE = join(ROOT, 'probes', 'eschars-probe.jsx');
const ACCEL = join(ROOT, 'dist', 'ESCHARS.accel.jsx');
const ACCEL_MIN = join(ROOT, 'dist', 'ESCHARS.accel.min.jsx');
const COM = createComToolRunner();

async function runTool(args) {
  const env = await COM.run(args, { timeoutMs: 600000 });
  if (!env.ok) {
    console.error('live-verify: tool error: ' + JSON.stringify(env).slice(0, 1500));
    process.exit(1);
  }
  return env;
}

async function runEval(file) {
  const env = await runTool(['eval', '--file', file.replace(/\\/g, '/'), '--launch']);
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

async function verifyAcceleratedArtifact(label, file) {
  console.log('live-verify: evaluating ' + label + ' in Illustrator...');
  await runTool([
    'eval', '--expr',
    '(function(){ $.global["ESCHARS"]=null; $.global["ESB64"]=null; $.global["ESPAK"]=null; $.global["__ESPAK_LIBRARIES__"]=null; return true; }())',
    '--launch'
  ]);
  await runTool(['eval', '--file', file.replace(/\\/g, '/'), '--launch']);
  const state = (await runTool([
    'eval',
    '--expr', '$.global.ESCHARS && $.global.ESCHARS.espack',
    '--expr', '$.global.ESCHARS && $.global.ESCHARS.isLoaded()',
    '--expr', '$.global.ESCHARS && $.global.ESCHARS.crc32("123456789")',
    '--launch'
  ])).result;
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
const probeEnv = await runEval(PROBE);
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

await verifyAcceleratedArtifact('ESCHARS.accel.jsx', ACCEL);
await verifyAcceleratedArtifact('ESCHARS.accel.min.jsx', ACCEL_MIN);

console.log('live-verify: real-engine correctness gate passed');
await COM.close();
