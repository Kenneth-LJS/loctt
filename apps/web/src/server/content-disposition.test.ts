import { describe, expect, it } from "vitest";

import { contentDispositionAttachment } from "./content-disposition.js";

describe("contentDispositionAttachment", () => {
  it("emits both legacy and RFC 5987 parameters for an ASCII filename", () => {
    const v = contentDispositionAttachment("hello.txt");
    expect(v).toBe(`attachment; filename="hello.txt"; filename*=UTF-8''hello.txt`);
  });

  it("strips control characters from the legacy parameter", () => {
    // CR / LF / NUL in a filename would otherwise inject headers.
    const v = contentDispositionAttachment("a\r\nb\tc\x00d.txt");
    expect(v).toContain(`filename="abcd.txt"`);
    expect(v).not.toContain("\r");
    expect(v).not.toContain("\n");
    expect(v).not.toContain("\x00");
  });

  it("strips quote and backslash from the legacy parameter", () => {
    const v = contentDispositionAttachment(`name"with\\quote.txt`);
    expect(v).toContain(`filename="namewithquote.txt"`);
  });

  it("replaces non-ASCII bytes in the legacy parameter and encodes them in filename*", () => {
    const v = contentDispositionAttachment("résumé.txt");
    expect(v).toMatch(/filename="r_sum_\.txt"/);
    // filename* uses UTF-8 percent-encoding for non-attr-char bytes.
    expect(v).toContain(`filename*=UTF-8''r%C3%A9sum%C3%A9.txt`);
  });

  it("does not collapse non-ASCII into nothing — each byte becomes _", () => {
    const v = contentDispositionAttachment("ééé");
    expect(v).toMatch(/filename="___"/);
  });

  it("substitutes 'download' when the fallback would be empty (all control chars)", () => {
    const v = contentDispositionAttachment("\r\n\t");
    expect(v).toContain(`filename="download"`);
  });

  it("preserves attr-char punctuation unencoded in filename*", () => {
    const v = contentDispositionAttachment("abc-123_v1.2.tar.gz");
    expect(v).toContain(`filename*=UTF-8''abc-123_v1.2.tar.gz`);
  });

  it("percent-encodes spaces and quotes in filename*", () => {
    const v = contentDispositionAttachment(`hi there "q".txt`);
    // Space: 0x20 → %20; double-quote: 0x22 → %22.
    expect(v).toContain(`filename*=UTF-8''hi%20there%20%22q%22.txt`);
  });
});
