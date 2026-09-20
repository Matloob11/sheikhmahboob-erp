import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBlocker } from "react-router-dom";
import { Confirm } from "../components/Confirm";
import { shouldWarnLeave } from "../domain/deskChrome";
import { leaveDecision, registerLeaveAsk } from "../lib/leaveGate";

/**
 * Warn on tab close, block in-app route changes, and gate client/period switches
 * through leaveGate.requestLeave when the form is dirty.
 * Callers must render the returned node.
 */
export function useUnsavedGuard(dirty: boolean): ReactNode {
  const [askOpen, setAskOpen] = useState(false);
  const resolver = useRef<((allow: boolean) => void) | null>(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const blocker = useBlocker(shouldWarnLeave(dirty));

  useEffect(() => {
    if (!shouldWarnLeave(dirty)) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    registerLeaveAsk(async () => {
      if (leaveDecision(dirtyRef.current, false) === "allow") return true;
      return new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setAskOpen(true);
      });
    });
    return () => registerLeaveAsk(null);
  }, []);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    resolver.current = (allow) => {
      if (allow) blocker.proceed?.();
      else blocker.reset?.();
    };
    setAskOpen(true);
  }, [blocker]);

  function finish(allow: boolean) {
    setAskOpen(false);
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(allow);
  }

  return createPortal(
    <Confirm
      open={askOpen}
      title="Leave without saving?"
      body="You have unsaved changes on this page. Leave now and they will be lost."
      confirmLabel="Leave"
      danger
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />,
    document.body,
  );
}
