/***************************************************************************
 * ESChars — native charCodeAt / fromCharCode + bulk byte-unit operations
 * for Adobe ExtendScript (ES3) via the documented ExternalObject direct
 * interface. Ported and extended from the ArcFitEso prototype
 * (agent-skills/externalobject-extendscript/prototypes/arcfit-eso/).
 *
 * Design decisions carried over from the prototype (all live-verified on
 * Illustrator 30.6.0):
 *  - ESGetVersion = literal 1, ESFreeMem = free passthrough (AdobeXMPScript
 *    decompile), strings = malloc'd UTF-8.
 *  - TaggedData { union data; long type; long filler; }, kTypeString=4,
 *    kTypeInteger=123 (SoSharedLibDefs.h + live tag sweep).
 *  - Signature string with `_s` on no-arg methods, `_d` casts args to
 *    kTypeInteger (measured), custom catchable errors >= 10000 (ThioUtils).
 *  - Never return negative error codes (fatal, uncatchable).
 *  - Channel rules (measured): NUL truncates the string channel; packed
 *    values in the surrogate window 0xD800-0xDFFF cannot round-trip —
 *    arbitrary byte tables travel as 512-char hex.
 *
 * Build:  powershell -File build.ps1                (-> bin/ESChars.dll)
 *         powershell -File build.ps1 -Cli           (-> bin/ESChars-cli.exe)
 * Test:   probe.jsx inside Illustrator; Node differential harness.
 *
 * ABI: every method is long fn(TaggedData* argv, long argc, TaggedData*
 * retval). Retval is preset to kTypeUndefined; zero the slot before
 * writing. Strings are allocated with malloc and freed by ExtendScript
 * via ESFreeMem.
 ***************************************************************************/

#include "SoSharedLibDefs.h"
#include <stdlib.h>
#include <string.h>

#define ESCHARS_API __declspec(dllexport)

/* Custom catchable error base (ThioUtils convention: >= 10000). */
#define ESCHARS_ERROR_BASE 10000
#define ESCHARS_ERR_TOO_LARGE   (ESCHARS_ERROR_BASE + 1)
#define ESCHARS_ERR_SURROGATE   (ESCHARS_ERROR_BASE + 2)
#define ESCHARS_ERR_BAD_HEX     (ESCHARS_ERROR_BASE + 3)

/* ---- mandatory entry points ---- */

ESCHARS_API char* ESInitialize(TaggedData* argv, long argc)
{
    (void)argv;
    (void)argc;
    /* Signature string: used for argument casting + reflection only;
       methods remain callable even without an entry (Adobe returns NULL). */
    return "getVersion_s,add_ff,charCodeAt_sd,fromCharCode_d,fnv1a32_s,packBytes_s,unpackBytes_s,hexEncode_s,hexDecode_s,crc32_s,translate_ss,b64ToHex_s,b64encode_s,b64decode_s,fail_u";
}

ESCHARS_API long ESGetVersion(void)
{
    /* Mirror AdobeXMPScript: literal constant, no negotiation. */
    return 1;
}

ESCHARS_API void ESFreeMem(void* p)
{
    /* Must match the allocator used for returned strings (malloc/_strdup). */
    free(p);
}

ESCHARS_API void ESTerminate(void)
{
    /* No persistent native state. */
}

/* ---- helpers ---- */

static char* dup_string(const char* s)
{
    size_t n = strlen(s) + 1;
    char* b = (char*)malloc(n);
    if (b != NULL) {
        memcpy(b, s, n);
    }
    return b;
}

static unsigned fnv1a32_bytes(const unsigned char* p, size_t n)
{
    size_t i;
    unsigned h = 2166136261u;
    for (i = 0; i < n; i++) {
        h ^= (unsigned)p[i];
        h *= 16777619u;
    }
    return h;
}

/* Decode one UTF-8 code point; *pp advanced past the sequence.
   Returns -1 on malformed input or end of buffer. */
static long utf8_decode_unit(const unsigned char** pp, const unsigned char* end)
{
    const unsigned char* p = *pp;
    unsigned long cp;
    if (p >= end) {
        return -1;
    }
    if (p[0] < 0x80) {
        cp = p[0];
        *pp = p + 1;
    }
    else if (p[0] < 0xE0 && p + 1 < end) {
        cp = ((p[0] & 0x1F) << 6) | (p[1] & 0x3F);
        *pp = p + 2;
    }
    else if (p[0] < 0xF0 && p + 2 < end) {
        cp = ((p[0] & 0x0F) << 12) | ((p[1] & 0x3F) << 6) | (p[2] & 0x3F);
        *pp = p + 3;
    }
    else if (p[0] < 0xF8 && p + 3 < end) {
        cp = ((p[0] & 0x07) << 18) | ((p[1] & 0x3F) << 12) | ((p[2] & 0x3F) << 6) | (p[3] & 0x3F);
        *pp = p + 4;
    }
    else {
        return -1;
    }
    return (long)cp;
}

/* UTF-16 code-unit count of a UTF-8 string (surrogate pairs count as 2,
   exactly like charCodeAt sees them). Returns -1 on malformed UTF-8. */
static long utf8_unit_count(const unsigned char* p, const unsigned char* end)
{
    long n = 0;
    while (p < end) {
        long cp = utf8_decode_unit(&p, end);
        if (cp < 0) {
            return -1;
        }
        n += (cp > 0xFFFF) ? 2 : 1;
    }
    return n;
}

/* Append UTF-8 encoding of 16-bit unit u (lone surrogates rejected by the
   caller). Returns bytes written (1-3). */
static size_t utf8_encode_unit(char* out, unsigned u)
{
    if (u < 0x80) {
        out[0] = (char)u;
        return 1;
    }
    if (u < 0x800) {
        out[0] = (char)(0xC0 | (u >> 6));
        out[1] = (char)(0x80 | (u & 0x3F));
        return 2;
    }
    out[0] = (char)(0xE0 | (u >> 12));
    out[1] = (char)(0x80 | ((u >> 6) & 0x3F));
    out[2] = (char)(0x80 | (u & 0x3F));
    return 3;
}

static long arg_as_long(TaggedData* a)
{
    if (a->type == kTypeDouble) {
        return (long)a->data.fltval;
    }
    if (a->type == kTypeInteger || a->type == kTypeUInteger) {
        return a->data.intval;
    }
    return -1; /* invalid */
}

/* ---- direct methods ---- */

/* getVersion() -> string; no arguments, declared `_s` (ThioUtils pattern). */
ESCHARS_API long getVersion(TaggedData* argv, long argc, TaggedData* retval)
{
    (void)argv;
    (void)argc;
    retval->type = kTypeString;
    retval->data.string = dup_string("ESChars 1.0.0 (native charCodeAt/bulk-ops ExternalObject)");
    return kESErrOK;
}

/* add(a, b) -> double; numeric smoke test (the reliable channel). */
ESCHARS_API long add(TaggedData* argv, long argc, TaggedData* retval)
{
    if (argc != 2 || argv[0].type != kTypeDouble || argv[1].type != kTypeDouble) {
        return kESErrBadArgumentList;
    }
    retval->type = kTypeDouble;
    retval->data.fltval = argv[0].data.fltval + argv[1].data.fltval;
    return kESErrOK;
}

/* fail(code) -> throws a catchable custom error (ThioUtils pattern).
   ExtendScript surfaces it as "Error #" with error.number == code.
   Never return negative (fatal) codes from a method. */
ESCHARS_API long fail(TaggedData* argv, long argc, TaggedData* retval)
{
    long code;
    if (argc != 1 || (argv[0].type != kTypeInteger && argv[0].type != kTypeUInteger)) {
        return kESErrBadArgumentList;
    }
    code = ESCHARS_ERROR_BASE + argv[0].data.intval;
    retval->type = kTypeInteger;
    retval->data.intval = code;
    return code;
}

/* ---- per-call API (parity expected with the engine primitive — the win
        is the batch surface below; benchmark before trusting this lane) ----
   charCodeAt(s, index) -> kTypeInteger code unit at UTF-16 unit index
     (surrogate pairs count as 2 units, exactly like String.charCodeAt).
     Out-of-range index returns -1; the wrapper maps -1 to NaN.
   fromCharCode(u) -> kTypeString with that single code unit.
     Lone surrogates (0xD800-0xDFFF) cannot cross the UTF-8 boundary:
     rejected with ESCHARS_ERR_SURROGATE. */

ESCHARS_API long charCodeAt(TaggedData* argv, long argc, TaggedData* retval)
{
    const unsigned char* p;
    const unsigned char* end;
    long index, unit = 0;
    if (argc != 2 || argv[0].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    index = arg_as_long(&argv[1]);
    if (index < 0) {
        retval->type = kTypeInteger;
        retval->data.intval = -1; /* out of range -> NaN on the JS side */
        return kESErrOK;
    }
    p = (const unsigned char*)argv[0].data.string;
    end = p + strlen(argv[0].data.string);
    while (p < end) {
        long cp = utf8_decode_unit(&p, end);
        if (cp < 0) {
            return kESErrBadArgumentList; /* not valid UTF-8 */
        }
        if (cp > 0xFFFF) {
            unsigned long u = (unsigned long)cp - 0x10000u;
            unsigned int hi = (unsigned int)(0xD800u + (u >> 10));
            unsigned int lo = (unsigned int)(0xDC00u + (u & 0x3FFu));
            if (unit == index) {
                retval->type = kTypeInteger;
                retval->data.intval = (long)hi;
                return kESErrOK;
            }
            unit++;
            if (unit == index) {
                retval->type = kTypeInteger;
                retval->data.intval = (long)lo;
                return kESErrOK;
            }
            unit++;
        }
        else {
            if (unit == index) {
                retval->type = kTypeInteger;
                retval->data.intval = (long)cp;
                return kESErrOK;
            }
            unit++;
        }
    }
    retval->type = kTypeInteger;
    retval->data.intval = -1; /* out of range -> NaN on the JS side */
    return kESErrOK;
}

ESCHARS_API long fromCharCode(TaggedData* argv, long argc, TaggedData* retval)
{
    long u;
    char out[4];
    size_t n;
    char* b;
    if (argc != 1) {
        return kESErrBadArgumentList;
    }
    u = arg_as_long(&argv[0]);
    if (u < 0 || u > 0xFFFF) {
        return kESErrBadArgumentList;
    }
    if (u >= 0xD800 && u <= 0xDFFF) {
        return ESCHARS_ERR_SURROGATE; /* cannot cross the UTF-8 boundary */
    }
    n = utf8_encode_unit(out, (unsigned)u);
    b = (char*)malloc(n + 1);
    if (b == NULL) {
        return kESErrNoMemory;
    }
    memcpy(b, out, n);
    b[n] = '\0';
    retval->type = kTypeString;
    retval->data.string = b;
    return kESErrOK;
}

/* ---- bulk read/write channel ----
   packBytes(s): kTypeString where each char packs TWO input bytes
     (b0 | b1<<8), so JSX reads N/2 chars with charCodeAt + arithmetic.
     Input bytes must not form pairs whose second byte is 0xD8-0xDF
     (surrogate window in the packed value; ASCII/Latin-1 inputs are safe).
   unpackBytes(packed): inverse — real string from a 2-bytes-per-char
     packed string (the bulk fromCharCode replacement). */

ESCHARS_API long packBytes(TaggedData* argv, long argc, TaggedData* retval)
{
    const unsigned char* in;
    size_t n, outlen, i, o;
    char* out;
    if (argc != 1 || argv[0].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    in = (const unsigned char*)argv[0].data.string;
    n = strlen((const char*)in);
    outlen = (n + 1) / 2;
    out = (char*)malloc(outlen * 3 + 1); /* worst case: 3 UTF-8 bytes per packed char */
    if (out == NULL) {
        return kESErrNoMemory;
    }
    o = 0;
    for (i = 0; i + 1 < n; i += 2) {
        unsigned v = (unsigned)in[i] | ((unsigned)in[i + 1] << 8);
        /* UTF-8-encode v (0..0x7FFF here; 0xD800-0xDFFF cannot occur when
           in[i+1] < 0xD8, which the caller must guarantee) */
        if (v < 0x80) {
            out[o++] = (char)v;
        }
        else if (v < 0x800) {
            out[o++] = (char)(0xC0 | (v >> 6));
            out[o++] = (char)(0x80 | (v & 0x3F));
        }
        else {
            out[o++] = (char)(0xE0 | (v >> 12));
            out[o++] = (char)(0x80 | ((v >> 6) & 0x3F));
            out[o++] = (char)(0x80 | (v & 0x3F));
        }
    }
    if (i < n) {
        unsigned v = (unsigned)in[i]; /* last odd byte: pack with high byte 0 */
        if (v < 0x80) {
            out[o++] = (char)v;
        }
        else {
            out[o++] = (char)(0xC0 | (v >> 6));
            out[o++] = (char)(0x80 | (v & 0x3F));
        }
    }
    out[o] = '\0';
    retval->type = kTypeString;
    retval->data.string = out;
    return kESErrOK;
}

ESCHARS_API long unpackBytes(TaggedData* argv, long argc, TaggedData* retval)
{
    const unsigned char* p;
    const unsigned char* end;
    size_t n, o = 0;
    char* out;
    if (argc != 1 || argv[0].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    p = (const unsigned char*)argv[0].data.string;
    end = p + strlen((const char*)p);
    /* worst case: 2 output bytes per packed char */
    n = 0;
    {
        const unsigned char* q = p;
        while (q < end) {
            long cp = utf8_decode_unit(&q, end);
            if (cp < 0) {
                return kESErrBadArgumentList;
            }
            n += 2;
        }
    }
    out = (char*)malloc(n + 1);
    if (out == NULL) {
        return kESErrNoMemory;
    }
    while (p < end) {
        long cp = utf8_decode_unit(&p, end);
        if (cp < 0) {
            free(out);
            return kESErrBadArgumentList;
        }
        out[o++] = (char)(cp & 0xFF);
        if (cp >= 0x100) {
            out[o++] = (char)((cp >> 8) & 0xFF);
        }
    }
    out[o] = '\0';
    retval->type = kTypeString;
    retval->data.string = out;
    return kESErrOK;
}

/* ---- whole-workload-native transforms ----
   hexEncode(s)   -> lowercase hex (2x expansion)
   hexDecode(s)   -> bytes from hex
   crc32(s)       -> IEEE CRC-32 as kTypeInteger
   fnv1a32(s)     -> FNV-1a 32-bit as kTypeInteger
   translate(s, hexTable) -> per-byte lookup transform; hexTable is
     512 hex chars = 256 bytes (the only safe arbitrary-byte transport
     through the UTF-8 boundary); table[in[i]] -> out[i]
   b64ToHex(s)    -> base64 input decoded then hex-encoded, in ONE call
     (amortizes the boundary: 1 crossing instead of 2). */

static const char hex_lower[] = "0123456789abcdef";

static int hex_val(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

ESCHARS_API long hexEncode(TaggedData* argv, long argc, TaggedData* retval)
{
    const unsigned char* in;
    size_t n, i;
    char* out;
    if (argc != 1 || argv[0].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    in = (const unsigned char*)argv[0].data.string;
    n = strlen((const char*)in);
    out = (char*)malloc(n * 2 + 1);
    if (out == NULL) {
        return kESErrNoMemory;
    }
    for (i = 0; i < n; i++) {
        out[i * 2] = hex_lower[in[i] >> 4];
        out[i * 2 + 1] = hex_lower[in[i] & 0xF];
    }
    out[n * 2] = '\0';
    retval->type = kTypeString;
    retval->data.string = out;
    return kESErrOK;
}

ESCHARS_API long hexDecode(TaggedData* argv, long argc, TaggedData* retval)
{
    const char* in;
    size_t n, i, o = 0;
    char* out;
    if (argc != 1 || argv[0].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    in = argv[0].data.string;
    n = strlen(in);
    if (n % 2 != 0) {
        return ESCHARS_ERR_BAD_HEX;
    }
    out = (char*)malloc(n / 2 + 1);
    if (out == NULL) {
        return kESErrNoMemory;
    }
    for (i = 0; i + 1 < n; i += 2) {
        int hi = hex_val(in[i]);
        int lo = hex_val(in[i + 1]);
        if (hi < 0 || lo < 0) {
            free(out);
            return ESCHARS_ERR_BAD_HEX;
        }
        out[o++] = (char)((hi << 4) | lo);
    }
    out[o] = '\0';
    retval->type = kTypeString;
    retval->data.string = out;
    return kESErrOK;
}

static unsigned crc32_bytes(const unsigned char* p, size_t n)
{
    static unsigned tab[256];
    static int tab_init = 0;
    size_t i;
    unsigned crc;
    if (!tab_init) {
        unsigned t;
        for (t = 0; t < 256; t++) {
            unsigned c = t;
            int k;
            for (k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
            }
            tab[t] = c;
        }
        tab_init = 1;
    }
    crc = 0xFFFFFFFFu;
    for (i = 0; i < n; i++) {
        crc = tab[(crc ^ p[i]) & 0xFF] ^ (crc >> 8);
    }
    return crc ^ 0xFFFFFFFFu;
}

ESCHARS_API long crc32(TaggedData* argv, long argc, TaggedData* retval)
{
    if (argc != 1 || argv[0].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    retval->type = kTypeInteger;
    retval->data.intval = (long)crc32_bytes((const unsigned char*)argv[0].data.string,
                                            strlen(argv[0].data.string));
    return kESErrOK;
}

ESCHARS_API long fnv1a32(TaggedData* argv, long argc, TaggedData* retval)
{
    if (argc != 1 || argv[0].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    retval->type = kTypeInteger;
    retval->data.intval = (long)fnv1a32_bytes((const unsigned char*)argv[0].data.string,
                                              strlen(argv[0].data.string));
    return kESErrOK;
}

ESCHARS_API long translate(TaggedData* argv, long argc, TaggedData* retval)
{
    unsigned char tab[256];
    const char* th;
    const unsigned char* in;
    size_t n, i, ti;
    char* out;
    if (argc != 2 || argv[0].type != kTypeString || argv[1].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    /* table arrives as 512 lowercase/uppercase hex chars (the only fully
       safe byte transport through the UTF-8 boundary — packed values in
       the surrogate window 0xD800-0xDFFF cannot round-trip) */
    th = argv[1].data.string;
    if (strlen(th) != 512) {
        return ESCHARS_ERR_BAD_HEX;
    }
    for (ti = 0; ti < 256; ti++) {
        int hi = hex_val(th[ti * 2]);
        int lo = hex_val(th[ti * 2 + 1]);
        if (hi < 0 || lo < 0) {
            return ESCHARS_ERR_BAD_HEX;
        }
        tab[ti] = (unsigned char)((hi << 4) | lo);
    }
    in = (const unsigned char*)argv[0].data.string;
    n = strlen((const char*)in);
    out = (char*)malloc(n + 1);
    if (out == NULL) {
        return kESErrNoMemory;
    }
    for (i = 0; i < n; i++) {
        out[i] = (char)tab[in[i]];
    }
    out[n] = '\0';
    retval->type = kTypeString;
    retval->data.string = out;
    return kESErrOK;
}

/* ---- base64 (native loop — the "move the loop native" win) ---- */

static const char b64_alphabet[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static char* b64_encode(const unsigned char* in, size_t n)
{
    size_t outlen = ((n + 2) / 3) * 4;
    char* out = (char*)malloc(outlen + 1);
    size_t i = 0, o = 0;
    if (out == NULL) {
        return NULL;
    }
    while (i + 3 <= n) {
        unsigned long v = ((unsigned long)in[i] << 16) | ((unsigned long)in[i + 1] << 8) | in[i + 2];
        out[o++] = b64_alphabet[(v >> 18) & 63];
        out[o++] = b64_alphabet[(v >> 12) & 63];
        out[o++] = b64_alphabet[(v >> 6) & 63];
        out[o++] = b64_alphabet[v & 63];
        i += 3;
    }
    if (n - i == 1) {
        unsigned long v = (unsigned long)in[i] << 16;
        out[o++] = b64_alphabet[(v >> 18) & 63];
        out[o++] = b64_alphabet[(v >> 12) & 63];
        out[o++] = '=';
        out[o++] = '=';
    }
    else if (n - i == 2) {
        unsigned long v = ((unsigned long)in[i] << 16) | ((unsigned long)in[i + 1] << 8);
        out[o++] = b64_alphabet[(v >> 18) & 63];
        out[o++] = b64_alphabet[(v >> 12) & 63];
        out[o++] = b64_alphabet[(v >> 6) & 63];
        out[o++] = '=';
    }
    out[outlen] = '\0';
    return out;
}

static int b64_val(char c)
{
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

static char* b64_decode(const char* in, size_t n, size_t* outlenp)
{
    size_t outlen, i = 0, o = 0;
    char* out;
    while (n > 0 && (in[n - 1] == '=' || in[n - 1] == '\r' || in[n - 1] == '\n')) {
        n--;
    }
    if (n % 4 == 1) {
        return NULL; /* invalid length */
    }
    outlen = (n / 4) * 3 + (n % 4 == 2 ? 1u : (n % 4 == 3 ? 2u : 0u));
    out = (char*)malloc(outlen + 1);
    if (out == NULL) {
        return NULL;
    }
    while (i + 4 <= n) {
        int a = b64_val(in[i]), b = b64_val(in[i + 1]), c = b64_val(in[i + 2]), d = b64_val(in[i + 3]);
        unsigned long v;
        if (a < 0 || b < 0 || c < 0 || d < 0) {
            free(out);
            return NULL;
        }
        v = ((unsigned long)a << 18) | ((unsigned long)b << 12) | ((unsigned long)c << 6) | (unsigned long)d;
        out[o++] = (char)((v >> 16) & 0xFF);
        out[o++] = (char)((v >> 8) & 0xFF);
        out[o++] = (char)(v & 0xFF);
        i += 4;
    }
    if (n - i == 2) {
        int a = b64_val(in[i]), b = b64_val(in[i + 1]);
        if (a < 0 || b < 0) {
            free(out);
            return NULL;
        }
        out[o++] = (char)(((a << 18) | (b << 12)) >> 16);
    }
    else if (n - i == 3) {
        int a = b64_val(in[i]), b = b64_val(in[i + 1]), c = b64_val(in[i + 2]);
        unsigned long v;
        if (a < 0 || b < 0 || c < 0) {
            free(out);
            return NULL;
        }
        v = ((unsigned long)a << 18) | ((unsigned long)b << 12) | ((unsigned long)c << 6);
        out[o++] = (char)((v >> 16) & 0xFF);
        out[o++] = (char)((v >> 8) & 0xFF);
    }
    out[outlen] = '\0';
    if (outlenp != NULL) {
        *outlenp = outlen;
    }
    return out;
}

/* b64encode(s) -> base64 string (native loop; the charCodeAt-loop
   replacement). */
ESCHARS_API long b64encode(TaggedData* argv, long argc, TaggedData* retval)
{
    const char* in;
    char* out;
    if (argc != 1 || argv[0].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    in = argv[0].data.string;
    out = b64_encode((const unsigned char*)in, strlen(in));
    if (out == NULL) {
        return kESErrNoMemory;
    }
    retval->type = kTypeString;
    retval->data.string = out;
    return kESErrOK;
}

/* b64decode(s) -> decoded string (UTF-8 bytes; NUL-free payloads only —
   binary-safe transport needs the staged/length channel). */
ESCHARS_API long b64decode(TaggedData* argv, long argc, TaggedData* retval)
{
    size_t outlen = 0;
    char* out;
    if (argc != 1 || argv[0].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    out = b64_decode(argv[0].data.string, strlen(argv[0].data.string), &outlen);
    if (out == NULL) {
        return kESErrBadArgumentList; /* invalid base64 */
    }
    retval->type = kTypeString;
    retval->data.string = out;
    return kESErrOK;
}

ESCHARS_API long b64ToHex(TaggedData* argv, long argc, TaggedData* retval)
{
    size_t outlen = 0, i;
    char* dec;
    char* out;
    if (argc != 1 || argv[0].type != kTypeString) {
        return kESErrBadArgumentList;
    }
    dec = b64_decode(argv[0].data.string, strlen(argv[0].data.string), &outlen);
    if (dec == NULL) {
        return kESErrBadArgumentList;
    }
    out = (char*)malloc(outlen * 2 + 1);
    if (out == NULL) {
        free(dec);
        return kESErrNoMemory;
    }
    for (i = 0; i < outlen; i++) {
        out[i * 2] = hex_lower[((unsigned char)dec[i]) >> 4];
        out[i * 2 + 1] = hex_lower[((unsigned char)dec[i]) & 0xF];
    }
    free(dec);
    out[outlen * 2] = '\0';
    retval->type = kTypeString;
    retval->data.string = out;
    return kESErrOK;
}
