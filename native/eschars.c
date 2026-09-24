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
 *  - ESABI value layout and tags come from the pinned ESABI dependency; ESABI_TYPE_STRING=4,
 *    ESABI_TYPE_INTEGER=123 (ESABI + prior live tag sweep).
 *  - Signature string with `_s` on no-arg methods, `_d` casts args to
 *    ESABI_TYPE_INTEGER (measured), custom catchable errors >= 10000 (ThioUtils).
 *  - Never return negative error codes (fatal, uncatchable).
 *  - Channel rules (measured): NUL truncates the string channel; packed
 *    values in the surrogate window 0xD800-0xDFFF cannot round-trip —
 *    arbitrary byte tables travel as 512-char hex.
 *
 * Build:  powershell -File build.ps1                (-> bin/ESChars.dll)
 *         powershell -File build.ps1 -Cli           (-> bin/ESChars-cli.exe)
 * Test:   probe.jsx inside Illustrator; Node differential harness.
 *
 * ABI: every method is long fn(esabi_value* argv, long argc, esabi_value*
 * retval). Retval is preset to ESABI_TYPE_UNDEFINED; zero the slot before
 * writing. Strings are allocated with malloc and freed by ExtendScript
 * via ESFreeMem.
 ***************************************************************************/

#include <esabi/esabi.h>
#include <stdio.h>   /* _snprintf_s/_TRUNCATE (trimModernBounds) */
#include <stdlib.h>
#include <string.h>

/* Custom catchable error base (ThioUtils convention: >= 10000). */
#define ESCHARS_ERROR_BASE 10000
#define ESCHARS_ERR_TOO_LARGE   (ESCHARS_ERROR_BASE + 1)
#define ESCHARS_ERR_SURROGATE   (ESCHARS_ERROR_BASE + 2)
#define ESCHARS_ERR_BAD_HEX     (ESCHARS_ERROR_BASE + 3)

/* ---- mandatory entry points ---- */

ESABI_INITIALIZE_FUNCTION
{
    (void)argv;
    (void)argc;
    /* Signature string: used for argument casting + reflection only;
       methods remain callable even without an entry (Adobe returns NULL). */
    return "getVersion_s,add_ff,charCodeAt_sd,fromCharCode_d,fnv1a32_s,packBytes_s,unpackBytes_s,hexEncode_s,hexDecode_s,crc32_s,translate_ss,b64ToHex_s,b64encode_s,b64decode_s,trimModern_s,trimModernLeft_s,trimModernRight_s,trimModernBounds_s,fail_u";
}

ESABI_VERSION_FUNCTION
{
    /* Mirror AdobeXMPScript: literal constant, no negotiation. */
    return 1;
}

ESABI_FREE_FUNCTION
{
    /* Must match the allocator used for returned strings (malloc/_strdup). */
    free(pointer);
}

ESABI_TERMINATE_FUNCTION
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

static long arg_as_long(esabi_value* a)
{
    if (a->type == ESABI_TYPE_DOUBLE) {
        return (long)a->payload.double_value;
    }
    if (a->type == ESABI_TYPE_INTEGER || a->type == ESABI_TYPE_UINTEGER) {
        return a->payload.signed_value;
    }
    return -1; /* invalid */
}

/* ---- direct methods ---- */

/* getVersion() -> string; no arguments, declared `_s` (ThioUtils pattern). */
ESABI_DIRECT_FUNCTION(getVersion)
{
    (void)argv;
    (void)argc;
    esabi_value_set_string(retval, dup_string("ESChars 1.1.2 (native charCodeAt/bulk-ops/trim ExternalObject)"));
    return ESABI_OK;
}

/* add(a, b) -> double; numeric smoke test (the reliable channel). */
ESABI_DIRECT_FUNCTION(add)
{
    if (argc != 2 || argv[0].type != ESABI_TYPE_DOUBLE || argv[1].type != ESABI_TYPE_DOUBLE) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    esabi_value_set_double(retval, argv[0].payload.double_value + argv[1].payload.double_value);
    return ESABI_OK;
}

/* fail(code) -> throws a catchable custom error (ThioUtils pattern).
   ExtendScript surfaces it as "Error #" with error.number == code.
   Never return negative (fatal) codes from a method. */
ESABI_DIRECT_FUNCTION(fail)
{
    long code;
    if (argc != 1 || (argv[0].type != ESABI_TYPE_INTEGER && argv[0].type != ESABI_TYPE_UINTEGER)) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    code = ESCHARS_ERROR_BASE + argv[0].payload.signed_value;
    esabi_value_set_i32(retval, (esabi_i32)(code));
    return code;
}

/* ---- per-call API (parity expected with the engine primitive — the win
        is the batch surface below; benchmark before trusting this lane) ----
   charCodeAt(s, index) -> ESABI_TYPE_INTEGER code unit at UTF-16 unit index
     (surrogate pairs count as 2 units, exactly like String.charCodeAt).
     Out-of-range index returns -1; the wrapper maps -1 to NaN.
   fromCharCode(u) -> ESABI_TYPE_STRING with that single code unit.
     Lone surrogates (0xD800-0xDFFF) cannot cross the UTF-8 boundary:
     rejected with ESCHARS_ERR_SURROGATE. */

ESABI_DIRECT_FUNCTION(charCodeAt)
{
    const unsigned char* p;
    const unsigned char* end;
    long index, unit = 0;
    if (argc != 2 || argv[0].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    index = arg_as_long(&argv[1]);
    if (index < 0) {
        esabi_value_set_i32(retval, (esabi_i32)(-1)); /* out of range -> NaN on the JS side */
        return ESABI_OK;
    }
    p = (const unsigned char*)argv[0].payload.string_value;
    end = p + strlen(argv[0].payload.string_value);
    while (p < end) {
        long cp = utf8_decode_unit(&p, end);
        if (cp < 0) {
            return ESABI_ERR_BAD_ARGUMENTS; /* not valid UTF-8 */
        }
        if (cp > 0xFFFF) {
            unsigned long u = (unsigned long)cp - 0x10000u;
            unsigned int hi = (unsigned int)(0xD800u + (u >> 10));
            unsigned int lo = (unsigned int)(0xDC00u + (u & 0x3FFu));
            if (unit == index) {
                esabi_value_set_i32(retval, (esabi_i32)((long)hi));
                return ESABI_OK;
            }
            unit++;
            if (unit == index) {
                esabi_value_set_i32(retval, (esabi_i32)((long)lo));
                return ESABI_OK;
            }
            unit++;
        }
        else {
            if (unit == index) {
                esabi_value_set_i32(retval, (esabi_i32)((long)cp));
                return ESABI_OK;
            }
            unit++;
        }
    }
    esabi_value_set_i32(retval, (esabi_i32)(-1)); /* out of range -> NaN on the JS side */
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(fromCharCode)
{
    long u;
    char out[4];
    size_t n;
    char* b;
    if (argc != 1) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    u = arg_as_long(&argv[0]);
    if (u < 0 || u > 0xFFFF) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    if (u >= 0xD800 && u <= 0xDFFF) {
        return ESCHARS_ERR_SURROGATE; /* cannot cross the UTF-8 boundary */
    }
    n = utf8_encode_unit(out, (unsigned)u);
    b = (char*)malloc(n + 1);
    if (b == NULL) {
        return ESABI_ERR_OUT_OF_MEMORY;
    }
    memcpy(b, out, n);
    b[n] = '\0';
    esabi_value_set_string(retval, b);
    return ESABI_OK;
}

/* ---- bulk read/write channel ----
   packBytes(s): ESABI_TYPE_STRING where each char packs TWO input bytes
     (b0 | b1<<8), so JSX reads N/2 chars with charCodeAt + arithmetic.
     Input bytes must not form pairs whose second byte is 0xD8-0xDF
     (surrogate window in the packed value; ASCII/Latin-1 inputs are safe).
   unpackBytes(packed): inverse — real string from a 2-bytes-per-char
     packed string (the bulk fromCharCode replacement). */

ESABI_DIRECT_FUNCTION(packBytes)
{
    const unsigned char* in;
    size_t n, outlen, i, o;
    char* out;
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    in = (const unsigned char*)argv[0].payload.string_value;
    n = strlen((const char*)in);
    outlen = (n + 1) / 2;
    out = (char*)malloc(outlen * 3 + 1); /* worst case: 3 UTF-8 bytes per packed char */
    if (out == NULL) {
        return ESABI_ERR_OUT_OF_MEMORY;
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
    esabi_value_set_string(retval, out);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(unpackBytes)
{
    const unsigned char* p;
    const unsigned char* end;
    size_t n, o = 0;
    char* out;
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    p = (const unsigned char*)argv[0].payload.string_value;
    end = p + strlen((const char*)p);
    /* worst case: 2 output bytes per packed char */
    n = 0;
    {
        const unsigned char* q = p;
        while (q < end) {
            long cp = utf8_decode_unit(&q, end);
            if (cp < 0) {
                return ESABI_ERR_BAD_ARGUMENTS;
            }
            n += 2;
        }
    }
    out = (char*)malloc(n + 1);
    if (out == NULL) {
        return ESABI_ERR_OUT_OF_MEMORY;
    }
    while (p < end) {
        long cp = utf8_decode_unit(&p, end);
        if (cp < 0) {
            free(out);
            return ESABI_ERR_BAD_ARGUMENTS;
        }
        out[o++] = (char)(cp & 0xFF);
        if (cp >= 0x100) {
            out[o++] = (char)((cp >> 8) & 0xFF);
        }
    }
    out[o] = '\0';
    esabi_value_set_string(retval, out);
    return ESABI_OK;
}

/* ---- whole-workload-native transforms ----
   hexEncode(s)   -> lowercase hex (2x expansion)
   hexDecode(s)   -> bytes from hex
   crc32(s)       -> IEEE CRC-32 as ESABI_TYPE_INTEGER
   fnv1a32(s)     -> FNV-1a 32-bit as ESABI_TYPE_INTEGER
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

ESABI_DIRECT_FUNCTION(hexEncode)
{
    const unsigned char* in;
    size_t n, i;
    char* out;
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    in = (const unsigned char*)argv[0].payload.string_value;
    n = strlen((const char*)in);
    out = (char*)malloc(n * 2 + 1);
    if (out == NULL) {
        return ESABI_ERR_OUT_OF_MEMORY;
    }
    for (i = 0; i < n; i++) {
        out[i * 2] = hex_lower[in[i] >> 4];
        out[i * 2 + 1] = hex_lower[in[i] & 0xF];
    }
    out[n * 2] = '\0';
    esabi_value_set_string(retval, out);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(hexDecode)
{
    const char* in;
    size_t n, i, o = 0;
    char* out;
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    in = argv[0].payload.string_value;
    n = strlen(in);
    if (n % 2 != 0) {
        return ESCHARS_ERR_BAD_HEX;
    }
    out = (char*)malloc(n / 2 + 1);
    if (out == NULL) {
        return ESABI_ERR_OUT_OF_MEMORY;
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
    esabi_value_set_string(retval, out);
    return ESABI_OK;
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

ESABI_DIRECT_FUNCTION(crc32)
{
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    esabi_value_set_i32(retval, (esabi_i32)((long)crc32_bytes((const unsigned char*)argv[0].payload.string_value,
                                            strlen(argv[0].payload.string_value))));
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(fnv1a32)
{
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    esabi_value_set_i32(retval, (esabi_i32)((long)fnv1a32_bytes((const unsigned char*)argv[0].payload.string_value,
                                              strlen(argv[0].payload.string_value))));
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(translate)
{
    unsigned char tab[256];
    const char* th;
    const unsigned char* in;
    size_t n, i, ti;
    char* out;
    if (argc != 2 || argv[0].type != ESABI_TYPE_STRING || argv[1].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    /* table arrives as 512 lowercase/uppercase hex chars (the only fully
       safe byte transport through the UTF-8 boundary — packed values in
       the surrogate window 0xD800-0xDFFF cannot round-trip) */
    th = argv[1].payload.string_value;
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
    in = (const unsigned char*)argv[0].payload.string_value;
    n = strlen((const char*)in);
    out = (char*)malloc(n + 1);
    if (out == NULL) {
        return ESABI_ERR_OUT_OF_MEMORY;
    }
    for (i = 0; i < n; i++) {
        out[i] = (char)tab[in[i]];
    }
    out[n] = '\0';
    esabi_value_set_string(retval, out);
    return ESABI_OK;
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
ESABI_DIRECT_FUNCTION(b64encode)
{
    const char* in;
    char* out;
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    in = argv[0].payload.string_value;
    out = b64_encode((const unsigned char*)in, strlen(in));
    if (out == NULL) {
        return ESABI_ERR_OUT_OF_MEMORY;
    }
    esabi_value_set_string(retval, out);
    return ESABI_OK;
}

/* b64decode(s) -> decoded string (UTF-8 bytes; NUL-free payloads only —
   binary-safe transport needs the staged/length channel). */
ESABI_DIRECT_FUNCTION(b64decode)
{
    size_t outlen = 0;
    char* out;
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    out = b64_decode(argv[0].payload.string_value, strlen(argv[0].payload.string_value), &outlen);
    if (out == NULL) {
        return ESABI_ERR_BAD_ARGUMENTS; /* invalid base64 */
    }
    esabi_value_set_string(retval, out);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(b64ToHex)
{
    size_t outlen = 0, i;
    char* dec;
    char* out;
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    dec = b64_decode(argv[0].payload.string_value, strlen(argv[0].payload.string_value), &outlen);
    if (dec == NULL) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    out = (char*)malloc(outlen * 2 + 1);
    if (out == NULL) {
        free(dec);
        return ESABI_ERR_OUT_OF_MEMORY;
    }
    for (i = 0; i < outlen; i++) {
        out[i * 2] = hex_lower[((unsigned char)dec[i]) >> 4];
        out[i * 2 + 1] = hex_lower[((unsigned char)dec[i]) & 0xF];
    }
    free(dec);
    out[outlen * 2] = '\0';
    esabi_value_set_string(retval, out);
    return ESABI_OK;
}

/* ---- modern trim / edge scan --------------------------------------------
   Semantics match ESSTR/modern V8 trim over UTF-8 bytes (strip TAB LF VT FF
   CR SP NBSP U+1680 U+2000-200A U+2028 U+2029 U+202F U+205F U+3000 U+FEFF;
   keep U+180E U+0085 U+200B). Because the direct ExternalObject string
   channel is C-NUL-terminated, U+0000 truncates at the boundary before this
   function can see it. Lone surrogates are not valid UTF-8 and must be handled
   by a caller-side fallback when code-unit preservation is required.

   Boundary behavior (verified by native/trim-selftest.c + tests/trim-differential.mjs):
   - NUL: strlen() stops at the first U+0000; bytes after it are invisible
     to the scanner (the channel drops them, not this code).
   - Surrogates: valid pairs pass through untouched (they encode as 4-byte
     UTF-8 and never match the whitespace table); lone surrogates cannot
     survive the UTF-16->UTF-8 channel (host substitutes/drops them).
   - Bounds contract: trimModernBounds returns "st,en" as decimal UTF-8 byte
     offsets into the ORIGINAL string; en is clamped to >= st, so an
     all-whitespace input reports "len,len" (empty region at string end).
   - All four methods: exactly 1 string arg; argc!=1 -> ESABI_ERR_BAD_ARGUMENTS
     (TypeError); OOM -> ESABI_ERR_OUT_OF_MEMORY (house style, matches sibling
     methods; note ESSTR uses a positive custom code instead). */

static int trim_bytes_at(const unsigned char* s, size_t len, size_t pos,
                         unsigned char a, unsigned char b, unsigned char c)
{
    return pos + 3 <= len && s[pos] == a && s[pos + 1] == b && s[pos + 2] == c;
}

static size_t trim_leading_ws_len(const unsigned char* s, size_t len, size_t pos)
{
    unsigned char c;
    if (pos >= len) return 0;
    c = s[pos];
    if (c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D || c == 0x0B || c == 0x0C) return 1;
    if (c == 0xC2 && pos + 1 < len && s[pos + 1] == 0xA0) return 2; /* NBSP */
    if (trim_bytes_at(s, len, pos, 0xE1, 0x9A, 0x80)) return 3; /* U+1680 */
    if (c == 0xE2 && pos + 2 < len) {
        if (s[pos + 1] == 0x80) {
            c = s[pos + 2];
            if ((c >= 0x80 && c <= 0x8A) || c == 0xA8 || c == 0xA9 || c == 0xAF) return 3;
        }
        if (s[pos + 1] == 0x81 && s[pos + 2] == 0x9F) return 3; /* U+205F */
    }
    if (trim_bytes_at(s, len, pos, 0xE3, 0x80, 0x80)) return 3; /* U+3000 */
    if (trim_bytes_at(s, len, pos, 0xEF, 0xBB, 0xBF)) return 3; /* U+FEFF */
    return 0;
}

static size_t trim_trailing_ws_len(const unsigned char* s, size_t start, size_t end)
{
    unsigned char c;
    if (end <= start) return 0;
    c = s[end - 1];
    if (c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D || c == 0x0B || c == 0x0C) return 1;
    if (end >= start + 2 && s[end - 2] == 0xC2 && s[end - 1] == 0xA0) return 2;
    if (end >= start + 3) {
        size_t p = end - 3;
        if (s[p] == 0xE1 && s[p + 1] == 0x9A && s[p + 2] == 0x80) return 3;
        if (s[p] == 0xE2 && s[p + 1] == 0x80) {
            c = s[p + 2];
            if ((c >= 0x80 && c <= 0x8A) || c == 0xA8 || c == 0xA9 || c == 0xAF) return 3;
        }
        if (s[p] == 0xE2 && s[p + 1] == 0x81 && s[p + 2] == 0x9F) return 3;
        if (s[p] == 0xE3 && s[p + 1] == 0x80 && s[p + 2] == 0x80) return 3;
        if (s[p] == 0xEF && s[p + 1] == 0xBB && s[p + 2] == 0xBF) return 3;
    }
    return 0;
}

static char* trim_dup_range(const char* s, size_t start, size_t end)
{
    size_t n = end > start ? end - start : 0;
    char* out = (char*)malloc(n + 1);
    if (out == NULL) return NULL;
    if (n) memcpy(out, s + start, n);
    out[n] = '\0';
    return out;
}

static long trim_modern_impl(esabi_value* argv, long argc, esabi_value* retval, int mode)
{
    const char* in;
    const unsigned char* u;
    size_t len, st, en, n;
    char* out;
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING || argv[0].payload.string_value == NULL) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    in = argv[0].payload.string_value;
    u = (const unsigned char*)in;
    len = strlen(in);
    st = 0;
    en = len;
    if (mode != 2) {
        while ((n = trim_leading_ws_len(u, len, st)) != 0) st += n;
    }
    if (mode != 1) {
        while ((n = trim_trailing_ws_len(u, st, en)) != 0) en -= n;
    }
    out = trim_dup_range(in, st, en);
    if (out == NULL) return ESABI_ERR_OUT_OF_MEMORY;
    esabi_value_set_string(retval, out);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(trimModern) { return trim_modern_impl(argv, argc, retval, 0); }
ESABI_DIRECT_FUNCTION(trimModernLeft) { return trim_modern_impl(argv, argc, retval, 1); }
ESABI_DIRECT_FUNCTION(trimModernRight) { return trim_modern_impl(argv, argc, retval, 2); }

ESABI_DIRECT_FUNCTION(trimModernBounds)
{
    const char* in;
    const unsigned char* u;
    size_t len, st, en, n;
    char buf[64];
    char* out;
    if (argc != 1 || argv[0].type != ESABI_TYPE_STRING || argv[0].payload.string_value == NULL) {
        return ESABI_ERR_BAD_ARGUMENTS;
    }
    in = argv[0].payload.string_value;
    u = (const unsigned char*)in;
    len = strlen(in);
    st = 0;
    en = len;
    while ((n = trim_leading_ws_len(u, len, st)) != 0) st += n;
    while ((n = trim_trailing_ws_len(u, st, en)) != 0) en -= n;
    _snprintf_s(buf, sizeof(buf), _TRUNCATE, "%u,%u", (unsigned)st, (unsigned)en);
    out = dup_string(buf);
    if (out == NULL) return ESABI_ERR_OUT_OF_MEMORY;
    esabi_value_set_string(retval, out);
    return ESABI_OK;
}
