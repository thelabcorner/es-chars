import assert from 'node:assert/strict';
import { LIVE_API, load, unload } from '../dist/eschars-core.esm.mjs';

function fakeLibrary() {
  var unloads = 0;
  var lib = {
    version: 1,
    unload: function () { unloads++; }
  };
  for (var i = 0; i < LIVE_API.length; i++) {
    lib[LIVE_API[i]] = function () { return 0; };
  }
  return { lib: lib, unloads: function () { return unloads; } };
}

var borrowed = fakeLibrary();
assert.equal(load({ lib: borrowed.lib, owned: false }), borrowed.lib);
unload();
assert.equal(borrowed.unloads(), 0, 'borrowed ExternalObject must never be unloaded by ESCHARS');

var owned = fakeLibrary();
assert.equal(load({ lib: owned.lib, owned: true }), owned.lib);
unload();
assert.equal(owned.unloads(), 1, 'owned ExternalObject must be unloaded exactly once by ESCHARS');

console.log('eschars ownership: PASS');