"""Minimal dependency-free B&W PDF: STI-0332 UOM before vs after (2 pages, 2 tables)."""

from __future__ import annotations

from pathlib import Path

OUT = Path(r"C:\Users\Hp\Desktop\sheikhmahboob-erp\STI-0332_UOM_before_after.pdf")

BEFORE = [
	(1, "Kingtox Mosquitos spray 300ml", "3808.9110", "KG"),
	(2, "Scotch Bright Foam", "6307.1010", "KG"),
	(3, "SOAP Tibet Hand Wash 50gm", "3401.1100", "KG"),
	(4, "Broom Ring Iron", "2620.1100", "KG"),
	(5, "Broom Handle Wood", "4417.0010", "KG"),
	(6, "Duster Cloth Yellow 2' x 1'", "6307.1030", "KG"),
	(7, "Acid 600ml Fine Quality", "3402.3100", "KG"),
	(8, "Broom Sar Jhaaro", "4417.0010", "KG"),
	(9, "Dishwash Soap Sufi 150gm", "3401.1100", "KG"),
	(10, "Plastic Loota Fine Quality", "3405.2000", "KG"),
	(11, "Jala Brush Fine Quality", "0502.1000", "KG"),
	(12, "Toilet Brush Fine Quality", "0502.1000", "KG"),
	(13, "Tissue Box Pop-up Rose Petal", "4803.0000", "KG"),
	(14, "Harpic Blue 225ml", "3402.3100", "KG"),
	(15, "Phenyl Typhon 2.5Ltr", "2710.9100", "KG"),
	(16, "Lock China Medium Size Fine Quality", "8303.0000", "Numbers, pieces, units"),
	(17, "Pojara Cotton 1.5Kg", "5204.1900", "KG"),
	(18, "Air Freshner Cobra 300ml", "3303.0010", "Liter"),
	(19, "Detergent Surf", "3401.1100", "KG"),
	(20, "Broom Bansi Jhaaro Fine quality", "4417.0010", "KG"),
]

AFTER = [
	(1, "Kingtox Mosquitos spray 300ml", "3307.9010", "Numbers, pieces, units"),
	(2, "Scotch Bright Foam", "9603.5000", "Numbers, pieces, units"),
	(3, "SOAP Tibet Hand Wash 50gm", "3402.5000", "Numbers, pieces, units"),
	(4, "Broom Ring Iron", "9603.9000", "Numbers, pieces, units"),
	(5, "Broom Handle Wood", "9603.9000", "Numbers, pieces, units"),
	(6, "Duster Cloth Yellow 2' x 1'", "9603.9000", "Numbers, pieces, units"),
	(7, "Acid 600ml Fine Quality", "3402.5000", "Numbers, pieces, units"),
	(8, "Broom Sar Jhaaro", "9603.1000", "Numbers, pieces, units"),
	(9, "Dishwash Soap Sufi 150gm", "3402.5000", "Numbers, pieces, units"),
	(10, "Plastic Loota Fine Quality", "3924.9000", "Numbers, pieces, units"),
	(11, "Jala Brush Fine Quality", "9603.2900", "Numbers, pieces, units"),
	(12, "Toilet Brush Fine Quality", "9603.2900", "Numbers, pieces, units"),
	(13, "Tissue Box Pop-up Rose Petal", "3924.9000", "Numbers, pieces, units"),
	(14, "Harpic Blue 225ml", "3402.5000", "Numbers, pieces, units"),
	(15, "Phenyl Typhon 2.5Ltr", "3402.5000", "Numbers, pieces, units"),
	(16, "Lock China Medium Size Fine Quality", "8301.1000", "Numbers, pieces, units"),
	(17, "Pojara Cotton 1.5Kg", "9603.9000", "Numbers, pieces, units"),
	(18, "Air Freshner Cobra 300ml", "3307.9010", "Numbers, pieces, units"),
	(19, "Detergent Surf", "3402.5000", "Numbers, pieces, units"),
	(20, "Broom Bansi Jhaaro Fine quality", "9603.1000", "Numbers, pieces, units"),
]

PAGE_W, PAGE_H = 595, 842
MARGIN = 36
ROW_H = 14


def esc(text: str) -> str:
	return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def page_stream(title: str, subtitle: str, rows: list[tuple]) -> str:
	cmds: list[str] = ["0 0 0 RG", "0 0 0 rg", "0.5 w"]
	y = PAGE_H - MARGIN

	def t(x, y_pos, s, size=8, bold=False):
		font = "F2" if bold else "F1"
		cmds.append(f"BT /{font} {size} Tf {x:.1f} {y_pos:.1f} Td ({esc(s)}) Tj ET")

	def line(x1, y1, x2, y2):
		cmds.append(f"{x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S")

	def rect(x, yb, w, h):
		cmds.append(f"{x:.1f} {yb:.1f} {w:.1f} {h:.1f} re S")

	t(MARGIN, y, title, 12, True)
	y -= 16
	t(MARGIN, y, subtitle, 9)
	y -= 22

	cols = [28, 250, 70, 150]
	x0 = MARGIN
	table_w = sum(cols)
	data = [["#", "Item", "HS Code", "UOM"]] + [
		[str(n), d, hs, uom] for n, d, hs, uom in rows
	]

	for r_i, row in enumerate(data):
		yb = y - ROW_H
		rect(x0, yb, table_w, ROW_H)
		cx = x0
		for w in cols[:-1]:
			cx += w
			line(cx, yb, cx, y)
		cx = x0 + 3
		for c_i, (cell, w) in enumerate(zip(row, cols)):
			s = str(cell)
			if c_i == 1 and len(s) > 42:
				s = s[:41] + "..."
			t(cx, yb + 4, s, 7.5, r_i == 0)
			cx += w
		y = yb

	return "\n".join(cmds)


def build_pdf(path: Path) -> None:
	streams = [
		page_stream(
			"STI-0332 - Table 1 Before",
			"SUBHAN ENTERPRISES - old HS + KG / Liter",
			BEFORE,
		),
		page_stream(
			"STI-0332 - Table 2 After",
			"SUBHAN ENTERPRISES - new HS + pieces (Production Valid)",
			AFTER,
		),
	]

	# Object IDs:
	# 1 Catalog, 2 Pages, 3 Helvetica, 4 Helvetica-Bold,
	# 5 content1, 6 page1, 7 content2, 8 page2
	objects: dict[int, bytes] = {
		1: b"<< /Type /Catalog /Pages 2 0 R >>",
		2: b"<< /Type /Pages /Kids [6 0 R 8 0 R] /Count 2 >>",
		3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		4: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
	}

	for i, stream in enumerate(streams):
		content_id = 5 + i * 2
		page_id = 6 + i * 2
		body = stream.encode("latin-1", errors="replace")
		objects[content_id] = (
			f"<< /Length {len(body)} >>\nstream\n".encode() + body + b"\nendstream"
		)
		objects[page_id] = (
			f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
			f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
			f"/Contents {content_id} 0 R >>"
		).encode()

	out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
	offsets = {0: 0}
	for obj_id in sorted(objects):
		offsets[obj_id] = len(out)
		out += f"{obj_id} 0 obj\n".encode()
		out += objects[obj_id]
		out += b"\nendobj\n"

	xref_pos = len(out)
	size = max(objects) + 1
	out += f"xref\n0 {size}\n".encode()
	out += b"0000000000 65535 f \n"
	for obj_id in range(1, size):
		out += f"{offsets[obj_id]:010d} 00000 n \n".encode()
	out += (
		f"trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
	).encode()
	path.write_bytes(out)


if __name__ == "__main__":
	build_pdf(OUT)
	print(OUT)
	print("bytes", OUT.stat().st_size)
