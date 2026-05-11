import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { getUserDir } from "../paths/index.js";
import { UserError } from "./errors.js";

/** Maximum avatar source size in bytes (10 MB). */
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
/** Maximum dimension (width or height) of the stored avatar in px. */
const AVATAR_MAX_DIMENSION = 500;
/** JPEG quality of the stored avatar (1-100). */
const AVATAR_JPEG_QUALITY = 85;
/** Stored avatar filename. Always JPG regardless of input format. */
const AVATAR_FILENAME = "avatar.jpg";

/**
 * Heuristic SVG sniffer for the avatar pipeline's pre-decode reject.
 * Looks past optional UTF-8/UTF-16 BOM and leading whitespace; if
 * the next non-trivial token looks like XML (declaration, doctype,
 * comment, or processing instruction) keeps skipping until a real
 * tag opener; then matches `<svg` case-insensitive.
 *
 * Doesn't replace the post-decode `metadata.format` check inside
 * `copyAvatar` — both run, with this sniff serving as the cheap
 * fast-path DoS rejection (no full sharp decode for an SVG payload)
 * and `metadata.format` as the authoritative gate against any
 * format the sniff failed to flag.
 */
function looksLikeSvg(bytes: Buffer): boolean {
  // 1. Strip BOMs (UTF-8 EF BB BF; UTF-16 LE FF FE; UTF-16 BE FE FF).
  //    For the UTF-16 cases, also fold every other byte (the high
  //    byte for ASCII chars in UTF-16 is 0x00) so the substring
  //    comparison below works against ASCII-only XML prologues.
  let view = bytes;
  if (view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    view = view.slice(3);
  } else if (view.length >= 2 && view[0] === 0xff && view[1] === 0xfe) {
    // UTF-16 LE: keep low byte of each pair.
    const out: number[] = [];
    for (let i = 2; i + 1 < view.length; i += 2) {
      if (view[i + 1] === 0) out.push(view[i] as number);
      else return false; // non-ASCII; SVG entry point would be ASCII
    }
    view = Buffer.from(out);
  } else if (view.length >= 2 && view[0] === 0xfe && view[1] === 0xff) {
    // UTF-16 BE: keep high byte of each pair (which is the ASCII char).
    const out: number[] = [];
    for (let i = 2; i + 1 < view.length; i += 2) {
      if (view[i] === 0) out.push(view[i + 1] as number);
      else return false;
    }
    view = Buffer.from(out);
  }

  // 2. Skip whitespace + XML preamble tokens (PI, comment, doctype)
  //    until we hit a real start-tag opener `<x` (where x is a
  //    letter). Bound the search at 4 KB to avoid a payload that
  //    pads with infinite comments before its `<svg`.
  const MAX_PREAMBLE = 4096;
  const head = view.slice(0, MAX_PREAMBLE).toString("utf-8").toLowerCase();
  let i = 0;
  while (i < head.length) {
    const c = head.charCodeAt(i);
    // Whitespace.
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) { i += 1; continue; }
    // XML processing instruction `<?...?>` — skip to closing `?>`.
    if (head.startsWith("<?", i)) {
      const end = head.indexOf("?>", i + 2);
      if (end === -1) return false;
      i = end + 2;
      continue;
    }
    // XML/HTML comment `<!--...-->` — skip to closing `-->`.
    if (head.startsWith("<!--", i)) {
      const end = head.indexOf("-->", i + 4);
      if (end === -1) return false;
      i = end + 3;
      continue;
    }
    // DOCTYPE / CDATA / etc. `<!...>` — skip to closing `>`.
    if (head.startsWith("<!", i)) {
      const end = head.indexOf(">", i + 2);
      if (end === -1) return false;
      i = end + 1;
      continue;
    }
    // First real start-tag: is it <svg?
    return head.startsWith("<svg", i);
  }
  return false;
}

/**
 * Imports an avatar source image into the user's folder. The source
 * is decoded by sharp (so any format sharp supports — png, jpg,
 * webp, gif, tiff, avif, etc. — is accepted), resized so the longer
 * side is at most {@link AVATAR_MAX_DIMENSION}px while preserving
 * aspect ratio, re-encoded as JPG, and atomically written to
 * `<userDir>/avatar.jpg`.
 *
 * Returns the basename written. Rejects:
 * - sources larger than {@link MAX_AVATAR_BYTES} (DoS guard before
 *   we hand untrusted bytes to sharp's decoder),
 * - inputs sharp can't decode (invalid image, corrupted, or an
 *   unsupported format),
 * - sources that don't exist at the given path.
 *
 * Always-JPG output gives the web layer a uniform served
 * content-type (no SVG XSS hazard, no per-extension MIME guessing)
 * and a smaller on-disk file via the resize+re-encode.
 */
export async function copyAvatar(
  locttDir: string,
  userId: string,
  sourcePath: string,
): Promise<string> {
  const actualSource = sourcePath.startsWith("file://")
    ? fileURLToPath(sourcePath)
    : sourcePath;

  // Stat first so we can reject huge files BEFORE reading them
  // into memory and handing them to sharp's decoder. Also surfaces
  // a clearer error than sharp's "input file is missing".
  let info;
  try {
    info = await stat(actualSource);
  } catch {
    throw new UserError(`avatar source not found: ${actualSource}`);
  }
  if (info.size > MAX_AVATAR_BYTES) {
    throw new UserError(
      `avatar source is ${info.size} bytes; max is ${MAX_AVATAR_BYTES}`,
    );
  }

  // Read into a buffer rather than streaming so a malformed image
  // surfaces a single clean error from the sharp pipeline rather
  // than a half-written destination file.
  const sourceBytes = await readFile(actualSource);

  // Explicitly reject SVG inputs even when sharp could decode them.
  // SVG is the XSS vector that motivated the always-JPG output —
  // a malformed SVG with embedded <script> can be downgraded into
  // an image at decode time, but our policy is "no SVG anywhere
  // in the avatar pipeline." Detect by sniffing the leading bytes
  // (after any UTF-8 BOM and whitespace) for the SVG signatures.
  if (looksLikeSvg(sourceBytes)) {
    throw new UserError(
      "SVG avatars are not supported; use a raster image (PNG, JPG, WEBP, GIF, AVIF, …)",
    );
  }

  // Authoritative format check via sharp's own detector. This
  // backstops the looksLikeSvg() pre-decode heuristic — if sharp
  // sees an SVG we missed at the byte sniff (e.g. unusual encoding
  // declaration, XML namespace tricks), we still reject before
  // re-encoding it.
  try {
    const meta = await sharp(sourceBytes).metadata();
    if (meta.format === "svg") {
      throw new UserError(
        "SVG avatars are not supported; use a raster image (PNG, JPG, WEBP, GIF, AVIF, …)",
      );
    }
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError(
      `avatar could not be decoded as an image: ${(err as Error).message}`,
    );
  }

  let processed: Buffer;
  try {
    processed = await sharp(sourceBytes)
      .rotate() // honor EXIF orientation
      .resize({
        width: AVATAR_MAX_DIMENSION,
        height: AVATAR_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: AVATAR_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    throw new UserError(
      `avatar could not be decoded as an image: ${(err as Error).message}`,
    );
  }

  const userDir = getUserDir(locttDir, userId);
  await mkdir(userDir, { recursive: true });
  const targetPath = `${userDir}/${AVATAR_FILENAME}`;
  // Atomic write: temp file + rename, so a crash mid-write never
  // leaves a corrupt avatar.jpg readable by the web layer.
  const tmpPath = `${targetPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, processed);
  try {
    await rename(tmpPath, targetPath);
  } catch (err) {
    // Cross-device rename or permission flap mid-write: clean up
    // the temp file so we don't accumulate leftovers across
    // retried uploads.
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }

  return AVATAR_FILENAME;
}
