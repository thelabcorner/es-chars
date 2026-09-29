#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createComToolRunner } from '../../extendscript-toolchain/src/comtool-compat.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBE = join(ROOT, 'probes', 'eschars-benchmark.jsx');
const COM = createComToolRunner();

if (!existsSync(PROBE)) {
  console.error('benchmark: probe missing: ' + PROBE);
  process.exit(1);
}

function checkpoint() {
  const candidates = [
    join(process.env.TEMP || '', 'eschars-benchmark.json'),
    join(process.env.LOCALAPPDATA || '', 'Temp', 'eschars-benchmark.json')
  ];
  for (const file of candidates) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch (ignore) {}
  }
  return null;
}

console.log('benchmark: running bounded ESCHARS microbenchmark through COM Tool V2...');
const envelope = await COM.run(
  ['eval', '--file', PROBE.replace(/\\/g, '/'), '--launch'],
  { timeoutMs: 600000 }
);
if (!envelope.ok) {
  console.error('benchmark: COM Tool V2 failed: ' + JSON.stringify(envelope.error));
  process.exit(1);
}

let report = envelope.result;
if (!report || typeof report !== 'object' || !report.lanes) report = checkpoint();
if (!report || report.ok !== true) {
  console.error('benchmark: probe failed: ' + JSON.stringify(report && report.error));
  process.exit(1);
}

const lanes = report.lanes || {};
const names = Object.keys(lanes).sort();
const failed = names.filter((name) =>
  lanes[name].error ||
  typeof lanes[name].us !== 'number' ||
  lanes[name].us < 0
);
if (failed.length) {
  for (const name of failed) {
    console.error('benchmark: FAIL ' + name + ' — ' + JSON.stringify(lanes[name]));
  }
  process.exit(1);
}

console.log('benchmark: ' + names.length + ' lanes, engine ' + report.engine);
console.log('');
console.log('| Lane | us (median) |');
console.log('|---|---:|');
for (const name of names) {
  console.log('| ' + name + ' | ' + lanes[name].us.toFixed(1) + ' |');
}

const points = ['1k', '4k', '16k', '64k'];
const kb = { '1k': 1, '4k': 4, '16k': 16, '64k': 64 };
console.log('');
console.log('| Boundary point | us | us/KB |');
console.log('|---|---:|---:|');
for (const point of points) {
  const key = 'boundary.' + point;
  if (lanes[key]) {
    console.log(
      '| ' + point + ' | ' + lanes[key].us.toFixed(1) +
      ' | ' + (lanes[key].us / kb[point]).toFixed(2) + ' |'
    );
  }
}

await COM.close();
