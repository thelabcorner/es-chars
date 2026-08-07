// ESChars example 01 — bulk byte/unit transforms the fast way.
// Run inside Illustrator (File > Scripts > Browse) or via COM.
// Demonstrates the packed channel (bulk read/write) and whole-workload-native
// transforms. Wedge-safe: pure-JS lanes are capped; native lanes run large.
#target illustrator
(function () {
    var bundle = File($.fileName).parent.parent.fsName + "/dist/ESCHARS.jsx";
    $.evalFile(File(bundle));

    var out = [];
    function line(s) { out[out.length] = s; }

    ESCHARS.load();
    line("ESChars " + ESCHARS.version());
    line("engine: " + $.version);

    // deterministic 128 K input (ascii — safe for the packed channel)
    var n = 131072;
    var chars = [], i;
    for (i = 0; i < n; i++) { chars[chars.length] = String.fromCharCode(33 + (i % 94)); }
    var s = chars.join("");
    line("input: " + n + " chars");

    // ---- packed bulk read: N/2 charCodeAt + arithmetic instead of N ----
    var t0 = $.hiresTimer;
    var p = ESCHARS.packBytes(s);
    var sum = 0, c;
    for (i = 0; i < p.length; i++) {
        c = p.charCodeAt(i);
        sum += (c & 255) + (c >> 8);
    }
    var tRead = ($.hiresTimer - t0) * 1000;
    line("packed read 128 K: " + tRead.toFixed(0) + " us (sum=" + sum + ")");

    // ---- packed bulk write: N/2 fromCharCode + one native unpack ----
    t0 = $.hiresTimer;
    var back = ESCHARS.unpackBytes(p);
    var tWrite = ($.hiresTimer - t0) * 1000;
    line("packed write (unpack 128 K): " + tWrite.toFixed(0) + " us (equal=" + (back === s) + ")");

    // ---- whole-workload-native transforms ----
    t0 = $.hiresTimer;
    var b64 = ESCHARS.b64encode(s);
    var tB64 = ($.hiresTimer - t0) * 1000;
    line("b64encode 128 K: " + tB64.toFixed(0) + " us (len=" + b64.length + ")");

    t0 = $.hiresTimer;
    var hex = ESCHARS.hexEncode(s);
    var tHex = ($.hiresTimer - t0) * 1000;
    line("hexEncode 128 K: " + tHex.toFixed(0) + " us (len=" + hex.length + ")");

    line("crc32: " + ESCHARS.crc32(s));
    line("fnv1a32: " + ESCHARS.fnv1a32(s));

    // ---- per-call native charCodeAt (parity lane) ----
    t0 = $.hiresTimer;
    var sum2 = 0;
    for (i = 0; i < 16384; i++) { sum2 += ESCHARS.charCodeAt(s, i); }
    var tCall = ($.hiresTimer - t0) * 1000;
    line("per-call charCodeAt 16 K: " + tCall.toFixed(0) + " us");

    ESCHARS.unload();
    line("done.");
    return out.join("\n");
}());
