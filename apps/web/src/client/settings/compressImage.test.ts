import { describe, expect, it } from "vitest";

import {
  AvatarRejected,
  checkAcceptedType,
  chooseEncoding,
  fitWithin,
  MAX_AVATAR_EDGE,
} from "./compressImage.ts";

/**
 * CW-20's compressor. The decode itself needs a browser, so the UI
 * suite covers the round trip (PRU-13, PRU-27); these pin the
 * decisions, which is where the clamping rules actually live.
 */

describe("fitWithin", () => {
  it("clamps a 4000x3000 photo to 256x192, preserving aspect (PRU-27)", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 256, height: 192 });
  });

  it("clamps a 1200x900 to 256x192 (PRU-13)", () => {
    expect(fitWithin(1200, 900)).toEqual({ width: 256, height: 192 });
  });

  it("does not upscale an image already inside the cap (PRU-28)", () => {
    expect(fitWithin(64, 64)).toEqual({ width: 64, height: 64 });
  });

  it("clamps the long edge of a tall image", () => {
    expect(fitWithin(500, 1000)).toEqual({ width: 128, height: 256 });
  });

  it("never returns a zero edge for an extreme aspect ratio", () => {
    const out = fitWithin(4000, 3);
    expect(out.width).toBe(MAX_AVATAR_EDGE);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });
});

describe("checkAcceptedType", () => {
  it("rejects a PDF client-side, naming it and the accepted formats (PRU-38)", () => {
    try {
      checkAcceptedType({ type: "application/pdf", name: "resume.pdf" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AvatarRejected);
      expect((err as Error).message).toContain("resume.pdf");
      expect((err as Error).message).toContain("JPEG");
    }
  });

  it("rejects an SVG by name even when the MIME type lies (PRU-30)", () => {
    expect(() => {
      checkAcceptedType({ type: "image/png", name: "logo.svg" });
    }).toThrow(/SVG/);
  });

  it("rejects an SVG by MIME type (PRU-30)", () => {
    expect(() => {
      checkAcceptedType({ type: "image/svg+xml", name: "logo" });
    }).toThrow(/SVG/);
  });

  it("accepts a GIF, which is flattened to one frame rather than rejected (PRU-29)", () => {
    expect(() => {
      checkAcceptedType({ type: "image/gif", name: "wave.gif" });
    }).not.toThrow();
  });

  it("accepts jpeg, png and webp", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(() => { checkAcceptedType({ type, name: `a.${type}` }); }).not.toThrow();
    }
  });
});

describe("chooseEncoding", () => {
  it("prefers webp when the browser can encode it", () => {
    expect(chooseEncoding(true)).toEqual({ mime: "image/webp", ext: "webp" });
  });

  it("falls back to jpeg otherwise — never leaves the source format", () => {
    expect(chooseEncoding(false)).toEqual({ mime: "image/jpeg", ext: "jpg" });
  });
});
