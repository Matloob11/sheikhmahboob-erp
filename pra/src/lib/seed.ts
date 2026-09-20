import { currentPeriod } from "./ids";
import type { Settings } from "../types";

export function shouldSeedDemoClient(isProd: boolean): boolean {
  return !isProd;
}

export function emptyDeskSettings(now = new Date()): Settings {
  return {
    id: "desk",
    firmName: "My practice",
    workingPeriod: currentPeriod(now),
    fiscalYearStart: 7,
    theme: "system",
  };
}
