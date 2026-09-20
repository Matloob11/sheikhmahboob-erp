import type { ReactNode } from "react";

export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `panel ${className}` : "panel"}>
      {title || actions ? (
        <header className="panel-head">
          {title ? <h3>{title}</h3> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
