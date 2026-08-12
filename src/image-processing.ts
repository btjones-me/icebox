export const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_STORED_IMAGE_BYTES = 5 * 1024 * 1024;
export const TARGET_IMAGE_BYTES = 1.5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 1600;
export const THUMBNAIL_IMAGE_DIMENSION = 256;
export const MAX_THUMBNAIL_BYTES = 256 * 1024;

type ProcessingStage = "source_size" | "decode" | "heic_decode" | "dimensions" | "canvas" | "encode";

export class ImageProcessingError extends Error {
  readonly stage: ProcessingStage;

  constructor(stage: ProcessingStage, message: string) {
    super(message);
    this.name = "ImageProcessingError";
    this.stage = stage;
  }
}

export type ProcessedImage = {
  file: File;
  thumbnailFile: File;
  width: number;
  height: number;
  sourceBytes: number;
  convertedFromHeic: boolean;
};

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

function filenameWithoutExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, "").trim() || "icebox";
}

export function looksLikeHeic(file: Pick<File, "name" | "type">) {
  return /image\/(?:hei[cf]|heif-sequence|heic-sequence)/i.test(file.type)
    || /\.(?:hei[cf])$/i.test(file.name);
}

async function decodeWithImageElement(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.decoding = "async";
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The browser could not decode this image"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeNatively(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch {
      // Safari supports some camera formats through an image element but not createImageBitmap.
    }
  }
  return decodeWithImageElement(blob);
}

async function decodeSource(file: File): Promise<{ decoded: DecodedImage; convertedFromHeic: boolean }> {
  try {
    return { decoded: await decodeNatively(file), convertedFromHeic: false };
  } catch {
    let isHeic = looksLikeHeic(file);
    if (!isHeic) {
      try {
        const detector = await import("heic-to/csp");
        isHeic = await detector.isHeic(file);
      } catch {
        isHeic = false;
      }
    }
    if (!isHeic) throw new ImageProcessingError("decode", "This photo format could not be read");
    try {
      const { heicTo } = await import("heic-to/csp");
      const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
      return { decoded: await decodeNatively(jpeg), convertedFromHeic: true };
    } catch {
      throw new ImageProcessingError("heic_decode", "This iPhone photo could not be converted; try taking a new photo");
    }
  }
}

function outputDimensions(width: number, height: number, maxDimension: number) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function renderJpeg(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
  qualities: number[],
  targetBytes: number,
) {
  const dimensions = outputDimensions(sourceWidth, sourceHeight, maxDimension);
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  let smallest: Blob | null = null;
  for (const quality of qualities) {
    const blob = await canvasToJpeg(canvas, quality);
    if (!blob || blob.type !== "image/jpeg") continue;
    smallest = blob;
    if (blob.size <= targetBytes) return { blob, ...dimensions };
  }
  return smallest ? { blob: smallest, ...dimensions } : null;
}

export async function processImageFile(file: File): Promise<ProcessedImage> {
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new ImageProcessingError("source_size", "Choose an image under 25MB");
  }

  const { decoded, convertedFromHeic } = await decodeSource(file);
  try {
    if (!decoded.width || !decoded.height || decoded.width * decoded.height > 64_000_000) {
      throw new ImageProcessingError("dimensions", "This photo has unusually large dimensions");
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new ImageProcessingError("canvas", "Image processing is unavailable in this browser");

    const sourceMax = Math.max(decoded.width, decoded.height);
    const dimensionSteps = [...new Set([MAX_IMAGE_DIMENSION, 1440, 1280, 1120, 960, 800].map((value) => Math.min(value, sourceMax)))];
    const qualities = [0.86, 0.78, 0.7, 0.62, 0.54];
    let acceptable: { blob: Blob; width: number; height: number } | null = null;

    for (const maxDimension of dimensionSteps) {
      const rendered = await renderJpeg(canvas, context, decoded.source, decoded.width, decoded.height, maxDimension, qualities, TARGET_IMAGE_BYTES);
      if (!rendered) continue;
      if (rendered.blob.size <= MAX_STORED_IMAGE_BYTES) acceptable = rendered;
      if (rendered.blob.size <= TARGET_IMAGE_BYTES) break;
    }

    if (!acceptable) throw new ImageProcessingError("encode", "This photo could not be compressed below 5MB");
    const thumbnail = await renderJpeg(
      canvas,
      context,
      decoded.source,
      decoded.width,
      decoded.height,
      THUMBNAIL_IMAGE_DIMENSION,
      [0.8, 0.7, 0.6],
      MAX_THUMBNAIL_BYTES,
    );
    if (!thumbnail || thumbnail.blob.size > MAX_THUMBNAIL_BYTES) {
      throw new ImageProcessingError("encode", "This photo could not be prepared for fast previews");
    }
    return {
      file: new File([acceptable.blob], `${filenameWithoutExtension(file.name)}.jpg`, { type: "image/jpeg" }),
      thumbnailFile: new File([thumbnail.blob], `${filenameWithoutExtension(file.name)}-thumbnail.jpg`, { type: "image/jpeg" }),
      width: acceptable.width,
      height: acceptable.height,
      sourceBytes: file.size,
      convertedFromHeic,
    };
  } finally {
    decoded.dispose();
  }
}
