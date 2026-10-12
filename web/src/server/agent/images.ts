import { AppError, badRequest } from "../errors";

export type AgentImage = { format: "png" | "jpeg" | "webp"; bytes: Uint8Array };
export type UploadedFile = { name: string; bytes: Uint8Array };

export const MAX_TEXT_CHARS = 4000;
export const MAX_IMAGES = 3;
/** Bedrock's per-image limit is 3.75 MB. */
export const MAX_IMAGE_BYTES = 3_750_000;
/** Three images at the limit plus the text and form overhead. */
export const MAX_UPLOAD_BYTES = 12_000_000;

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The image type from the file's own bytes; null for anything else. */
export function imageFormat(bytes: Uint8Array): AgentImage["format"] | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(bytes, ascii("RIFF")) && starts(bytes, ascii("WEBP"), 8)) return "webp";
  return null;
}

/** Refuses an oversized upload from its declared length, before the body is read. */
export function assertUploadSize(contentLength: string | null): void {
  // Browsers always declare a form's length; a chunked body without one would be buffered unchecked.
  if (contentLength === null || !/^\d+$/.test(contentLength)) {
    throw new AppError(411, "LENGTH_REQUIRED", "Couldn't tell how big that upload is. Try again from the Send money page.");
  }
  if (Number(contentLength) > MAX_UPLOAD_BYTES) {
    throw badRequest("TOO_LARGE", "That's too much to upload at once. Use up to 3 screenshots.");
  }
}

/** Checks everything before any model call, so a refused input costs nothing. */
export function checkAgentInput(input: { text: string; files: UploadedFile[] }): { text: string; images: AgentImage[] } {
  const text = input.text.trim();
  if (text.length > MAX_TEXT_CHARS) throw badRequest("TEXT_TOO_LONG", `Keep the description under ${MAX_TEXT_CHARS} characters`);
  if (input.files.length > MAX_IMAGES) throw badRequest("TOO_MANY_IMAGES", `Add up to ${MAX_IMAGES} screenshots`);
  const images: AgentImage[] = [];
  for (const file of input.files) {
    if (file.bytes.length > MAX_IMAGE_BYTES) throw badRequest("IMAGE_TOO_BIG", `"${file.name}" is larger than 3.75 MB`);
    const format = imageFormat(file.bytes);
    if (!format) {
      throw badRequest("IMAGE_TYPE", `"${file.name}" isn't a PNG, JPEG or WebP image`);
    }
    images.push({ format, bytes: file.bytes });
  }
  if (!text && images.length === 0) throw badRequest("EMPTY_DRAFT", "Paste a description or add a screenshot");
  return { text, images };
}
