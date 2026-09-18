/**
 * The glyph and family for an attachment tile.
 *
 * REL-38's first bullet: a file with no extension gets a **generic**
 * icon. The server already decides the MIME type from the extension
 * (`mimeForFilename` in core) and omits `mime` entirely when the
 * extension is unknown or absent — so "no extension" arrives here as
 * `undefined`, and this function does not re-guess it. Re-deriving a
 * type from the name would be exactly the MIME guess the case forbids.
 *
 * The family is rendered as a data attribute so a test can assert
 * which branch was taken rather than which emoji rendered.
 */

export type AttachmentFamily =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "archive"
  | "generic";

const GLYPH: Readonly<Record<AttachmentFamily, string>> = {
  image: "🖼",
  video: "🎞",
  audio: "🎵",
  pdf: "📕",
  text: "📄",
  archive: "🗜",
  // The generic one. Nothing about the file is known beyond its name.
  generic: "📎",
};

export function familyForMime(mime: string | undefined): AttachmentFamily {
  if (mime === undefined) return "generic";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  if (
    mime === "application/zip"
    || mime === "application/gzip"
    || mime === "application/x-tar"
    || mime === "application/x-bzip2"
    || mime === "application/x-7z-compressed"
    || mime === "application/vnd.rar"
  ) {
    return "archive";
  }
  return "generic";
}

export function glyphFor(family: AttachmentFamily): string {
  return GLYPH[family];
}

/**
 * What the tile says the file is.
 *
 * REL-38's third bullet is about the *download* — the server serves
 * every attachment as `application/octet-stream` regardless — but the
 * tile has to say something, and saying nothing for an unknown type
 * while saying "image/png" for a known one is the inconsistency that
 * makes a user think the unknown one is broken. `AttachmentResponse`'s
 * own contract says consumers treat an absent `mime` as
 * `application/octet-stream`, so that is what is shown.
 */
export function displayMime(mime: string | undefined): string {
  return mime ?? "application/octet-stream";
}
