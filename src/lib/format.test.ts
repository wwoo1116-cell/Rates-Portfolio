import { describe, expect, it } from "vitest";
import { formatKrwAxis, formatKrwAxisSigned } from "./format";

describe("formatKrwAxis / formatKrwAxisSigned (S10 MtM chart formatting)", () => {
  it("억 tier: one decimal, no sub-만원 digits", () => {
    expect(formatKrwAxis(320_000_000)).toBe("3.2억");
    expect(formatKrwAxis(-320_000_000)).toBe("-3.2억");
  });

  it("만 tier: integer 만원, grouped, no decimals", () => {
    expect(formatKrwAxis(4_500_000)).toBe("450만");
    expect(formatKrwAxis(-4_500_000)).toBe("-450만");
    expect(formatKrwAxis(12_345_678)).toBe("1,235만"); // sub-만원 digits dropped
  });

  it("below 1만: plain grouped digits (nothing to truncate to)", () => {
    expect(formatKrwAxis(9_999)).toBe("9,999");
    expect(formatKrwAxis(0)).toBe("0");
  });

  it("signed variant prefixes + only for positive values", () => {
    expect(formatKrwAxisSigned(320_000_000)).toBe("+3.2억");
    expect(formatKrwAxisSigned(-4_500_000)).toBe("-450만");
    expect(formatKrwAxisSigned(0)).toBe("0");
  });
});
