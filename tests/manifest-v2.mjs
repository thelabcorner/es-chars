import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ESCHARS.manifest.json', dist), 'utf8'));
const artifact = readFileSync(new URL('ESCHARS.accel.jsx', dist), 'utf8');

assert.equal(manifest.format, 'espack-manifest');
assert.equal(manifest.version, 2);
assert.equal(manifest.bundleName, 'eschars');
assert.deepEqual(manifest.libraries.map((lib) => lib.id), ['esb64', 'eschars'],
  'transitive libraries are emitted dependency-first');

const esb64Package = JSON.parse(readFileSync(new URL('../esb64/package.json', root), 'utf8'));
const escharsPackage = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
assert.equal(escharsPackage.version, '1.2.0');
const esb64 = manifest.libraries[0];
const eschars = manifest.libraries[1];
assert.equal(esb64.version, esb64Package.version);
assert.equal(eschars.version, escharsPackage.version);
assert.deepEqual(eschars.requires, [{ id: 'esb64', range: '^' + esb64Package.version, optional: false }]);

for (const lib of manifest.libraries) {
  const bytes = Buffer.from(lib.artifact.b64, 'base64');
  const source = new URL((lib.id === 'esb64' ? '../esb64/dist/' : 'dist/') + lib.artifact.fileName, root);
  const sourceBytes = readFileSync(source);
  assert.equal(bytes.length, lib.artifact.len, lib.id + ' UTF-8 artifact length');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), lib.artifact.sha256,
    lib.id + ' UTF-8 artifact SHA-256');
  assert.deepEqual(bytes, sourceBytes, lib.id + ' embedded bytes match the exact UTF-8 source artifact');
}

assert.equal(eschars.activation.global, 'ESCHARS');
assert.equal(eschars.activation.type, 'object');
assert.ok(eschars.activation.contract.some((row) => row.name === 'crc32' && row.type === 'function'));
assert.ok(eschars.activation.contract.some((row) => row.name === 'load' && row.type === 'function'));
assert.deepEqual(manifest.capabilities.map((cap) => cap.id), ['esb64.native', 'eschars.native']);
assert.deepEqual(manifest.capabilities[1], { id: 'eschars.native', provider: 'eschars', mode: 'required',
  payloads: ['ESChars'], accel: null });
assert.equal((artifact.match(/var ESPACK = \(function/g) || []).length, 1,
  'the standalone root artifact carries one ESPAK control plane');
assert.ok(artifact.includes('ESB64') && artifact.includes('ESCHARS'),
  'the root artifact contains the complete dependency closure');
assert.ok(artifact.includes('owned: false'), 'the activation adapter borrows ESPACK native objects');
assert.equal((artifact.match(/var ESPACK = \(function/g) || []).length, 1,
  'composition emits a single loader instead of nesting loaders');

console.log('eschars manifest v2: PASS (dependency order, activation, capability, UTF-8 lengths and SHA-256)');
