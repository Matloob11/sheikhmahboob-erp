import type { ReactNode } from "react";

export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {kicker ? <p className="kicker">{kicker}</p> : null}
        <h2 className="page-title">{title}</h2>
        {description ? <div className="muted page-desc">{description}</div> : null}
      </div>
      {actions ? <div className="row page-actions">{actions}</div> : null}
    </div>
  );
}
