import { describe, expect, it } from "vitest";
import { leaveDecision, registerLeaveAsk, requestLeave } from "./leaveGate";

describe("leaveDecision", () => {
  it("allows clean pages without asking", () => {
    expect(leaveDecision(false, false)).toBe("allow");
  });

  it("blocks dirty pages until the clerk confirms", () => {
    expect(leaveDecision(true, false)).toBe("block");
    expect(leaveDecision(true, true)).toBe("allow");
  });
});

describe("requestLeave", () => {
  it("asks the registered handler when one is set", async () => {
    registerLeaveAsk(async () => false);
    expect(await requestLeave()).toBe(false);
    registerLeaveAsk(async () => true);
    expect(await requestLeave()).toBe(true);
    registerLeaveAsk(null);
    expect(await requestLeave()).toBe(true);
  });
});
