import { describe, expect, it } from "vitest";
import { amountFromDraft, amountTextFromNumber, money, nextAmountDraft, parseAmount } from "./money";

describe("money", () => {
  it("rounds to two decimals", () => {
    expect(money(1.234)).toBe(1.23);
    expect(money(10.1 * 0.16)).toBe(1.62);
  });

  it("treats non-finite values as zero", () => {
    expect(money(Number.NaN)).toBe(0);
  });

  it("parses amounts with commas", () => {
    expect(parseAmount("1,600.50")).toBe(1600.5);
    expect(parseAmount("x")).toBe(0);
  });
});

describe("amount draft typing", () => {
  it("keeps a trailing decimal so 1.5 does not become 15", () => {
    // Old controlled path: parse on every keystroke, then String(n) again.
    let n = 0;
    n = parseAmount("1");
    n = parseAmount(`${n}.`);
    n = parseAmount(`${n}5`);
    expect(n).toBe(15);

    let draft = "";
    draft = nextAmountDraft(draft, "1");
    draft = nextAmountDraft(draft, "1.");
    expect(draft).toBe("1.");
    draft = nextAmountDraft(draft, "1.5");
    expect(draft).toBe("1.5");
    expect(amountFromDraft(draft)).toBe(1.5);
  });

  it("rejects junk keystrokes and round-trips a stored number", () => {
    expect(nextAmountDraft("12", "12a")).toBe("12");
    expect(nextAmountDraft("", ".")).toBe(".");
    expect(amountFromDraft(".")).toBe(0);
    expect(amountFromDraft("")).toBe(0);
    expect(amountTextFromNumber(1600.5)).toBe("1600.5");
    expect(amountTextFromNumber(16)).toBe("16");
  });
});
