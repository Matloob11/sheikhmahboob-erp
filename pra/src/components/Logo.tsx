import seal from "../assets/smc-logo.svg";

export type LogoVariant = "mark" | "wordmark" | "compact";

const FIRM_NAME = "Sheikh Mahboob & Co.";

function Mark({ decorative }: { decorative: boolean }) {
  return <img className="logo-mark" src={seal} alt={decorative ? "" : `${FIRM_NAME} Lahore`} />;
}

export function Logo({
  variant = "wordmark",
  compact,
  label = FIRM_NAME,
  firm = "Daftar, PRA desk",
}: {
  variant?: LogoVariant;
  compact?: boolean;
  label?: string;
  firm?: string;
}) {
  const mode: LogoVariant = compact ? "compact" : variant;
  const showWord = mode !== "mark";
  return (
    <span className={`logo logo-${mode}`}>
      <Mark decorative={showWord} />
      {showWord ? (
        <span className="logo-copy">
          <span className="logo-word">{label}</span>
          {firm ? <small className="logo-firm">{firm}</small> : null}
        </span>
      ) : null}
    </span>
  );
}
