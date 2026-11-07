/**
 * Evidence image validation. Node-only (sharp); imported by the upload route and the tests.
 * 1. Magic bytes must say JPEG, PNG or WebP, and agree with any declared type.
 * 2. The whole image must decode (rejects polyglots, truncated files, and anything that only
 *    starts with an image header), within a pixel budget (rejects decompression bombs).
 * 3. It is re-encoded with EXIF orientation applied and ALL metadata dropped: GPS position,
 *    camera serials and timestamps never reach storage, the AI provider, or the browser.
 */
import sharp from "sharp";
import { HttpError } from "./errors.ts";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // under the 4.5 MB request-body limit of serverless hosts
export const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 2400;
export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export function sniff(magic: Uint8Array): ImageType | null {
  if (magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => magic[i] === b)) return "image/png";
  if (String.fromCharCode(...magic.slice(0, 4)) === "RIFF" && String.fromCharCode(...magic.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function sanitizeImage(input: Uint8Array, declaredType?: string): Promise<{ bytes: Buffer; type: ImageType; ext: "jpg" | "png" | "webp"; width: number; height: number }> {
  if (input.byteLength === 0 || input.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, "Images must be between 1 byte and 4 MB");
  const type = sniff(input.subarray(0, 12));
  if (!type) throw new HttpError(415, "Only real JPG, PNG or WebP images are accepted");
  if (declaredType && declaredType !== type) throw new HttpError(415, "Image contents do not match the declared file type");
  try {
    const pipeline = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
    const encoded = type === "image/png" ? pipeline.png() : type === "image/webp" ? pipeline.webp({ quality: 88 }) : pipeline.jpeg({ quality: 88, mozjpeg: true });
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    return { bytes: data, type, ext: type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg", width: info.width, height: info.height };
  } catch {
    throw new HttpError(415, "The image could not be decoded. Export it again as JPG, PNG or WebP.");
  }
}
