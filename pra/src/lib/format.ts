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

export function tabHue(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [12, 28, 152, 198, 220, 262];
  const hue = hues[Math.abs(hash) % hues.length] ?? 152;
  return `hsl(${hue} 42% 38%)`;
}
