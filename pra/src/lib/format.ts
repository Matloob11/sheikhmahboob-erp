const KARACHI = "Asia/Karachi";

export interface KarachiStamp {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Civil clock in Punjab. Laptop timezone must not move tax dates. */
export function karachiStamp(value = new Date()): KarachiStamp {
  const map: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: KARACHI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateTime(value = new Date()): string {
  const stamp = karachiStamp(value);
  return `${stamp.year}-${pad2(stamp.month)}-${pad2(stamp.day)} ${pad2(stamp.hour)}:${pad2(stamp.minute)}:${pad2(stamp.second)}`;
}

export function formatDay(value = new Date()): string {
  return formatDateTime(value).slice(0, 10);
}

/** Friendly list stamp from a PRA `YYYY-MM-DD HH:MM:SS` (or Date/ms). */
export function formatListDateTime(value: string | number | Date): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "—";
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const hour = Number(match[4] ?? "0");
      const minute = Number(match[5] ?? "0");
      const when = new Date(year, month - 1, day, hour, minute);
      if (!Number.isNaN(when.getTime())) {
        return when.toLocaleString("en-PK", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) value = parsed;
    else return trimmed;
  }
  const when = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(when.getTime())) return "—";
  return when.toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function tabHue(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [12, 28, 152, 198, 220, 262];
  const hue = hues[Math.abs(hash) % hues.length] ?? 152;
  return `hsl(${hue} 42% 38%)`;
}
