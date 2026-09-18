/**
 * Browser-side avatar preparation for the cropper (K18/K20; PRU-13,
 * PRU-27, PRU-28, PRU-29, PRU-38, PRU-39).
 *
 * K18 split the pipeline: **the browser crops, the server compresses.**
 * The user chooses the framing here; `copyAvatar` on the server owns
 * what lands on disk — it validates, honours EXIF, resizes to a 500px
 * longest edge and re-encodes. So this module does NOT downscale to a
 * cap the way the old `compressImage` did — it produces a *crop* at the
 * source's own resolution and lets the server do the resize once.
 *
 * What stays client-side is the part the server cannot do before a
 * round-trip: rejecting a non-image (PRU-38) or SVG (PRU-30) before any
 * POST, failing a corrupt file at browser decode (PRU-39), and flagging
 * an animated GIF so the user is told it stores as a single frame
 * (PRU-29). The crop itself (PRU-13's "preview renders from the crop").
 *
 * `checkAcceptedType`, `isAnimatedGif`, and `cropRectToBlob` carry the
 * decisions and are unit-testable without a browser; `decodeImageFile`
 * and `prepareCrop` are the thin DOM shells.
 */

/** Formats we will decode. SVG is deliberately absent — see below. */
const ACCEPTED_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export class AvatarRejected extends Error {
  constructor(message: string, readonly kind: "type" | "decode") {
    super(message);
    this.name = "AvatarRejected";
  }
}

/**
 * PRU-30: SVG is rejected rather than passed through. It is not a
 * raster format, and an SVG served back to a browser from the avatar
 * bucket is script-capable markup — so it never reaches the bucket.
 *
 * PRU-38: anything that is not an image at all is rejected here,
 * client-side, before any POST is made.
 */
export function checkAcceptedType(file: { type: string; name: string }): void {
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) {
    throw new AvatarRejected(
      `${file.name} is an SVG. Avatars must be a raster image — `
      + `JPEG, PNG, WebP, or GIF.`,
      "type",
    );
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new AvatarRejected(
      `${file.name} is not an image LocTT can read. `
      + `Accepted formats: JPEG, PNG, WebP, GIF.`,
      "type",
    );
  }
}

/**
 * PRU-29: detects an animated GIF by counting image frames in the raw
 * bytes. A GIF's each frame begins with an Image Descriptor block
 * introduced by the `0x2C` separator; the header is `GIF87a`/`GIF89a`.
 * Two or more image descriptors means it animates.
 *
 * We parse the block structure rather than merely counting `0x2C`
 * bytes, because a `0x2C` can occur inside a colour table or data
 * sub-block and would over-count. Bounded and allocation-free.
 */
export function isAnimatedGif(bytes: Uint8Array): boolean {
  // Header: "GIF87a" or "GIF89a".
  if (bytes.length < 13) return false;
  const isGif =
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
  if (!isGif) return false;

  let p = 6; // past the 6-byte header
  // Logical Screen Descriptor is 7 bytes; the packed field's top bit
  // says whether a Global Colour Table follows.
  const packed = bytes[10] ?? 0;
  p = 13;
  if ((packed & 0x80) !== 0) {
    const gctSize = 2 << (packed & 0x07); // entries
    p += gctSize * 3;
  }

  let frames = 0;
  while (p < bytes.length) {
    const block = bytes[p];
    if (block === 0x3b) break; // trailer
    if (block === 0x2c) {
      // Image Descriptor — one frame.
      frames += 1;
      if (frames >= 2) return true;
      // Image Descriptor is 10 bytes; then an optional Local Colour
      // Table, then the LZW min-code byte, then data sub-blocks.
      const lp = bytes[p + 9] ?? 0;
      p += 10;
      if ((lp & 0x80) !== 0) {
        const lctSize = 2 << (lp & 0x07);
        p += lctSize * 3;
      }
      p += 1; // LZW minimum code size
      p = skipSubBlocks(bytes, p);
      continue;
    }
    if (block === 0x21) {
      // Extension: 0x21, label, then sub-blocks.
      p += 2;
      p = skipSubBlocks(bytes, p);
      continue;
    }
    // Unknown byte — malformed; bail rather than loop forever.
    break;
  }
  return false;
}

/** Advances past a chain of GIF data sub-blocks, returning the index
 *  just after the terminating zero-length block. */
function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let p = start;
  while (p < bytes.length) {
    const len = bytes[p] ?? 0;
    p += 1;
    if (len === 0) break;
    p += len;
  }
  return p;
}

export interface DecodedImage {
  readonly img: HTMLImageElement;
  readonly width: number;
  readonly height: number;
  /** True for a multi-frame GIF — PRU-29's "stored as a single frame". */
  readonly animated: boolean;
  /** Revokes the object URL backing `img.src`. Call when done. */
  revoke(): void;
}

/**
 * Validates and decodes a file for the cropper. Throws `AvatarRejected`
 * for a non-image/SVG (PRU-38/30) or a file that fails to decode
 * (PRU-39). The returned `img` is fully loaded, so the caller can draw
 * it to a canvas synchronously.
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  checkAcceptedType(file);

  let animated = false;
  if (file.type === "image/gif") {
    // A bounded prefix is enough: `isAnimatedGif` early-returns at the
    // second image descriptor, so it never needs the whole (possibly
    // multi-MB) file materialised. 256 KB comfortably spans the header,
    // palette and first frame of any normal animation.
    const GIF_SNIFF_BYTES = 256 * 1024;
    const head = file.size > GIF_SNIFF_BYTES ? file.slice(0, GIF_SNIFF_BYTES) : file;
    animated = isAnimatedGif(new Uint8Array(await head.arrayBuffer()));
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => { resolve(el); };
      el.onerror = () => {
        // PRU-39: the underlying decode error is opaque by design in
        // the DOM, so the message says what was attempted and that
        // nothing was saved rather than inventing a cause.
        reject(new AvatarRejected(
          `${file.name} could not be decoded — the file may be corrupt or `
          + `incomplete. Your avatar was not changed; try a different file.`,
          "decode",
        ));
      };
      el.src = url;
    });
    return {
      img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      animated,
      revoke: () => { URL.revokeObjectURL(url); },
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export interface CropRect {
  /** Left edge in source pixels. */
  readonly x: number;
  /** Top edge in source pixels. */
  readonly y: number;
  /** Width/height in source pixels (square). */
  readonly size: number;
}

/**
 * Picks the output encoding. WebP when the browser can produce it (it
 * is materially smaller at the same quality), JPEG otherwise. The
 * server re-encodes as JPEG regardless (K18), so this only affects the
 * bytes on the wire, not what is stored.
 */
export function chooseEncoding(canEncodeWebp: boolean): {
  mime: string;
  ext: string;
} {
  return canEncodeWebp
    ? { mime: "image/webp", ext: "webp" }
    : { mime: "image/jpeg", ext: "jpg" };
}

/**
 * Whether this browser can encode WebP. Probed once against a 1×1
 * canvas and cached — the capability is constant per browser, so
 * encoding the real (possibly 1200px) crop just to read the MIME
 * prefix would be wasted work on every confirm.
 */
let webpSupport: boolean | undefined;
function browserSupportsWebp(): boolean {
  if (webpSupport === undefined) {
    try {
      const probe = document.createElement("canvas");
      probe.width = 1;
      probe.height = 1;
      webpSupport = probe.toDataURL("image/webp").startsWith("data:image/webp");
    } catch {
      webpSupport = false;
    }
  }
  return webpSupport;
}

/**
 * Clamps a proposed crop rect to lie fully within the source. A square
 * crop whose size exceeds the shorter edge is shrunk to fit, and its
 * origin is pulled back inside the bounds. Guarantees a rect the canvas
 * `drawImage` can read without sampling outside the image (which would
 * letterbox transparent/black pixels into the avatar).
 */
export function clampCrop(
  rect: CropRect,
  imgWidth: number,
  imgHeight: number,
): CropRect {
  const maxSize = Math.min(imgWidth, imgHeight);
  const size = Math.max(1, Math.min(Math.round(rect.size), maxSize));
  const x = Math.max(0, Math.min(Math.round(rect.x), imgWidth - size));
  const y = Math.max(0, Math.min(Math.round(rect.y), imgHeight - size));
  return { x, y, size };
}

export interface PreparedCrop {
  readonly file: File;
  /** The square edge of the cropped image, in source pixels. */
  readonly size: number;
}

/**
 * Draws the crop rect out of the decoded image into a square canvas at
 * the crop's own source resolution and encodes it. The server resizes
 * to 500px, so we deliberately do NOT downscale here — a 1200px crop
 * stays 1200px on the wire. Rejects if the browser cannot produce a
 * blob (PRU-39's encode branch).
 */
export async function cropRectToBlob(
  img: CanvasImageSource,
  rect: CropRect,
  baseName: string,
): Promise<PreparedCrop> {
  const size = Math.max(1, Math.round(rect.size));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new AvatarRejected(
      `This browser could not prepare the image. Your avatar was not changed.`,
      "decode",
    );
  }
  ctx.drawImage(
    img,
    Math.round(rect.x), Math.round(rect.y), size, size,
    0, 0, size, size,
  );

  const encoding = chooseEncoding(browserSupportsWebp());
  const blob = await new Promise<Blob | null>(resolve => {
    canvas.toBlob(b => { resolve(b); }, encoding.mime, 0.9);
  });
  if (!blob) {
    throw new AvatarRejected(
      `This browser could not encode the image. Your avatar was not changed.`,
      "decode",
    );
  }
  const base = baseName.replace(/\.[^.]+$/, "");
  return {
    file: new File([blob], `${base}.${encoding.ext}`, { type: encoding.mime }),
    size,
  };
}
