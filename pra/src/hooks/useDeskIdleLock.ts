import { useEffect } from "react";
import { lockPractice } from "../domain/settings";
import { idleShouldLock, readIdleMinutes, readLastActivity, recordDeskActivity } from "../lib/idleLock";

export function useDeskIdleLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    recordDeskActivity();
    const mark = () => recordDeskActivity();
    const tick = () => {
      if (idleShouldLock(readLastActivity(), Date.now(), readIdleMinutes())) {
        lockPractice();
      }
    };
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    document.addEventListener("visibilitychange", mark);
    const id = window.setInterval(tick, 15_000);
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
      document.removeEventListener("visibilitychange", mark);
      window.clearInterval(id);
    };
  }, [enabled]);
}
