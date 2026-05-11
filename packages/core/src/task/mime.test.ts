import { describe, expect, it } from "vitest";

import { mimeForFilename } from "./mime.js";

describe("mimeForFilename", () => {
  it("returns image MIME for common image extensions", () => {
    expect(mimeForFilename("a.png")).toBe("image/png");
    expect(mimeForFilename("a.jpg")).toBe("image/jpeg");
    expect(mimeForFilename("a.jpeg")).toBe("image/jpeg");
    expect(mimeForFilename("a.gif")).toBe("image/gif");
    expect(mimeForFilename("a.webp")).toBe("image/webp");
    expect(mimeForFilename("a.svg")).toBe("image/svg+xml");
  });

  it("returns video MIME for common video extensions", () => {
    expect(mimeForFilename("clip.mp4")).toBe("video/mp4");
    expect(mimeForFilename("clip.webm")).toBe("video/webm");
    expect(mimeForFilename("clip.mov")).toBe("video/quicktime");
  });

  it("returns audio MIME for common audio extensions", () => {
    expect(mimeForFilename("song.mp3")).toBe("audio/mpeg");
    expect(mimeForFilename("song.wav")).toBe("audio/wav");
    expect(mimeForFilename("song.ogg")).toBe("audio/ogg");
  });

  it("returns application/pdf for .pdf", () => {
    expect(mimeForFilename("doc.pdf")).toBe("application/pdf");
  });

  it("returns image/heic for iPhone screenshots", () => {
    expect(mimeForFilename("IMG_0001.heic")).toBe("image/heic");
    expect(mimeForFilename("IMG_0001.HEIC")).toBe("image/heic");
    expect(mimeForFilename("IMG_0001.heif")).toBe("image/heif");
  });

  it("returns archive MIMEs for common archive formats", () => {
    expect(mimeForFilename("a.zip")).toBe("application/zip");
    expect(mimeForFilename("a.7z")).toBe("application/x-7z-compressed");
    expect(mimeForFilename("a.bz2")).toBe("application/x-bzip2");
    expect(mimeForFilename("a.rar")).toBe("application/vnd.rar");
  });

  it("is case-insensitive on the extension", () => {
    expect(mimeForFilename("a.PNG")).toBe("image/png");
    expect(mimeForFilename("a.JPG")).toBe("image/jpeg");
    expect(mimeForFilename("clip.Mp4")).toBe("video/mp4");
  });

  it("uses the last dot when the filename has multiple", () => {
    expect(mimeForFilename("archive.tar.gz")).toBe("application/gzip");
    expect(mimeForFilename("notes.draft.md")).toBe("text/markdown");
  });

  it("returns undefined for unknown extensions", () => {
    expect(mimeForFilename("blob.xyz")).toBeUndefined();
    expect(mimeForFilename("data.unknown")).toBeUndefined();
  });

  it("returns undefined when there is no extension", () => {
    expect(mimeForFilename("README")).toBeUndefined();
    expect(mimeForFilename("Makefile")).toBeUndefined();
  });

  it("returns undefined for a trailing-dot name (no extension)", () => {
    expect(mimeForFilename("oops.")).toBeUndefined();
  });

  it("returns undefined for a dotfile with no further extension", () => {
    // ".bashrc" has lastIndexOf(".") === 0; that's a dotfile, not an
    // extension. The lookup treats the entire name as the basename.
    expect(mimeForFilename(".bashrc")).toBeUndefined();
    expect(mimeForFilename(".env")).toBeUndefined();
  });

  it("recognises dotfile with an extension (e.g. .env.local would not match but .gitignore.md would)", () => {
    // Dotfile-with-extension: lastIndexOf(".") > 0, so we do consult
    // the table. ".env.local" → ".local" not in table → undefined.
    expect(mimeForFilename(".env.local")).toBeUndefined();
    // ".gitignore.md" → ".md" → text/markdown. Edge case but the
    // behaviour is deterministic.
    expect(mimeForFilename(".gitignore.md")).toBe("text/markdown");
  });

  it("returns undefined for empty input", () => {
    expect(mimeForFilename("")).toBeUndefined();
  });
});
