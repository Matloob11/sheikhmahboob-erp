export function Skeleton({
  variant = "line",
  lines,
  rows,
}: {
  variant?: "line" | "kpi" | "table";
  lines?: number;
  rows?: number;
}) {
  const count = rows ?? lines ?? (variant === "kpi" ? 4 : 3);

  if (variant === "kpi") {
    return (
      <div className="skel skel-kpi" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <span key={index} className="skel-kpi-card">
            <span className="skel-block skel-line skel-short" />
            <span className="skel-block skel-value" />
          </span>
        ))}
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className="skel skel-table" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <span key={index} className="skel-row">
            <span className="skel-block skel-line" />
            <span className="skel-block skel-line" />
            <span className="skel-block skel-line skel-usin" />
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="skel" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="skel-block skel-line" style={index === count - 1 ? { width: "62%" } : undefined} />
      ))}
    </div>
  );
}
