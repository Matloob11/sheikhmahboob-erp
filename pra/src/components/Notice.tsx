import type { ReactNode } from "react";

export function Notice({
  tone,
  children,
}: {
  tone: "good" | "bad" | "info";
  children: ReactNode;
}) {
  const cls = tone === "bad" ? "alert bad" : tone === "good" ? "alert good" : "alert info";
  return (
    <div className={cls} role={tone === "bad" ? "alert" : "status"}>
      {children}
    </div>
  );
}
