// ESChars live smoke probe — run inside Illustrator 2026 (ESTK or COM
// DoJavaScript). EvalFile's the dist wrapper bundle, exercises the full
// ESCHARS public API through the real DLL, returns a check report.
//
//   node tests/eschars-live-verify.mjs   (or: python .../ILLUSTRATOR_COM_TOOL.py
//                                          eval --file probes/eschars-probe.jsx)
#target illustrator
(function () {
    var out = { ok: false, error: null, engine: "", checks: [] };

    function check(name, cond, detail) {
        out.checks[out.checks.length] = {
            name: name,
            ok: !!cond,
            detail: detail === undefined ? "" : String(detail)
        };
        return !!cond;
    }

    function thrown(fn) {
        try { fn(); return null; } catch (e) {
            return { number: e.number, message: String(e.message) };
        }
    }

    try {
        out.engine = String($.version || "");
        var bundle = File($.fileName).parent.parent.fsName + "/dist/ESCHARS.jsx";
        if (!File(bundle).exists) { throw new Error("bundle missing: " + bundle); }
        $.evalFile(File(bundle));

        // ---- load ----
        var lib = ESCHARS.load();
        check("load returns instance", lib !== undefined && lib !== null);
        check("isLoaded", ESCHARS.isLoaded());
        check("ExternalObject.version == 1", Number(lib.version) === 1);
        check("version() identifies ESChars", String(ESCHARS.version()).indexOf("ESChars") === 0);
        check("bindings all bound", (function () {
            var b = ESCHARS.bindings(), i;
            for (i = 0; i < b.length; i++) { if (!b[i].ok) { return false; } }
            return b.length > 0;
        }()));

        // ---- numeric smoke ----
        check("add(2.5, 3.5) === 6", Number(lib.add(2.5, 3.5)) === 6);

        // ---- per-call API ----
        check("charCodeAt('hello', 1) === 101", ESCHARS.charCodeAt("hello", 1) === 101);
        check("charCodeAt('hello', 99) is NaN", isNaN(ESCHARS.charCodeAt("hello", 99)));
        check("charCodeAt('h\u00e9llo', 1) === 233 (UTF-8)", ESCHARS.charCodeAt("h\u00e9llo", 1) === 233);
        check("charCodeAt('\\ud83d\\ude00', 0) === 0xD83D (hi surrogate)", ESCHARS.charCodeAt("\ud83d\ude00", 0) === 0xD83D);
        check("charCodeAt('\\ud83d\\ude00', 1) === 0xDE00 (lo surrogate)", ESCHARS.charCodeAt("\ud83d\ude00", 1) === 0xDE00);
        check("fromCharCode(97) === 'a'", ESCHARS.fromCharCode(97) === "a");
        check("fromCharCode(0x4E2D) === '\u4e2d' (3-byte UTF-8)", ESCHARS.fromCharCode(0x4E2D) === "\u4e2d");
        var sur = thrown(function () { ESCHARS.fromCharCode(0xD800); });
        check("fromCharCode(0xD800) throws 10002", sur !== null && sur.number === 10002);

        // ---- bulk channel ----
        check("packBytes('hello') round trip", ESCHARS.unpackBytes(ESCHARS.packBytes("hello")) === "hello");
        check("packBytes('') == ''", ESCHARS.packBytes("") === "");
        check("unpackBytes('') == ''", ESCHARS.unpackBytes("") === "");

        // ---- transforms ----
        check("b64encode('hello') === 'aGVsbG8='", ESCHARS.b64encode("hello") === "aGVsbG8=");
        check("b64decode('aGVsbG8=') === 'hello'", ESCHARS.b64decode("aGVsbG8=") === "hello");
        check("b64encode('') === ''", ESCHARS.b64encode("") === "");
        check("hexEncode('hello') === '68656c6c6f'", ESCHARS.hexEncode("hello") === "68656c6c6f");
        check("hexDecode('68656c6c6f') === 'hello'", ESCHARS.hexDecode("68656c6c6f") === "hello");
        check("crc32('123456789') === 0xCBF43926", ESCHARS.crc32("123456789") === 3421780262);
        check("fnv1a32('') === 0x811C9DC5", ESCHARS.fnv1a32("") === 2166136261);
        check("fnv1a32('abc') === 0x1A47E90B", ESCHARS.fnv1a32("abc") === 440921867);
        check("b64ToHex('aGVsbG8=') === '68656c6c6f'", ESCHARS.b64ToHex("aGVsbG8=") === "68656c6c6f");

        // translate: rot13 table (512 hex chars) built in pure JSX
        var rot13 = [], i, c;
        for (i = 0; i < 256; i++) {
            c = i;
            if (i >= 97 && i <= 109) { c = i + 13; }
            else if (i >= 110 && i <= 122) { c = i - 13; }
            else if (i >= 65 && i <= 77) { c = i + 13; }
            else if (i >= 78 && i <= 90) { c = i - 13; }
            rot13[rot13.length] = (c < 16 ? "0" : "") + c.toString(16);
        }
        check("translate rot13('Hello') === 'Uryyb'",
            ESCHARS.translate("Hello", rot13.join("")) === "Uryyb");

        // ---- error mapping ----
        var badHex = thrown(function () { ESCHARS.hexDecode("abc"); });
        check("hexDecode('abc') throws 10003", badHex !== null && badHex.number === 10003);
        var badB64 = thrown(function () { ESCHARS.b64decode("a"); });
        check("b64decode('a') throws 20", badB64 !== null && badB64.number === 20);
        var badTable = thrown(function () { ESCHARS.translate("x", "00"); });
        check("translate bad table throws 10003", badTable !== null && badTable.number === 10003);
        check("channel rule: hexDecode('00') truncates at NUL", ESCHARS.hexDecode("00") === "");

        // ---- unload / reload ----
        ESCHARS.unload();
        check("unload -> isLoaded false", !ESCHARS.isLoaded());
        ESCHARS.load();
        check("reload works", ESCHARS.isLoaded() && ESCHARS.crc32("123456789") === 3421780262);
        ESCHARS.unload();

        out.ok = true;
    } catch (e) {
        out.ok = false;
        out.error = { number: e.number, message: String(e.message) };
    }
    return out;
}());
