#target illustrator
(function () {
    var out = { ok: false, engine: "", checks: [], phase: "init" };
    function tryCall(fn) {
        try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, number: e.number, message: String(e.message) }; }
    }
    function check(name, cond, detail) {
        out.checks[out.checks.length] = { name: name, ok: !!cond, detail: detail === undefined ? "" : String(detail) };
        return !!cond;
    }
    function thrown(fn) { try { fn(); return null; } catch (e) { return { number: e.number, message: String(e.message) }; } }
    function ckpt() {
        try { var p = new File(Folder.temp.fsName + "/eschars-probe.json"); p.open("w"); p.write(JSON.stringify(out)); p.close(); } catch (ignore) {}
    }
    try {
        out.engine = String($.version || "");
        $.evalFile(File("C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eschars/dist/ESCHARS.jsx"));
        var lib = ESCHARS.load();
        check("load", !!lib); check("version", Number(lib.version) === 1);
        ckpt();
        check("charCodeAt('hello',1)", ESCHARS.charCodeAt("hello", 1) === 101);
        check("charCodeAt surrogate hi", ESCHARS.charCodeAt("\ud83d\ude00", 0) === 0xD83D);
        check("fromCharCode(0x4E2D)", ESCHARS.fromCharCode(0x4E2D) === "中");
        ckpt();
        check("packBytes round trip", ESCHARS.unpackBytes(ESCHARS.packBytes("hello")) === "hello");
        check("b64encode", ESCHARS.b64encode("hello") === "aGVsbG8=");
        check("hexEncode", ESCHARS.hexEncode("hello") === "68656c6c6f");
        check("crc32", ESCHARS.crc32("123456789") === 3421780262);
        check("fnv1a32('abc')", ESCHARS.fnv1a32("abc") === 440920331);
        check("b64ToHex", ESCHARS.b64ToHex("aGVsbG8=") === "68656c6c6f");
        ckpt();
        var tab = [], i, c;
        for (i = 0; i < 256; i++) { c = i; if (i >= 97 && i <= 109) c = i + 13; else if (i >= 110 && i <= 122) c = i - 13; else if (i >= 65 && i <= 77) c = i + 13; else if (i >= 78 && i <= 90) c = i - 13; tab.push((c < 16 ? "0" : "") + c.toString(16)); }
        var trot = tryCall(function () { return ESCHARS.translate("Hello, World! 123", tab.join("")); });
        check("translate rot13", trot.ok && trot.value === "Uryyb, Jbeyq! 123");
        if (!trot.ok) { out.translateErr = trot.message; }
        ckpt();
        var badHex = thrown(function () { ESCHARS.hexDecode("abc"); });
        check("hexDecode err 10003", badHex && badHex.number === 10003);
        var sur = thrown(function () { ESCHARS.fromCharCode(0xD800); });
        check("fromCharCode surrogate err 10002", sur && sur.number === 10002);
        check("NUL truncation", ESCHARS.hexDecode("00") === "");
        ckpt();
        ESCHARS.unload(); check("unload", !ESCHARS.isLoaded());
        ESCHARS.load(); check("reload", ESCHARS.isLoaded() && ESCHARS.crc32("123456789") === 3421780262);
        ESCHARS.unload();
        out.ok = true;
    } catch (e) { out.ok = false; out.error = String(e.message); }
    ckpt();
    return JSON.stringify(out);
}());
