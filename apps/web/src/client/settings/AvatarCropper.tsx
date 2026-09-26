import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import {
  clampCrop,
  type CropRect,
  cropRectToBlob,
  type DecodedImage,
  type PreparedCrop,
} from "./prepareAvatar.ts";

/**
 * The cropper (K18 point 1 / K14 point 3): the user chooses the framing
 * before anything is stored. A square crop rectangle over the decoded
 * image, draggable and resizable, with a live preview that renders from
 * the crop — PRU-13's "the preview renders from the chosen crop, not
 * the raw original file."
 *
 * The crop is produced at the source's own resolution; the server
 * resizes it to 500px longest edge and re-encodes (K18 point 2), so no
 * downscaling happens here.
 *
 * PRU-29: an animated GIF decodes to its first frame in the `<img>`, so
 * the crop and preview show exactly the frame that will be stored, and
 * the caller shows the "saved as a single frame" notice.
 */

/** A larger initial default reads as "adjust me" rather than "done". */
const DEFAULT_FRACTION = 0.9;

export interface AvatarCropperProps {
  readonly decoded: DecodedImage;
  readonly fileName: string;
  readonly testIdSuffix: string;
  /** True for a multi-frame GIF — PRU-29's still-frame notice. */
  readonly animated: boolean;
  readonly onConfirm: (result: PreparedCrop) => void;
  readonly onCancel: () => void;
}

export function AvatarCropper({
  decoded,
  fileName,
  testIdSuffix,
  animated,
  onConfirm,
  onCancel,
}: AvatarCropperProps) {
  const { img, width, height } = decoded;

  // The initial crop is the largest centred square scaled down a touch,
  // clamped into bounds — a sane default the user can accept or adjust.
  const [crop, setCrop] = useState<CropRect>(() => {
    const maxSize = Math.min(width, height);
    const size = Math.max(1, Math.round(maxSize * DEFAULT_FRACTION));
    return clampCrop(
      { x: (width - size) / 2, y: (height - size) / 2, size },
      width,
      height,
    );
  });

  const [busy, setBusy] = useState(false);

  // The image is drawn into a fixed-width box; this scale maps display
  // pixels to source pixels so a drag of N screen px moves the crop by
  // N/scale source px.
  const BOX = 320;
  const scale = useMemo(() => BOX / Math.max(width, height), [width, height]);
  const dispW = width * scale;
  const dispH = height * scale;

  // Live preview: redraw the crop into a small canvas whenever it moves.
  const previewCanvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = previewCanvas.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      img,
      Math.round(crop.x), Math.round(crop.y), Math.round(crop.size), Math.round(crop.size),
      0, 0, canvas.width, canvas.height,
    );
  }, [img, crop]);

  const drag = useRef<{ startX: number; startY: number; cropX: number; cropY: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, cropX: crop.x, cropY: crop.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dxSrc = (e.clientX - d.startX) / scale;
    const dySrc = (e.clientY - d.startY) / scale;
    setCrop(clampCrop({ x: d.cropX + dxSrc, y: d.cropY + dySrc, size: crop.size }, width, height));
  };
  const onPointerUp = () => { drag.current = null; };

  const setSize = (next: number) => {
    setCrop(prev => clampCrop({ x: prev.x, y: prev.y, size: next }, width, height));
  };

  const confirm = () => {
    setBusy(true);
    void (async () => {
      try {
        const result = await cropRectToBlob(img, crop, fileName);
        onConfirm(result);
      } finally {
        setBusy(false);
      }
    })();
  };

  const maxSize = Math.min(width, height);

  return (
    <Modal title="Crop avatar" onClose={onCancel}>
      <div className="grid gap-3" data-testid={`avatar-cropper-${testIdSuffix}`}>
        {animated && (
          <p
            role="status"
            data-testid={`avatar-animated-note-${testIdSuffix}`}
            className="text-[0.8571rem] text-text-secondary"
          >
            Animated images are saved as a single frame.
          </p>
        )}

        <div className="flex gap-4">
          <div
            className="relative select-none rounded-md border border-border-default bg-bg-muted"
            style={{ width: dispW, height: dispH }}
          >
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="block h-full w-full rounded-md object-contain"
            />
            {/* The crop square, positioned in display px. Dragging it
                moves the source-space crop rect. */}
            <div
              data-testid={`avatar-crop-rect-${testIdSuffix}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="absolute cursor-move rounded-sm border-2 border-accent"
              style={{
                left: crop.x * scale,
                top: crop.y * scale,
                width: crop.size * scale,
                height: crop.size * scale,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
              }}
            />
          </div>

          <div className="grid content-start gap-2">
            <span className="text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
              Preview
            </span>
            {/* PRU-13: the preview renders from the crop, not the raw
                original. */}
            <canvas
              ref={previewCanvas}
              width={96}
              height={96}
              data-testid={`avatar-crop-preview-${testIdSuffix}`}
              className="h-24 w-24 rounded-full border border-border-default object-cover"
            />
          </div>
        </div>

        <label className="grid gap-1 text-[0.8571rem] text-text-secondary">
          <span>Zoom</span>
          <input
            type="range"
            min={Math.max(1, Math.round(maxSize * 0.2))}
            max={maxSize}
            value={crop.size}
            data-testid={`avatar-crop-size-${testIdSuffix}`}
            onChange={e => { setSize(Number(e.target.value)); }}
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            testId={`avatar-crop-cancel-${testIdSuffix}`}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            testId={`avatar-crop-confirm-${testIdSuffix}`}
            loading={busy}
            aria-label="Use this crop"
            onClick={confirm}
          >
            Use this crop
          </Button>
        </div>
      </div>
    </Modal>
  );
}
