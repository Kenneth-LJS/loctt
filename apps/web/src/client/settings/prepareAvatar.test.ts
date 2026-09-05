// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  AvatarRejected,
  checkAcceptedType,
  chooseEncoding,
  clampCrop,
  isAnimatedGif,
} from "./prepareAvatar.ts";

/**
 * The cropper's pure preparation logic. The decode and canvas draw
 * need a real browser (covered by the UI suite: PRU-13, PRU-27,
 * PRU-28, PRU-29, PRU-39); these pin the decisions that live in the
 * byte-level and geometry helpers.
 */

describe("checkAcceptedType (PRU-38, PRU-30)", () => {
  it("rejects an SVG by mime", () => {
    expect(() => checkAcceptedType({ type: "image/svg+xml", name: "a.svg" }))
      .toThrow(/SVG/);
  });

  it("rejects an SVG whose mime lies but name ends .svg", () => {
    expect(() => checkAcceptedType({ type: "image/png", name: "logo.svg" }))
      .toThrow(/SVG/);
  });

  it("rejects a non-image and lists accepted formats", () => {
    try {
      checkAcceptedType({ type: "application/pdf", name: "resume.pdf" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AvatarRejected);
      expect((err as AvatarRejected).message).toContain("resume.pdf");
      expect((err as AvatarRejected).message).toContain("JPEG");
    }
  });

  it("accepts a JPEG", () => {
    expect(() => checkAcceptedType({ type: "image/jpeg", name: "a.jpg" }))
      .not.toThrow();
  });
});

/** Builds a minimal GIF with `frameCount` image descriptors. */
function buildGif(frameCount: number): Uint8Array {
  const bytes: number[] = [];
  // Header "GIF89a".
  bytes.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  // Logical Screen Descriptor: 1x1, no global colour table (packed=0).
  bytes.push(0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00);
  for (let f = 0; f < frameCount; f++) {
    // Image Descriptor: separator, x, y, w, h, packed (no LCT).
    bytes.push(0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
    // LZW min code size, then one data sub-block, then terminator.
    bytes.push(0x02, 0x01, 0x00, 0x00);
  }
  bytes.push(0x3b); // trailer
  return new Uint8Array(bytes);
}

describe("isAnimatedGif (PRU-29)", () => {
  it("returns false for a single-frame GIF", () => {
    expect(isAnimatedGif(buildGif(1))).toBe(false);
  });

  it("returns true for a two-frame GIF", () => {
    expect(isAnimatedGif(buildGif(2))).toBe(true);
  });

  it("returns true for a many-frame GIF", () => {
    expect(isAnimatedGif(buildGif(8))).toBe(true);
  });

  it("returns false for non-GIF bytes (a PNG header)", () => {
    expect(isAnimatedGif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0])))
      .toBe(false);
  });

  it("does not over-count a 0x2C byte inside a data sub-block", () => {
    // A single-frame GIF whose sub-block payload contains 0x2C. A naive
    // byte count would see two separators and call it animated.
    const bytes: number[] = [
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
      0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor
      0x02,                   // LZW min code size
      0x03, 0x2c, 0x2c, 0x2c, // a 3-byte sub-block that is all 0x2C
      0x00,                   // block terminator
      0x3b,                   // trailer
    ];
    expect(isAnimatedGif(new Uint8Array(bytes))).toBe(false);
  });
});

describe("clampCrop", () => {
  it("shrinks a crop wider than the image to fit the shorter edge", () => {
    // 400x300 image, asked for a 500px square → clamps to 300.
    expect(clampCrop({ x: 0, y: 0, size: 500 }, 400, 300))
      .toEqual({ x: 0, y: 0, size: 300 });
  });

  it("pulls an off-image origin back inside bounds", () => {
    expect(clampCrop({ x: 350, y: 0, size: 100 }, 400, 300))
      .toEqual({ x: 300, y: 0, size: 100 });
  });

  it("keeps an in-bounds crop unchanged (rounded)", () => {
    expect(clampCrop({ x: 10, y: 20, size: 100 }, 400, 300))
      .toEqual({ x: 10, y: 20, size: 100 });
  });
});

describe("chooseEncoding", () => {
  it("prefers WebP when the browser can encode it", () => {
    expect(chooseEncoding(true)).toEqual({ mime: "image/webp", ext: "webp" });
  });
  it("falls back to JPEG otherwise", () => {
    expect(chooseEncoding(false)).toEqual({ mime: "image/jpeg", ext: "jpg" });
  });
});
