export const APP_VERSION = import.meta.env.VITE_APP_VERSION || "0.1.0";
export const APP_BUILD_TIME = import.meta.env.VITE_APP_BUILD_TIME || "";

export function formatBuildStamp(iso = APP_BUILD_TIME): string {
  if (!iso) return "local build";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  });
}
