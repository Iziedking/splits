import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { assertUploadSize, checkAgentInput, imageFormat, MAX_IMAGE_BYTES } from "./images";

const png = (size = 16) => {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
};
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = () => new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBP")]);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
  return null;
};

describe("agent input", () => {
  it("knows images by their bytes, not their names", () => {
    expect(imageFormat(png())).toBe("png");
    expect(imageFormat(jpeg())).toBe("jpeg");
    expect(imageFormat(webp())).toBe("webp");
    expect(imageFormat(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });

  it("refuses a file that isn't an image", () => {
    expect(code(() => checkAgentInput({ text: "", files: [{ name: "list.png", bytes: new TextEncoder().encode("%PDF-1.7") }] }))).toBe("IMAGE_TYPE");
  });

  it("refuses an image over 3.75 MB, more than 3 images, and over-long text", () => {
    expect(code(() => checkAgentInput({ text: "", files: [{ name: "a.png", bytes: png(MAX_IMAGE_BYTES + 1) }] }))).toBe("IMAGE_TOO_BIG");
    const four = Array.from({ length: 4 }, (_, i) => ({ name: `${i}.png`, bytes: png() }));
    expect(code(() => checkAgentInput({ text: "", files: four }))).toBe("TOO_MANY_IMAGES");
    expect(code(() => checkAgentInput({ text: "x".repeat(4001), files: [] }))).toBe("TEXT_TOO_LONG");
  });

  it("needs text or an image (Review Focus 4)", () => {
    expect(code(() => checkAgentInput({ text: " \n\t ", files: [] }))).toBe("EMPTY_DRAFT");
  });

  it("returns trimmed text and typed images", () => {
    expect(checkAgentInput({ text: "  hi ", files: [{ name: "a", bytes: jpeg() }] })).toEqual({ text: "hi", images: [{ format: "jpeg", bytes: jpeg() }] });
  });

  it("refuses an oversized body before reading it (Review Focus 1)", () => {
    expect(code(() => assertUploadSize("12000001"))).toBe("TOO_LARGE");
    expect(code(() => assertUploadSize("11000000"))).toBeNull();
  });

  it("refuses an upload that doesn't say how big it is (chunked bodies are never buffered)", () => {
    expect(code(() => assertUploadSize(null))).toBe("LENGTH_REQUIRED");
    expect(code(() => assertUploadSize("lots"))).toBe("LENGTH_REQUIRED");
  });
});
