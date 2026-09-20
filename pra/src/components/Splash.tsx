import type { ReactNode } from "react";
import { cabinetWarning } from "../lib/cabinet";
import { Logo } from "./Logo";

export function Splash({
  title = "Opening the desk",
  body = cabinetWarning(import.meta.env.PROD),
  children,
}: {
  title?: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="boot-screen splash" role="status" aria-live="polite">
      <Logo />
      <p className="kicker">{title}</p>
      <p className="muted">{body}</p>
      {children}
    </div>
  );
}
