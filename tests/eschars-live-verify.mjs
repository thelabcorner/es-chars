#!/usr/bin/env node
// ESChars live verification: runs the probe and the microbenchmark inside
// the REAL Illustrator engine through ILLUSTRATOR_COM_TOOL.py, asserts the
// probe checks, and prints the benchmark table with medians.
//
// Requires: Illustrator (launched on demand with --launch), pywin32.
//   npm run live-verify
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOOL_CANDIDATES = [
  process.env.ILLUSTRATOR_COM_TOOL || '',
  join(ROOT, '..', 'agent-skills', 'illustrator-com-automation-skill', 'comtool', 'ILLUSTRATOR_COM_TOOL.py'),
  join(ROOT, '..', 'agent-skills', 'illustrator-com-automation-skill', 'scripts', 'ILLUSTRATOR_COM_TOOL.py'),
  'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/agent-skills/illustrator-com-automation-skill/comtool/ILLUSTRATOR_COM_TOOL.py',
  'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/agent-skills/illustrator-com-automation-skill/scripts/ILLUSTRATOR_COM_TOOL.py'
];
const TOOL = TOOL_CANDIDATES.find((p) => p && existsSync(p));
const PROBE = join(ROOT, 'probes', 'eschars-probe.jsx');
const BENCH = join(ROOT, 'probes', 'eschars-benchmark.jsx');

if (!TOOL) {
  console.error('live-verify: COM tool not found. Tried: ' + TOOL_CANDIDATES.filter(Boolean).join(' | '));
  process.exit(1);
}

function runEval(file) {
  const pyOut = execFileSync('python', [TOOL, 'eval', '--file', file.replace(/\\/g, '/'), '--launch'], {
    encoding: 'utf8', timeout: 600000
  });
  let env;
  try {
    env = JSON.parse(pyOut.trim());
  } catch (e) {
    console.error('live-verify: tool output not JSON: ' + pyOut.slice(0, 800));
    process.exit(1);
  }
  if (!env.ok) {
    console.error('live-verify: tool error: ' + JSON.stringify(env).slice(0, 1500));
    process.exit(1);
  }
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

// ---- probe ----

console.log('live-verify: running smoke probe in Illustrator...');
const probeEnv = runEval(PROBE);
// The probe returns JSON.stringify(out); the COM tool's wrapper returns
// JSON-like strings raw, so env.result is the parsed report object. Fall back
// to the checkpoint file the probe writes to %TEMP% (survives even if the
// return path strips nested arrays).
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
