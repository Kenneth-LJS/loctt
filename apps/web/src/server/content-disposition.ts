/**
 * Builds a Content-Disposition header value for an attachment
 * download in the canonical RFC 5987 / 6266 form:
 *
 *   attachment; filename="<ascii-fallback>"; filename*=UTF-8''<percent>
 *
 * Why both parameters:
 *
 * - The plain `filename="..."` parameter is the legacy field; only
 *   visible ASCII without quotes, backslash, CR, or LF is safe.
 *   Browsers that don't understand `filename*` (rare today, but
 *   includes some embedded clients) fall back to this.
 *
 * - `filename*=UTF-8''<percent>` (RFC 5987) carries the full UTF-8
 *   name. Browsers that support it ignore the legacy `filename`.
 *
 * The fallback is sanitized by stripping characters that could:
 *   (a) break the quoted-string grammar (`"` and `\\`), and
 *   (b) inject new headers (CR and LF in particular).
 * Non-ASCII bytes are replaced with `_` so the legacy parameter
 * stays in the byte range the header grammar allows.
 *
 * Callers should already have rejected dangerous *path* components
 * (`..`, slashes) upstream via `assertSafeBasename`; this helper
 * is concerned only with HEADER-level safety, not path safety.
 */
export function contentDispositionAttachment(filename: string): string {
  const asciiFallback = sanitizeForLegacyFilename(filename);
  const encoded = encodeRfc5987(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function sanitizeForLegacyFilename(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    // Control characters (including CR, LF, NUL) — strip.
    if (code < 0x20 || code === 0x7f) continue;
    // Header-grammar specials inside a quoted string.
    if (code === 0x22 /* " */ || code === 0x5c /* \ */) continue;
    // Non-ASCII: keep the slot but replace with underscore so the
    // legacy field stays in the ASCII byte range. Clients that
    // care about the real name use filename*.
    if (code > 0x7e) {
      out += "_";
      continue;
    }
    out += input[i];
  }
  // An empty fallback would produce filename="" which some clients
  // reject; substitute a generic name.
  return out.length > 0 ? out : "download";
}

/**
 * Percent-encodes a string for RFC 5987 `filename*` according to the
 * `attr-char` grammar: ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+"
 * / "-" / "." / "^" / "_" / "`" / "|" / "~" — everything else is
 * percent-encoded from its UTF-8 byte sequence.
 */
function encodeRfc5987(input: string): string {
  const bytes = Buffer.from(input, "utf-8");
  let out = "";
  for (const byte of bytes) {
    if (isAttrChar(byte)) {
      out += String.fromCharCode(byte);
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

function isAttrChar(byte: number): boolean {
  // ALPHA / DIGIT
  if ((byte >= 0x30 && byte <= 0x39) // 0-9
    || (byte >= 0x41 && byte <= 0x5a) // A-Z
    || (byte >= 0x61 && byte <= 0x7a) // a-z
  ) {
    return true;
  }
  // Explicit allowed punctuation.
  switch (byte) {
    case 0x21: // !
    case 0x23: // #
    case 0x24: // $
    case 0x26: // &
    case 0x2b: // +
    case 0x2d: // -
    case 0x2e: // .
    case 0x5e: // ^
    case 0x5f: // _
    case 0x60: // `
    case 0x7c: // |
    case 0x7e: // ~
      return true;
    default:
      return false;
  }
}
