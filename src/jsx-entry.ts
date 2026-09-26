// ESCHARS ExtendScript entry — side-effect-only. No exported binding (that
// would force esbuild to emit the module-helper family that legacy
// ExtendScript cannot run). Named imports only (never `import * as`); assemble
// the facade explicitly and assign to $.global['ESCHARS']. The ESTC config
// uses a dummy globalName (`__ESCHARS_ENTRY__`) so the bundle carries zero
// module helpers. ESCHARS is native-only (every method requires the DLL);
// this entry just publishes the facade.
import {
  ERR, LIVE_API, toU32, hexTableValid, describeError, candidatePaths,
  bindingReportText, isLoaded, unload, load, charCodeAt, fromCharCode,
  packBytes, unpackBytes, b64encode, b64decode, hexEncode, hexDecode, crc32,
  fnv1a32, translate, b64ToHex, trimModern, trimModernLeft, trimModernRight,
  trimModernBounds, bindings, version
} from './index';

function makeFacade(): any {
  return {
    ERR: ERR,
    LIVE_API: LIVE_API,
    toU32: toU32,
    hexTableValid: hexTableValid,
    describeError: describeError,
    candidatePaths: candidatePaths,
    bindingReportText: bindingReportText,
    isLoaded: isLoaded,
    unload: unload,
    load: load,
    charCodeAt: charCodeAt,
    fromCharCode: fromCharCode,
    packBytes: packBytes,
    unpackBytes: unpackBytes,
    b64encode: b64encode,
    b64decode: b64decode,
    hexEncode: hexEncode,
    hexDecode: hexDecode,
    crc32: crc32,
    fnv1a32: fnv1a32,
    translate: translate,
    b64ToHex: b64ToHex,
    trimModern: trimModern,
    trimModernLeft: trimModernLeft,
    trimModernRight: trimModernRight,
    trimModernBounds: trimModernBounds,
    bindings: bindings,
    version: version
  };
}

var __escharsGlobal: any = null;
try { if (typeof $ !== 'undefined' && $.global) { __escharsGlobal = $.global; } } catch (e) { /* ignore */ }
if (!__escharsGlobal) {
  try { __escharsGlobal = (Function as any)('return this')(); } catch (e2) { /* ignore */ }
}
if (__escharsGlobal) {
  __escharsGlobal['ESCHARS'] = makeFacade();
}
