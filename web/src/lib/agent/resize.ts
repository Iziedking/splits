/** The size that fits `max` on the long edge, keeping the shape; small images keep their size. */
export function fitWithin(width: number, height: number, max = 1568): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Shrinks a screenshot in the browser before upload: smaller uploads, fewer model tokens, and well
 * under Bedrock's 3.75 MB per image. Small images that already fit are sent as they are.
 */
export async function shrinkImage(file: Blob, max = 1568): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const size = fitWithin(bitmap.width, bitmap.height, max);
  if (size.width === bitmap.width && size.height === bitmap.height && file.size <= 1_500_000) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("resize failed"))), "image/jpeg", 0.9));
}
