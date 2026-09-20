import { telHref, waMeHref } from "../lib/phone";

export function PhoneLinks({ phone, name }: { phone: string; name?: string }) {
  const tel = telHref(phone);
  const wa = waMeHref(phone);
  if (!tel && !wa) return null;
  const who = name?.trim() || "this number";
  return (
    <p className="muted phone-links">
      {tel ? (
        <a href={tel} onClick={(event) => event.stopPropagation()}>
          Call {who}
        </a>
      ) : null}
      {tel && wa ? " · " : null}
      {wa ? (
        <a href={wa} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          WhatsApp
        </a>
      ) : null}
    </p>
  );
}
