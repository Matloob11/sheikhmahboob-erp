import { describe, expect, it } from "vitest";
import { jobToPraResult, type PostJobPublic } from "./postApi";

describe("postApi", () => {
  it("maps posted job to ok result", () => {
    const job = {
      status: "posted",
      fiscalNumber: "123456789012345678",
      lastCode: "100",
      lastError: "",
    } as PostJobPublic;
    const result = jobToPraResult(job);
    expect(result.ok).toBe(true);
    expect(result.fiscalNumber).toBe("123456789012345678");
  });

  it("maps unknown job to unknown kind", () => {
    const job = {
      status: "unknown",
      fiscalNumber: "",
      lastCode: "",
      lastError: "Check IRIS",
    } as PostJobPublic;
    expect(jobToPraResult(job).kind).toBe("unknown");
  });

  it("maps failed job to rejected", () => {
    const job = {
      status: "failed",
      fiscalNumber: "",
      lastCode: "201",
      lastError: "Invalid PCT",
    } as PostJobPublic;
    const result = jobToPraResult(job);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("rejected");
    expect(result.code).toBe("201");
  });
});
