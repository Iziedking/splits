import { describe, expect, it } from "vitest";
import { pageOf } from "./paging";

const items = Array.from({ length: 12 }, (_, i) => i);

describe("pageOf", () => {
  it("returns the requested page and how many there are", () => {
    expect(pageOf(items, 0, 5)).toEqual({ items: [0, 1, 2, 3, 4], page: 0, pages: 3 });
    expect(pageOf(items, 2, 5)).toEqual({ items: [10, 11], page: 2, pages: 3 });
  });

  it("clamps a page past the end to the last page, e.g. after the list shrinks", () => {
    expect(pageOf(items, 9, 5)).toEqual({ items: [10, 11], page: 2, pages: 3 });
    expect(pageOf(items.slice(0, 4), 2, 5)).toEqual({ items: [0, 1, 2, 3], page: 0, pages: 1 });
  });

  it("clamps a negative page to the first", () => {
    expect(pageOf(items, -1, 5).page).toBe(0);
  });

  it("treats an empty list as one empty page", () => {
    expect(pageOf([], 0, 5)).toEqual({ items: [], page: 0, pages: 1 });
  });
});
