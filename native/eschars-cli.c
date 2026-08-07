/***************************************************************************
 * ESChars CLI — console differential harness for the ESChars DLL logic.
 *
 * Compiles eschars.c INTO the EXE (same translation unit, same helpers,
 * same method functions) and drives it over stdin with a binary-safe
 * frame protocol so Node can differential-test the native code paths
 * headlessly (no Illustrator needed):
 *
 *   Request:  <command> "\n" then one frame per argument
 *             frame    = u32le byteLength + raw bytes (NUL-safe)
 *             commands = b64encode b64decode hexEncode hexDecode crc32
 *                        fnv1a32 packBytes unpackBytes translate b64ToHex
 *                        charCodeAt fromCharCode
 *   Response: one frame of the result:
 *             "S" + u32le length + bytes          (kTypeString)
 *             "I" + i32le value                   (kTypeInteger)
 *             "D" + f64le value                   (kTypeDouble)
 *             "E" + i32le error code              (method error code)
 *
 * Exit code 0 always (results/errors travel in-band); stdin EOF -> exit.
 ***************************************************************************/

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#include "eschars.c"

static int read_bytes(unsigned char* buf, size_t n)
{
    size_t got = fread(buf, 1, n, stdin);
    return got == n;
}

static int read_u32le(unsigned long* out)
{
    unsigned char b[4];
    if (!read_bytes(b, 4)) {
        return 0;
    }
    *out = (unsigned long)b[0] | ((unsigned long)b[1] << 8) |
           ((unsigned long)b[2] << 16) | ((unsigned long)b[3] << 24);
    return 1;
}

static int read_frame(unsigned char** data, size_t* len)
{
    unsigned long n;
    unsigned char* p;
    if (!read_u32le(&n)) {
        return 0;
    }
    if (n > 64u * 1024u * 1024u) {
        fprintf(stderr, "frame too large: %lu\n", n);
        return 0;
    }
    p = (unsigned char*)malloc(n + 1);
    if (p == NULL) {
        fprintf(stderr, "out of memory reading frame\n");
        return 0;
    }
    if (!read_bytes(p, n)) {
        free(p);
        return 0;
    }
    p[n] = '\0';
    *data = p;
    *len = n;
    return 1;
}

static void write_bytes(const unsigned char* p, size_t n)
{
    fwrite(p, 1, n, stdout);
}

static void write_u32le(unsigned long v)
{
    unsigned char b[4];
    b[0] = (unsigned char)(v & 0xFF);
    b[1] = (unsigned char)((v >> 8) & 0xFF);
    b[2] = (unsigned char)((v >> 16) & 0xFF);
    b[3] = (unsigned char)((v >> 24) & 0xFF);
    write_bytes(b, 4);
}

static void write_i32le(long v)
{
    unsigned char b[4];
    b[0] = (unsigned char)(v & 0xFF);
    b[1] = (unsigned char)((v >> 8) & 0xFF);
    b[2] = (unsigned char)((v >> 16) & 0xFF);
    b[3] = (unsigned char)((v >> 24) & 0xFF);
    write_bytes(b, 4);
}

static void write_f64le(double v)
{
    unsigned char b[8];
    unsigned long long bits;
    int i;
    memcpy(&bits, &v, 8);
    for (i = 0; i < 8; i++) {
        b[i] = (unsigned char)(bits >> (8 * i));
    }
    write_bytes(b, 8);
}

/* Complete error response: "E" + i32le code + newline + flush. */
static void write_error(long rc)
{
    fputc('E', stdout);
    write_i32le(rc);
    fputc('\n', stdout);
    fflush(stdout);
}

int main(void)
{
    char cmd[64];
    int c;
    size_t i = 0;
    long rc;

    /* Binary mode: the frame protocol carries raw bytes; Windows text mode
       would translate every 0x0a into 0x0d 0x0a and corrupt length prefixes. */
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif

    while (1) {
        i = 0;
        while (i < 63) {
            c = fgetc(stdin);
            if (c == EOF) {
                return 0; /* clean EOF -> exit */
            }
            if (c == '\n') {
                break;
            }
            cmd[i++] = (char)c;
        }
        cmd[i] = '\0';
        if (i == 0) {
            continue;
        }

        if (strcmp(cmd, "b64encode") == 0) {
            unsigned char* a0; size_t l0; TaggedData argv[1]; TaggedData rv;
            memset(&rv, 0, sizeof(rv));
            if (!read_frame(&a0, &l0)) return 1;
            (void)l0;
            argv[0].type = kTypeString; argv[0].data.string = (char*)a0;
            rc = b64encode(argv, 1, &rv);
            if (rc != kESErrOK) { write_error(rc); continue; }
            fputc('S', stdout); write_u32le((unsigned long)strlen(rv.data.string));
            write_bytes((const unsigned char*)rv.data.string, strlen(rv.data.string));
            free(a0);
        }
        else if (strcmp(cmd, "b64decode") == 0) {
            unsigned char* a0; size_t l0; size_t n, outlen; TaggedData argv[1]; TaggedData rv;
            memset(&rv, 0, sizeof(rv));
            if (!read_frame(&a0, &l0)) return 1;
            (void)l0;
            argv[0].type = kTypeString; argv[0].data.string = (char*)a0;
            rc = b64decode(argv, 1, &rv);
            if (rc != kESErrOK) { write_error(rc); continue; }
            /* True decoded length (the JS side would truncate at the first
               NUL — strlen here would hide binary-decode errors). */
            n = strlen((const char*)a0);
            while (n > 0 && (a0[n - 1] == '=' || a0[n - 1] == '\r' || a0[n - 1] == '\n')) n--;
            outlen = (n / 4) * 3 + (n % 4 == 2 ? 1u : (n % 4 == 3 ? 2u : 0u));
            fputc('S', stdout); write_u32le((unsigned long)outlen);
            write_bytes((const unsigned char*)rv.data.string, outlen);
            free(a0);
        }
        else if (strcmp(cmd, "hexEncode") == 0) {
            unsigned char* a0; size_t l0; TaggedData argv[1]; TaggedData rv;
            memset(&rv, 0, sizeof(rv));
            if (!read_frame(&a0, &l0)) return 1;
            (void)l0;
            argv[0].type = kTypeString; argv[0].data.string = (char*)a0;
            rc = hexEncode(argv, 1, &rv);
            if (rc != kESErrOK) { write_error(rc); continue; }
            fputc('S', stdout); write_u32le((unsigned long)strlen(rv.data.string));
            write_bytes((const unsigned char*)rv.data.string, strlen(rv.data.string));
            free(a0);
        }
        else if (strcmp(cmd, "hexDecode") == 0) {
            unsigned char* a0; size_t l0; size_t n; TaggedData argv[1]; TaggedData rv;
            memset(&rv, 0, sizeof(rv));
            if (!read_frame(&a0, &l0)) return 1;
            (void)l0;
            argv[0].type = kTypeString; argv[0].data.string = (char*)a0;
            rc = hexDecode(argv, 1, &rv);
            if (rc != kESErrOK) { write_error(rc); continue; }
            /* true decoded length = input length / 2 (NUL-safe reporting) */
            n = strlen((const char*)a0) / 2;
            fputc('S', stdout); write_u32le((unsigned long)n);
            write_bytes((const unsigned char*)rv.data.string, n);
            free(a0);
        }
        else if (strcmp(cmd, "crc32") == 0 || strcmp(cmd, "fnv1a32") == 0) {
            unsigned char* a0; size_t l0; TaggedData argv[1]; TaggedData rv;
            memset(&rv, 0, sizeof(rv));
            if (!read_frame(&a0, &l0)) return 1;
            (void)l0;
            argv[0].type = kTypeString; argv[0].data.string = (char*)a0;
            rc = (strcmp(cmd, "crc32") == 0) ? crc32(argv, 1, &rv) : fnv1a32(argv, 1, &rv);
            if (rc != kESErrOK) { write_error(rc); continue; }
            fputc('I', stdout); write_i32le(rv.data.intval);
            free(a0);
        }
        else if (strcmp(cmd, "packBytes") == 0 || strcmp(cmd, "unpackBytes") == 0) {
            unsigned char* a0; size_t l0; TaggedData argv[1]; TaggedData rv;
            memset(&rv, 0, sizeof(rv));
            if (!read_frame(&a0, &l0)) return 1;
            (void)l0;
            argv[0].type = kTypeString; argv[0].data.string = (char*)a0;
            rc = (strcmp(cmd, "packBytes") == 0) ? packBytes(argv, 1, &rv) : unpackBytes(argv, 1, &rv);
            if (rc != kESErrOK) { write_error(rc); continue; }
            fputc('S', stdout); write_u32le((unsigned long)strlen(rv.data.string));
            write_bytes((const unsigned char*)rv.data.string, strlen(rv.data.string));
            free(a0);
        }
        else if (strcmp(cmd, "translate") == 0) {
            unsigned char* a0; size_t l0; unsigned char* a1; size_t l1; TaggedData argv[2]; TaggedData rv;
            memset(&rv, 0, sizeof(rv));
            if (!read_frame(&a0, &l0)) return 1;
            if (!read_frame(&a1, &l1)) return 1;
            (void)l0; (void)l1;
            argv[0].type = kTypeString; argv[0].data.string = (char*)a0;
            argv[1].type = kTypeString; argv[1].data.string = (char*)a1;
            rc = translate(argv, 2, &rv);
            if (rc != kESErrOK) { write_error(rc); continue; }
            fputc('S', stdout); write_u32le((unsigned long)strlen(rv.data.string));
            write_bytes((const unsigned char*)rv.data.string, strlen(rv.data.string));
            free(a0); free(a1);
        }
        else if (strcmp(cmd, "b64ToHex") == 0) {
            unsigned char* a0; size_t l0; TaggedData argv[1]; TaggedData rv;
            memset(&rv, 0, sizeof(rv));
            if (!read_frame(&a0, &l0)) return 1;
            (void)l0;
            argv[0].type = kTypeString; argv[0].data.string = (char*)a0;
            rc = b64ToHex(argv, 1, &rv);
            if (rc != kESErrOK) { write_error(rc); continue; }
            fputc('S', stdout); write_u32le((unsigned long)strlen(rv.data.string));
            write_bytes((const unsigned char*)rv.data.string, strlen(rv.data.string));
            free(a0);
        }
        else if (strcmp(cmd, "charCodeAt") == 0) {
            unsigned char* a0; size_t l0; unsigned char* a1; size_t l1; TaggedData argv[2]; TaggedData rv;
            memset(&rv, 0, sizeof(rv));
            if (!read_frame(&a0, &l0)) return 1;
            if (!read_frame(&a1, &l1)) return 1;
            (void)l1;
            argv[0].type = kTypeString; argv[0].data.string = (char*)a0;
            argv[1].type = kTypeInteger; argv[1].data.intval = strtol((const char*)a1, NULL, 10);
            rc = charCodeAt(argv, 2, &rv);
            if (rc != kESErrOK) { write_error(rc); continue; }
            fputc('I', stdout); write_i32le(rv.data.intval);
            free(a0); free(a1);
        }
        else if (strcmp(cmd, "fromCharCode") == 0) {
            unsigned char* a0; size_t l0; TaggedData argv[1]; TaggedData rv;
            memset(&rv, 0, sizeof(rv));
            if (!read_frame(&a0, &l0)) return 1;
            (void)l0;
            argv[0].type = kTypeInteger; argv[0].data.intval = strtol((const char*)a0, NULL, 10);
            rc = fromCharCode(argv, 1, &rv);
            if (rc != kESErrOK) { write_error(rc); continue; }
            fputc('S', stdout); write_u32le((unsigned long)strlen(rv.data.string));
            write_bytes((const unsigned char*)rv.data.string, strlen(rv.data.string));
            free(a0);
        }
        else {
            fprintf(stderr, "unknown command: %s\n", cmd);
            return 2;
        }
        fputc('\n', stdout);
        fflush(stdout);
    }
    return 0;
}
