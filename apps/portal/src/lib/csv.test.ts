import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv (AC10)", () => {
  it("neutralizes formula operators", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe(`"'=SUM(A1:A2)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell("-2")).toBe(`"'-2"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
    expect(csvCell("\tx")).toBe(`"'\tx"`);
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"')).toBe(`"a,""b"""`);
    expect(csvCell("line1\nline2")).toBe(`"line1\nline2"`);
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });
  it("builds a document with CRLF", () => {
    expect(toCsv([{ key: "a", label: "A" }, { key: "b", label: "B" }], [{ a: 1, b: "=x" }])).toBe(`A,B\r\n1,"'=x"\r\n`);
  });
});
