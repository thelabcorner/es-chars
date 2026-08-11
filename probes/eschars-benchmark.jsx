// ESChars microbenchmark — run inside Illustrator 2026 (ESTK or COM).
// Wedge-safe by construction: the release-gate benchmark is intentionally
// bounded (no large JSX-only lanes, max 64 K native lanes) so COM automation
// does not hold Illustrator long enough to trip RPC/busy failures. The larger
// README performance table is historical measured evidence; this probe is a
// live path check with timings. Results are medians of RUNS
// ($.hiresTimer, microseconds), checkpointed to %TEMP%\eschars-benchmark.json
// before returning so a partial result survives host errors.
#target illustrator
(function () {
    var RUNS = 1;
    var out = { ok: false, error: null, engine: "", lanes: {} };

    function median(a) {
        a.sort(function (x, y) { return x - y; });
        return a[Math.floor(a.length / 2)];
    }

    function lane(name, fn) {
        var samples = [], i, t0, dt, tries, err = null;
        try {
            for (i = 0; i < RUNS; i++) {
                dt = -1;
                for (tries = 0; tries < 3 && dt < 0; tries++) {
                    t0 = $.hiresTimer;
                    fn();
                    dt = $.hiresTimer - t0; // $.hiresTimer reports microseconds in ExtendScript
                }
                if (dt < 0) { throw new Error("negative $.hiresTimer delta"); }
                samples[samples.length] = dt;
            }
            out.lanes[name] = { us: median(samples) };
        } catch (e) {
            out.lanes[name] = { error: { number: e.number, message: String(e.message) } };
        }
    }

    try {
        out.engine = String($.version || "");
        // $.fileName is unreliable under COM (resolves to the host working dir);
        // use the fixed absolute path, matching the probe's pattern.
        var bundle = "C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eschars/dist/ESCHARS.jsx";
        $.evalFile(File(bundle));
        ESCHARS.load();

        // deterministic inputs (no Math.random)
        function asciiChunk(n) {
            var s = [], i;
            for (i = 0; i < n; i++) { s[s.length] = String.fromCharCode(97 + (i % 26)); }
            return s.join("");
        }
        function utf8Chunk(n) {
            var s = [], i;
            for (i = 0; i < n; i++) { s[s.length] = (i % 2 === 0) ? "\u00e9" : "x"; }
            return s.join("");
        }
        var k16 = asciiChunk(16384);
        var k64 = asciiChunk(65536);
        var k64u = utf8Chunk(32768);     // 64 K utf8-ish bytes without large COM hold time

        function sumCharCodes(s) {
            var sum = 0, i;
            for (i = 0; i < s.length; i++) { sum += s.charCodeAt(i); }
            return sum;
        }
        function sumPacked(p) {
            var sum = 0, i, c;
            for (i = 0; i < p.length; i++) {
                c = p.charCodeAt(i);
                sum += (c & 255) + (c >> 8);
            }
            return sum;
        }
        function writePacked(s) {
            var p = [], j;
            for (j = 0; j + 1 < s.length; j += 2) {
                p[p.length] = String.fromCharCode((s.charCodeAt(j) & 0xFF) | ((s.charCodeAt(j + 1) & 0xFF) << 8));
            }
            if (j < s.length) { p[p.length] = String.fromCharCode(s.charCodeAt(j) & 0xFF); }
            return ESCHARS.unpackBytes(p.join(""));
        }
        function writeCharCodes(s) {
            var p = [], i;
            for (i = 0; i < s.length; i++) { p[p.length] = String.fromCharCode(s.charCodeAt(i)); }
            return p.join("");
        }

        var rot13 = [], i, c;
        for (i = 0; i < 256; i++) {
            c = i;
            if (i >= 97 && i <= 109) { c = i + 13; }
            else if (i >= 110 && i <= 122) { c = i - 13; }
            else if (i >= 65 && i <= 77) { c = i + 13; }
            else if (i >= 78 && i <= 90) { c = i - 13; }
            rot13[rot13.length] = (c < 16 ? "0" : "") + c.toString(16);
        }
        var rot13Hex = rot13.join("");

        // ---- native transforms (the win lanes) ----
        lane("native.b64encode.1k", function () { ESCHARS.b64encode(k16.substring(0, 1024)); });
        lane("native.b64encode.16k", function () { ESCHARS.b64encode(k16); });
        lane("native.b64encode.64k", function () { ESCHARS.b64encode(k64); });
        var b6464 = ESCHARS.b64encode(k64);
        lane("native.b64ToHex.64k", function () { ESCHARS.b64ToHex(b6464); });
        lane("native.hexEncode.16k", function () { ESCHARS.hexEncode(k16); });
        lane("native.hexEncode.64k", function () { ESCHARS.hexEncode(k64); });
        lane("native.crc32.64k", function () { ESCHARS.crc32(k64u); });
        lane("native.translate.16k", function () { ESCHARS.translate(k16, rot13Hex); });

        // ---- boundary overhead curve (us/KB) ----
        lane("boundary.1k", function () { ESCHARS.b64encode(k16.substring(0, 1024)); });
        lane("boundary.4k", function () { ESCHARS.b64encode(k16.substring(0, 4096)); });
        lane("boundary.16k", function () { ESCHARS.b64encode(k16); });
        lane("boundary.64k", function () { ESCHARS.b64encode(k64); });

        ESCHARS.unload();
        out.ok = true;
    } catch (e) {
        out.ok = false;
        out.error = { number: e.number, message: String(e.message) };
    }

    // checkpoint before returning (partial results survive host errors)
    try {
        var f = new File(Folder.temp.fsName + "/eschars-benchmark.json");
        f.open("w");
        f.write(JSON.stringify(out));
        f.close();
    } catch (ignore) {}
    return out;
}());
