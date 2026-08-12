"""Build the fill-in workbook for one FBR Digital Invoicing invoice."""

import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = Path(__file__).parent
REF = json.loads((HERE / "ref_clean.json").read_text(encoding="utf-8"))
OUT = Path(r"c:/Users/Matloob/Desktop/sheikhmahboob-erp/branding/../ops/DI-Invoice-Intake.xlsx")

FONT = "Arial"
FILL_IN = PatternFill("solid", fgColor="FFFF00")   # you type here
DERIVED = PatternFill("solid", fgColor="EFEFEF")   # filled by the system
HEADER = PatternFill("solid", fgColor="868A4A")    # brand olive
SECTION = PatternFill("solid", fgColor="E8E9DC")

THIN = Side(style="thin", color="BBBBBB")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# FBR's ten scenarios for this account, in the order the portal lists them.
ACCOUNT_SCENARIOS = ["SN001", "SN002", "SN005", "SN006", "SN007", "SN016", "SN017", "SN018", "SN019", "SN024"]
SCENARIO_BY_ID = {s["name"]: s for s in REF["scenarios"]}

wb = Workbook()


def style_header(ws, row, last_col):
	for col in range(1, last_col + 1):
		cell = ws.cell(row=row, column=col)
		cell.font = Font(name=FONT, bold=True, color="FFFFFF", size=11)
		cell.fill = HEADER
		cell.alignment = Alignment(vertical="center", wrap_text=True)
		cell.border = BOX
	ws.row_dimensions[row].height = 30


def title(ws, text, subtitle, last_col):
	ws["A1"] = text
	ws["A1"].font = Font(name=FONT, bold=True, size=14)
	ws["A2"] = subtitle
	ws["A2"].font = Font(name=FONT, size=10, italic=True, color="666666")
	ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=last_col)
	ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=last_col)


def widths(ws, mapping):
	for col, width in mapping.items():
		ws.column_dimensions[col].width = width


def dv(ws, values, cells, title_text, prompt):
	"""Attach a dropdown. Long lists go in via a formula range on Lists."""
	joined = ",".join(values)
	if len(joined) < 250:
		validation = DataValidation(type="list", formula1=f'"{joined}"', allow_blank=True)
	else:
		validation = DataValidation(type="list", formula1=values, allow_blank=True)
	validation.promptTitle = title_text
	validation.prompt = prompt
	validation.showInputMessage = True
	validation.error = "Pick a value from the list."
	validation.showErrorMessage = True
	ws.add_data_validation(validation)
	validation.add(cells)


# ---------------------------------------------------------------- Instructions
ws = wb.active
ws.title = "Start here"
title(ws, "FBR Digital Invoicing — invoice intake", "Fill the yellow cells. Everything else is worked out for you.", 6)
widths(ws, {"A": 4, "B": 34, "C": 92})

rows = [
	("", "", ""),
	("How to use this", "", ""),
	("", "1. Seller", "Fill only if this company is not already set up. One row."),
	("", "2. Buyer", "The customer being invoiced. One row."),
	("", "3. Items", "One row per product or service on the invoice."),
	("", "4. Invoice", "The invoice header, then one row per line."),
	("", "5. Lists", "Valid values. Do not edit — the dropdowns read from here."),
	("", "", ""),
	("Things FBR rejects", "", ""),
	("", "Buyer NTN = Seller NTN", "Self invoicing is refused (error 0058). The buyer needs its own NTN or CNIC."),
	("", "Rate is not 18%", "An SRO Schedule and an Item Serial become mandatory (errors 0077 and 0078). Leave both blank at 18%."),
	("", "Wrong UOM", "The unit must be an FBR UOM from the Lists tab, not an ERPNext one (error 0099)."),
	("", "Scenario mismatch", "The scenario must match the sale type of the items. Column D on the Invoice tab shows what each expects."),
	("", "Missing HS Code", "Every line needs one, in NNNN.NNNN form (error 0019)."),
	("", "", ""),
	("What I do with it", "", ""),
	("", "", "I create the Seller, Buyer and Items, build the invoice, validate it against the FBR sandbox, and leave it as a Draft."),
	("", "", "You review the draft and press Submit yourself. Nothing is filed with FBR until you do."),
	("", "", ""),
	("Not in this sheet", "", ""),
	("", "Production token", "Send it separately, never in a file or a chat. Sandbox works without it."),
]

r = 4
for label, sub, text in rows:
	if label:
		ws.cell(row=r, column=2, value=label).font = Font(name=FONT, bold=True, size=11)
		ws.cell(row=r, column=2).fill = SECTION
		ws.cell(row=r, column=3).fill = SECTION
	if sub:
		ws.cell(row=r, column=2, value=sub).font = Font(name=FONT, bold=True, size=10)
	if text:
		cell = ws.cell(row=r, column=3, value=text)
		cell.font = Font(name=FONT, size=10)
		cell.alignment = Alignment(wrap_text=True, vertical="top")
	r += 1

legend_row = r + 1
ws.cell(row=legend_row, column=2, value="Legend").font = Font(name=FONT, bold=True, size=11)
ws.cell(row=legend_row + 1, column=2, value="You type here").font = Font(name=FONT, size=10)
ws.cell(row=legend_row + 1, column=2).fill = FILL_IN
ws.cell(row=legend_row + 2, column=2, value="Filled in for you").font = Font(name=FONT, size=10)
ws.cell(row=legend_row + 2, column=2).fill = DERIVED


# ---------------------------------------------------------------------- Lists
lists = wb.create_sheet("5. Lists")
title(lists, "Valid values", "Reference only — the dropdowns read from these columns. Do not edit.", 6)
widths(lists, {"A": 26, "B": 34, "C": 30, "D": 12, "E": 44, "F": 34})

headers = ["Province", "Sale Type", "FBR UOM", "Scenario", "Scenario means", "Existing sellers / buyers / items"]
for i, h in enumerate(headers, start=1):
	lists.cell(row=4, column=i, value=h)
style_header(lists, 4, 6)

existing = (
	[f"SELLER: {s}" for s in REF["sellers"]]
	+ [f"BUYER: {b}" for b in REF["buyers"]]
	+ [f"ITEM: {t['name']}" for t in REF["tax_items"]]
)

for i, value in enumerate(REF["provinces"]):
	lists.cell(row=5 + i, column=1, value=value)
for i, value in enumerate(REF["sale_types"]):
	lists.cell(row=5 + i, column=2, value=value)
for i, value in enumerate(REF["hs_uoms"]):
	lists.cell(row=5 + i, column=3, value=value)
for i, code in enumerate(ACCOUNT_SCENARIOS):
	lists.cell(row=5 + i, column=4, value=code)
	meta = SCENARIO_BY_ID.get(code, {})
	lists.cell(row=5 + i, column=5, value=f"{meta.get('description','')} — needs sale type: {meta.get('sale__purchase_type','')}")
for i, value in enumerate(existing):
	lists.cell(row=5 + i, column=6, value=value)

for row in lists.iter_rows(min_row=5, max_row=5 + max(len(REF["sale_types"]), len(existing)), max_col=6):
	for cell in row:
		cell.font = Font(name=FONT, size=10)

PROVINCE_RANGE = f"'5. Lists'!$A$5:$A${4 + len(REF['provinces'])}"
UOM_RANGE = f"'5. Lists'!$C$5:$C${4 + len(REF['hs_uoms'])}"
SCENARIO_RANGE = f"'5. Lists'!$D$5:$D${4 + len(ACCOUNT_SCENARIOS)}"
SALETYPE_RANGE = f"'5. Lists'!$B$5:$B${4 + len(REF['sale_types'])}"


def sheet(name, heading, sub, cols, example, notes=None, rows_to_fill=1):
	ws = wb.create_sheet(name)
	title(ws, heading, sub, len(cols))
	widths(ws, {get_column_letter(i + 1): c[1] for i, c in enumerate(cols)})
	for i, (label, _w, *rest) in enumerate(cols, start=1):
		cell = ws.cell(row=4, column=i, value=label)
		if rest and rest[0]:
			cell.comment = Comment(rest[0], "Template")
	style_header(ws, 4, len(cols))

	for i, value in enumerate(example, start=1):
		cell = ws.cell(row=5, column=i, value=value)
		cell.font = Font(name=FONT, size=10, italic=True, color="888888")
		cell.border = BOX
	ws.cell(row=5, column=1).comment = Comment("Example row — overwrite it or delete it.", "Template")

	for row in range(6, 6 + rows_to_fill):
		for col in range(1, len(cols) + 1):
			cell = ws.cell(row=row, column=col)
			cell.fill = FILL_IN
			cell.border = BOX
			cell.font = Font(name=FONT, size=10)

	if notes:
		note_row = 6 + rows_to_fill + 1
		for note in notes:
			cell = ws.cell(row=note_row, column=1, value=note)
			cell.font = Font(name=FONT, size=9, italic=True, color="666666")
			ws.merge_cells(start_row=note_row, start_column=1, end_row=note_row, end_column=len(cols))
			note_row += 1
	return ws


# ------------------------------------------------------------------- 1 Seller
seller = sheet(
	"1. Seller",
	"Seller / Company",
	"Only needed for a company that is not set up yet. Leave blank to use an existing one.",
	[
		("Seller / Business Name *", 34, "Exactly as registered with FBR."),
		("Seller NTN / CNIC", 20, "7-digit NTN, or 13-digit CNIC."),
		("Seller Province *", 24, None),
		("Seller Address *", 46, None),
		("Sandbox Token", 30, "Sandbox only. Send the production token separately, never in a file."),
	],
	["SHEIKH MAHBOOB & CO.", "3630264674703", "PUNJAB", "2-GARDEE TRUST BUILDING, NAPIER ROAD, LAHORE", "(paste sandbox token)"],
	["* required.  Already set up: " + ", ".join(REF["sellers"])],
)
dv(seller, PROVINCE_RANGE, "C6:C20", "Province", "Pick an FBR province.")

# -------------------------------------------------------------------- 2 Buyer
buyer = sheet(
	"2. Buyer",
	"Buyer",
	"The customer on this invoice.",
	[
		("Buyer / Business Name *", 34, "As registered with FBR for a registered buyer."),
		("Registration Type *", 20, "Registered or Unregistered."),
		("Buyer NTN / CNIC *", 20, "Must NOT equal the seller's — FBR refuses self invoicing (0058)."),
		("Buyer Province *", 24, None),
		("Buyer Address *", 46, None),
		("Belongs to seller", 30, "Leave blank to share this buyer across all your companies."),
	],
	["AHMAD TRADERS", "Registered", "2152260", "PUNJAB", "113/7 KOT LAKHPAT, INDUSTRIAL ESTATE, LAHORE", ""],
	["* required.  Already set up: " + ", ".join(REF["buyers"])],
)
dv(buyer, ["Registered", "Unregistered"], "B6:B20", "Registration Type", "Registered or Unregistered.")
dv(buyer, PROVINCE_RANGE, "D6:D20", "Province", "Pick an FBR province.")

# -------------------------------------------------------------------- 3 Items
items = sheet(
	"3. Items",
	"Items",
	"One row per product or service. Reuse an existing item by naming it on the Invoice tab instead.",
	[
		("Item Name *", 32, "Becomes the product description sent to FBR."),
		("HS Code *", 14, "NNNN.NNNN, e.g. 4820.9000. Services use 9801.xxxx."),
		("FBR UOM *", 24, "Must be an FBR unit, not an ERPNext one (error 0099)."),
		("Rate label *", 12, 'What FBR calls the rate: "18%", "1%", "0%", "Exempt".'),
		("Rate % *", 10, "The number only. 18 for 18%. 0 for exempt or zero-rated."),
		("Sale Type *", 30, "Must match the scenario you choose on the Invoice tab."),
		("Fixed / Notified Value", 18, "3rd Schedule goods only. Leave 0 otherwise."),
		("Belongs to seller", 26, "Leave blank to share across companies."),
	],
	["Office Stationery Supply", "4820.9000", "Numbers, pieces, units", "18%", 18, "Goods at standard rate (default)", 0, ""],
	[
		"* required.  Already set up: " + ", ".join(t["name"] for t in REF["tax_items"]),
		"Only 22 of 7,803 HS Codes currently carry an FBR UOM. If yours has none I will fetch it from FBR when building the invoice.",
	],
	rows_to_fill=10,
)
dv(items, UOM_RANGE, "C6:C20", "FBR UOM", "Pick an FBR unit of measure.")
dv(items, SALETYPE_RANGE, "F6:F20", "Sale Type", "Must match the scenario on the Invoice tab.")

# ------------------------------------------------------------------ 4 Invoice
inv = wb.create_sheet("4. Invoice")
title(inv, "Invoice", "Header first, then one row per line.", 9)
widths(inv, {"A": 26, "B": 34, "C": 14, "D": 58})

inv["A4"] = "Header"
inv["A4"].font = Font(name=FONT, bold=True, size=12)

header_rows = [
	("Seller / Company *", "SHEIKH MAHBOOB & CO.", "Which of your companies is issuing this."),
	("Buyer *", "AHMAD TRADERS", "Must exist on the Buyer tab or already in the system."),
	("Invoice Date *", "2026-08-12", "YYYY-MM-DD."),
	("Scenario *", "SN001", "Sandbox only. Must match the sale type of every line."),
	("Environment *", "Sandbox", "Sandbox until you are ready. Production files for real."),
]
r = 5
for label, example, note in header_rows:
	inv.cell(row=r, column=1, value=label).font = Font(name=FONT, bold=True, size=10)
	cell = inv.cell(row=r, column=2, value=example)
	cell.font = Font(name=FONT, size=10, italic=True, color="888888")
	cell.fill = FILL_IN
	cell.border = BOX
	inv.cell(row=r, column=4, value=note).font = Font(name=FONT, size=9, italic=True, color="666666")
	r += 1

dv(inv, SCENARIO_RANGE, "B8", "Scenario", "One of the ten assigned to this account.")
dv(inv, ["Sandbox", "Production"], "B9", "Environment", "Sandbox is safe; Production files with FBR for real.")

line_header_row = r + 2
inv.cell(row=line_header_row - 1, column=1, value="Lines").font = Font(name=FONT, bold=True, size=12)

line_cols = [
	("Item Name *", 32),
	("Quantity *", 12),
	("Sale Rate *", 14),
	("Discount", 12),
	("SRO Schedule No", 30),
	("SRO Item Serial", 16),
	("Further Tax", 12),
	("Extra Tax", 12),
	("FED Payable", 12),
]
for i, (label, width) in enumerate(line_cols, start=1):
	inv.cell(row=line_header_row, column=i, value=label)
	inv.column_dimensions[get_column_letter(i)].width = width
style_header(inv, line_header_row, len(line_cols))

example_line = ["Office Stationery Supply", 1, 1000, 0, "", "", 0, 0, 0]
for i, value in enumerate(example_line, start=1):
	cell = inv.cell(row=line_header_row + 1, column=i, value=value)
	cell.font = Font(name=FONT, size=10, italic=True, color="888888")
	cell.border = BOX

for row in range(line_header_row + 2, line_header_row + 12):
	for col in range(1, len(line_cols) + 1):
		cell = inv.cell(row=row, column=col)
		cell.fill = FILL_IN
		cell.border = BOX
		cell.font = Font(name=FONT, size=10)

note_row = line_header_row + 13
for note in [
	"* required. Leave SRO Schedule and SRO Item Serial blank when the rate is 18% — FBR only wants them below or above that.",
	"When the rate is not 18% and you do not know the SRO values, leave them blank and say so; I will ask FBR which are valid for that rate.",
	"Totals are not entered here. They are computed from quantity, rate, discount and the item's tax rate, the same way FBR checks them.",
]:
	cell = inv.cell(row=note_row, column=1, value=note)
	cell.font = Font(name=FONT, size=9, italic=True, color="666666")
	inv.merge_cells(start_row=note_row, start_column=1, end_row=note_row, end_column=9)
	note_row += 1

for ws in wb.worksheets:
	ws.sheet_view.showGridLines = False
	ws.freeze_panes = "A5"

order = ["Start here", "1. Seller", "2. Buyer", "3. Items", "4. Invoice", "5. Lists"]
wb._sheets = [wb[name] for name in order]

OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)
print("wrote", OUT.resolve())
