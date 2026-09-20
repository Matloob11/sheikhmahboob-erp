export function fiscalYearLabel(period: string, startMonth = 7): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  if (!year || !month) return period;
  const start = startMonth >= 1 && startMonth <= 12 ? startMonth : 7;
  const fyStart = month >= start ? year : year - 1;
  return `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
}
