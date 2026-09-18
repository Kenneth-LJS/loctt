/**
 * Filename-extension → MIME type derivation for attachments.
 *
 * This is intentionally a small built-in table — no file sniffing, no
 * external dependencies. The result is returned alongside attachment
 * metadata (see `AttachmentInfo`, `AttachmentResponse`) so the UI can
 * pick the right inline renderer (image, video, audio, pdf, file chip)
 * without re-implementing the lookup.
 *
 * Coverage policy: the common families consumed inline (image, video,
 * audio, pdf) plus a small set of text/document formats. Anything not
 * in the table returns `undefined` — consumers treat that as
 * `application/octet-stream` per the response contract.
 *
 * No upper-cased entries: the lookup lowercases the extension before
 * matching, and we want the table values to be the canonical IANA
 * registered strings.
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  // image/svg+xml and text/html below are advisory metadata only.
  // Inline rendering of these formats is a script-execution path —
  // the web server's attachment download endpoint deliberately serves
  // every attachment as application/octet-stream + nosniff +
  // Content-Disposition: attachment to neutralise that. UI consumers
  // dispatching by mime must use a sandboxed render path (e.g.
  // server-side sanitisation, or a srcdoc-iframe wrapper) for these
  // two specifically.
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".heic": "image/heic",
  ".heif": "image/heif",

  // Video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",

  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",

  // Documents
  ".pdf": "application/pdf",

  // Text / source
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".log": "text/plain",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  // .ts has no IANA-registered MIME (TypeScript is not standardised);
  // `text/x-typescript` is the customary informal value. Keep the
  // entry so the UI can still pick a syntax highlighter.
  ".ts": "text/x-typescript",

  // Archives
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".bz2": "application/x-bzip2",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",

  // Office
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * Returns the IANA MIME type for a filename, derived from its extension,
 * or `undefined` when the extension is unknown. Callers should treat
 * `undefined` as `application/octet-stream`.
 *
 * Files with no dot in the basename, or a trailing dot, return
 * `undefined`. The extension match is case-insensitive (".PNG" works).
 */
export function mimeForFilename(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  // No dot, or trailing dot ("file."), or leading-dot dotfile with no
  // further extension (".bashrc") — no usable extension.
  if (dot <= 0 || dot === name.length - 1) return undefined;
  const ext = name.slice(dot).toLowerCase();
  return MIME_BY_EXTENSION[ext];
}
