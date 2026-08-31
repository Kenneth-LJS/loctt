/**
 * Browser-side avatar compression (CW-20; PRU-13, PRU-27, PRU-28,
 * PRU-29, PRU-30, PRU-38, PRU-39).
 *
 * The avatar bucket is documented as 256x256 static, so the resize and
 * re-encode happen **before** the POST rather than on the server. That
 * is what makes PRU-13's "the uploaded payload is at most 256x256 and
 * materially smaller" checkable from the request body.
 *
 * Everything here is pure enough to unit-test except the actual decode,
 * which needs a browser. `fitWithin` and `chooseEncoding` carry the
 * decisions; `compressImage` is the thin shell that drives them.
 */

export const MAX_AVATAR_EDGE = 256;

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
 * Clamps to the cap while preserving aspect ratio.
 *
 * PRU-28: an image already inside the cap is returned unchanged rather
 * than upscaled — blowing a 64x64 up to 256x256 would store a blurrier,
 * larger file than the original.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_AVATAR_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width, height };
  if (width <= max && height <= max) return { width, height };
  const scale = Math.min(max / width, max / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
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
 * Picks the output encoding. WebP when the browser can produce it (it
 * is materially smaller at the same quality), JPEG otherwise.
 *
 * A GIF becomes a single still frame (PRU-29) because the canvas draw
 * takes only the first frame — the caller states that in the UI rather
 * than letting it happen silently.
 */
export function chooseEncoding(canEncodeWebp: boolean): {
  mime: string;
  ext: string;
} {
  return canEncodeWebp
    ? { mime: "image/webp", ext: "webp" }
    : { mime: "image/jpeg", ext: "jpg" };
}

function canvasSupportsWebp(canvas: HTMLCanvasElement): boolean {
  try {
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

export interface CompressedAvatar {
  readonly file: File;
  readonly width: number;
  readonly height: number;
  /** True when the original bytes were kept (PRU-28's second bullet). */
  readonly keptOriginal: boolean;
}

/**
 * Decodes, clamps, and re-encodes. Throws `AvatarRejected` for a file
 * we will not accept (PRU-38, PRU-30) or one that fails to decode
 * (PRU-39) — in both cases nothing has been uploaded and the caller
 * says so.
 */
export async function compressImage(file: File): Promise<CompressedAvatar> {
  checkAcceptedType(file);

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

    const target = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new AvatarRejected(
        `This browser could not prepare the image. Your avatar was not changed.`,
        "decode",
      );
    }
    ctx.drawImage(img, 0, 0, target.width, target.height);

    const encoding = chooseEncoding(canvasSupportsWebp(canvas));
    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(b => { resolve(b); }, encoding.mime, 0.85);
    });
    if (!blob) {
      throw new AvatarRejected(
        `This browser could not encode the image. Your avatar was not changed.`,
        "decode",
      );
    }

    // PRU-28: never store something larger than what we were given.
    if (blob.size >= file.size && target.width === img.naturalWidth
      && target.height === img.naturalHeight) {
      return {
        file,
        width: img.naturalWidth,
        height: img.naturalHeight,
        keptOriginal: true,
      };
    }

    const base = file.name.replace(/\.[^.]+$/, "");
    return {
      file: new File([blob], `${base}.${encoding.ext}`, { type: encoding.mime }),
      width: target.width,
      height: target.height,
      keptOriginal: false,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
