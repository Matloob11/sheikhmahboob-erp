import { describe, expect, it } from "vitest";
import { pkMobileLocal, telHref, waMeHref } from "./phone";

describe("pk mobile", () => {
  it("accepts 03, 92, and +92", () => {
    expect(pkMobileLocal("0300-1234567")).toBe("03001234567");
    expect(pkMobileLocal("923001234567")).toBe("03001234567");
    expect(pkMobileLocal("+92 300 1234567")).toBe("03001234567");
    expect(pkMobileLocal("0421234567")).toBeNull();
  });

  it("builds tel and WhatsApp links", () => {
    expect(telHref("03001234567")).toBe("tel:+923001234567");
    expect(waMeHref("03001234567")).toBe("https://wa.me/923001234567");
    expect(waMeHref("04235551234")).toBeNull();
  });
});
