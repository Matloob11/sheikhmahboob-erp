export function Sparkline({
  values,
  label = "Posted sales in this period",
}: {
  values: ReadonlyArray<number>;
  label?: string;
}) {
  if (values.length < 2) {
    return <p className="muted sparkline-empty">Not enough posted days to chart.</p>;
  }

  const width = 220;
  const height = 40;
  const pad = 3;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = pad + (index / (values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
    >
      <polyline fill="none" stroke="currentColor" strokeWidth="1.7" points={points} />
    </svg>
  );
}
