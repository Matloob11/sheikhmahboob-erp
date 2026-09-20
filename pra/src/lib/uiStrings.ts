/** Clerk-facing copy. Keep English here so Urdu can map the same keys later. */
export const uiStrings = {
  praDuplicateWithFiscal: "Do not post again. PRA already has this USIN.",
  praDuplicateLookup:
    "Do not post again. Look up this USIN on IRIS → IMS Fiscal Report if you need the fiscal number.",
  praAuthNext: "Update the eIMS token and POS ID on the client file, then retry this USIN once.",
  praIpNext: "Email eims@pra.punjab.gov.pk with PNTN, business name, POS ID, server IP, and location.",
  praValidationNext: "Fix the fields PRA named, validate locally, then retry.",
  praGenericNext: "Read the PRA message. Retry only if this USIN was not accepted.",
  praAlreadyHasUsin: "PRA already has this USIN.",
  praRefusedToken: "PRA refused the token or POS ID.",
  praRefusedIp: "PRA refused the production IP.",
  praRejectedPayload: "PRA rejected the invoice payload.",
  periodLocked: (label: string) =>
    `${label} is locked because the return is marked filed. Unlock it on Returns before changing papers.`,
  clientCascadeBlocked:
    "This file has posted or unclear invoices. Remove cascade is blocked so fiscal history stays on the desk.",
} as const;
