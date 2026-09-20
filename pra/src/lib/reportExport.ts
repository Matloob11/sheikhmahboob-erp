import type { Workbook } from "exceljs";

export interface ReportSheet {
  name: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}

async function createWorkbook(): Promise<Workbook> {
  const mod = await import("exceljs");
  return new mod.default.Workbook();
}

function addSheet(workbook: Workbook, name: string, headers: string[], rows: Array<Array<string | number>>): void {
  const sheet = workbook.addWorksheet(name.slice(0, 31));
  sheet.addRow(headers);
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFF3F5F7" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1A1714" },
  };
  rows.forEach((row) => sheet.addRow(row));
  headers.forEach((_, index) => {
    sheet.getColumn(index + 1).width = 18;
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportReportWorkbook(filename: string, sheets: ReportSheet[]): Promise<void> {
  const workbook = await createWorkbook();
  for (const sheet of sheets) {
    addSheet(workbook, sheet.name, sheet.headers, sheet.rows);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`,
  );
}

export function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function exportReportCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): void {
  const body = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  downloadBlob(new Blob([body], { type: "text/csv;charset=utf-8" }), filename.endsWith(".csv") ? filename : `${filename}.csv`);
}
