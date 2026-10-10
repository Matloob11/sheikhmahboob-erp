"""Read-only Digital Invoicing demo login (fake data only)."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, get_url, nowdate, today
from frappe.utils.password import update_password as _update_password

DEMO_EMAIL = "demo@sheikhmahboob.com"
DEMO_SELLER = "DEMO TRADERS"
DEMO_ROLE = "DI Demo Viewer"
DEMO_FULL_NAME = "Digital Invoicing Demo"
SETTINGS_DOCTYPE = "DI Demo Settings"

# DocTypes the demo user may open (read / print / export / report only).
DEMO_READ_DOCTYPES = (
	"Seller Or Company",
	"Buyer",
	"Tax Item",
	"Sale Tax Invoice",
	"HS Code",
	"HS Uom",
	"Scenario",
	"Sandbox Scenario",
	"Transaction Type",
	"SRO Schedule",
	"SRO Item",
	"Company",
	"Customer",
	"Item",
	"Sales Invoice",
	"Purchase Invoice",
	"Warehouse",
	"Account",
)


def is_demo_viewer(user: str | None = None) -> bool:
	user = user or frappe.session.user
	if user in ("Administrator", "Guest"):
		return False
	roles = set(frappe.get_roles(user))
	if "System Manager" in roles:
		return False
	return DEMO_ROLE in roles


def ensure_demo_role() -> None:
	if not frappe.db.exists("Role", DEMO_ROLE):
		frappe.get_doc(
			{
				"doctype": "Role",
				"role_name": DEMO_ROLE,
				"desk_access": 1,
				"home_page": "/desk/digital-invoicing",
			}
		).insert(ignore_permissions=True)
	else:
		role = frappe.get_doc("Role", DEMO_ROLE)
		if not role.desk_access or role.home_page != "/desk/digital-invoicing":
			role.desk_access = 1
			role.home_page = "/desk/digital-invoicing"
			role.save(ignore_permissions=True)

	for doctype in DEMO_READ_DOCTYPES:
		if not frappe.db.exists("DocType", doctype):
			continue
		_ensure_read_perm(doctype)


def _ensure_read_perm(doctype: str) -> None:
	"""Grant demo read via Custom DocPerm without wiping other roles' DocPerm.

	Entering Custom DocPerm mode makes Frappe ignore DocPerm for that DocType.
	Always copy every DocPerm row first (setup_custom_perms / gap fill), then
	upsert the demo role — otherwise Client Panel users lose Sale Invoices,
	HS Codes, Buyers, Items, etc.
	"""
	from frappe.permissions import setup_custom_perms

	from di.panel import fill_custom_docperm_gaps_from_docperm, upsert_custom_docperm

	if not frappe.db.exists("Custom DocPerm", {"parent": doctype}):
		setup_custom_perms(doctype)
	else:
		fill_custom_docperm_gaps_from_docperm(doctype)

	values = {
		"read": 1,
		"write": 0,
		"create": 0,
		"delete": 0,
		"submit": 0,
		"cancel": 0,
		"amend": 0,
		"report": 1,
		"export": 1,
		"print": 1,
		"email": 1,
		"share": 0,
		"import": 0,
		"select": 1,
	}
	upsert_custom_docperm(doctype, DEMO_ROLE, values)


def ensure_demo_settings() -> "frappe.model.document.Document":
	ensure_demo_role()
	if not frappe.db.exists("DocType", SETTINGS_DOCTYPE):
		frappe.throw(_("DI Demo Settings is missing. Migrate the di app first."))
	if frappe.db.exists(SETTINGS_DOCTYPE, SETTINGS_DOCTYPE):
		return frappe.get_doc(SETTINGS_DOCTYPE, SETTINGS_DOCTYPE)
	doc = frappe.get_doc({"doctype": SETTINGS_DOCTYPE})
	doc.insert(ignore_permissions=True)
	return doc


def provision_demo_account(
	*,
	initial_password: str,
	rotated_password: str,
	rotate_after_days: int = 10,
	sample_data: bool = True,
) -> dict:
	"""Create the demo seller, sample rows, read-only user, and rotation schedule."""
	ensure_demo_role()
	_ensure_demo_seller()
	_ensure_demo_company()
	if sample_data:
		_seed_sample_data()

	settings = ensure_demo_settings()
	settings.demo_user = DEMO_EMAIL
	settings.demo_seller = DEMO_SELLER
	settings.rotate_on = add_days(today(), rotate_after_days)
	settings.password_rotated = 0
	settings.next_password = rotated_password
	settings.login_url = get_url("/login")
	settings.flags.ignore_permissions = True
	settings.save()

	_provision_demo_user(initial_password)
	_ensure_user_permissions()

	return {
		"email": DEMO_EMAIL,
		"seller": DEMO_SELLER,
		"login_url": settings.login_url,
		"rotate_on": cstr(settings.rotate_on),
		"password_rotated": 0,
	}


def _ensure_demo_seller() -> None:
	if frappe.db.exists("Seller Or Company", DEMO_SELLER):
		return
	frappe.get_doc(
		{
			"doctype": "Seller Or Company",
			"seller__business_name": DEMO_SELLER,
			"seller_ntncnic": "1234567",
			"seller_province": "PUNJAB",
			"seller_address": "Demo Street, Lahore (sample data only)",
		}
	).insert(ignore_permissions=True)


def _ensure_demo_company() -> None:
	if not frappe.db.exists("DocType", "Company"):
		return
	if frappe.db.exists("Company", DEMO_SELLER):
		return
	# Prefer cloning chart from an existing company so ERPNext pages open cleanly.
	abbr_source = frappe.db.get_value("Company", {}, "name")
	try:
		frappe.get_doc(
			{
				"doctype": "Company",
				"company_name": DEMO_SELLER,
				"abbr": "DEMO",
				"default_currency": "PKR",
				"country": "Pakistan",
				"create_chart_of_accounts_based_on": "Existing Company" if abbr_source else "",
				"existing_company": abbr_source or "",
			}
		).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Demo Company create")


def _seed_sample_data() -> None:
	from di.seed_data import seed_fbr_scenarios

	seed_fbr_scenarios()
	_ensure_hs("4820.9000", "Numbers, pieces, units")

	buyers = [
		("Demo Retail Store", "Registered", "7654321"),
		("Walk-in Customer (Demo)", "Unregistered", "3520200000001"),
	]
	for name, kind, ntn in buyers:
		if frappe.db.exists("Buyer", name):
			continue
		frappe.get_doc(
			{
				"doctype": "Buyer",
				"buyer_businessname": name,
				"buyer_registration_type": kind,
				"buyer_ntncnic": ntn,
				"buyer_province": "PUNJAB",
				"buyer_address": "Demo address, Lahore",
				"seller": DEMO_SELLER,
			}
		).insert(ignore_permissions=True)

	items = [
		("Demo Note Books", "Exempt", 0, "Exempt goods"),
		("Demo Exercise Books", "18%", 18, "Goods at standard rate (default)"),
		("Demo Pens Pack", "18%", 18, "Goods at standard rate (default)"),
	]
	for name, tax_desc, rate, sale_type in items:
		if frappe.db.exists("Tax Item", name):
			continue
		frappe.get_doc(
			{
				"doctype": "Tax Item",
				"product_description": name,
				"seller": DEMO_SELLER,
				"hs_code": "4820.9000",
				"product_uom": "Numbers, pieces, units",
				"tax_desc": tax_desc,
				"rate_in_p": rate,
				"transaction_type": sale_type if frappe.db.exists("Transaction Type", sale_type) else "",
			}
		).insert(ignore_permissions=True)

	samples = [
		{
			"buyer": "Demo Retail Store",
			"item": "Demo Exercise Books",
			"sale_type": "Goods at standard rate (default)",
			"scenario": "SN001",
			"rate": 1000,
			"fbr": "DEMO-SN001-SAMPLE-001",
		},
		{
			"buyer": "Walk-in Customer (Demo)",
			"item": "Demo Exercise Books",
			"sale_type": "Goods at standard rate (default)",
			"scenario": "SN002",
			"rate": 500,
			"fbr": "DEMO-SN002-SAMPLE-002",
		},
		{
			"buyer": "Walk-in Customer (Demo)",
			"item": "Demo Note Books",
			"sale_type": "Exempt goods",
			"scenario": "SN006",
			"rate": 200,
			"fbr": "DEMO-SN006-SAMPLE-003",
			"sro": "6th Schd Table I",
			"serial": "100",
		},
	]
	for row in samples:
		exists = frappe.db.exists(
			"Sale Tax Invoice",
			{"seller__business_name": DEMO_SELLER, "fbr_invoice_no": row["fbr"]},
		)
		if exists:
			continue
		sro = row.get("sro") or ""
		if sro and not frappe.db.exists("SRO Schedule", sro):
			frappe.get_doc({"doctype": "SRO Schedule", "sro_desc": sro}).insert(ignore_permissions=True)
		doc = frappe.get_doc(
			{
				"doctype": "Sale Tax Invoice",
				"invoice_type": "Sale Invoice",
				"invoice_date": nowdate(),
				"scenario_id": row["scenario"],
				"fbr_environment": "Sandbox",
				"buyer": row["buyer"],
				"seller__business_name": DEMO_SELLER,
				"fbr_invoice_no": row["fbr"],
				"sandbox_run_status": "Already Successful",
				"invoice_items": [
					{
						"description": row["item"],
						"quantity": 1,
						"sale_rate": row["rate"],
						"sale_type": row["sale_type"],
						"sro_schedule_no": sro,
						"sro_item_serial_no": row.get("serial") or "",
					}
				],
			}
		)
		doc.insert(ignore_permissions=True)
		# Number already set so before_submit does not call FBR.
		doc.submit()


def _ensure_hs(hs_code: str, uom: str) -> None:
	if frappe.db.exists("HS Code", hs_code):
		return
	frappe.get_doc(
		{
			"doctype": "HS Code",
			"hs_code": hs_code,
			"description": "Demo stationery",
			"uom": uom if frappe.db.exists("HS Uom", uom) else "",
		}
	).insert(ignore_permissions=True)


def _provision_demo_user(password: str) -> None:
	if frappe.db.exists("User", DEMO_EMAIL):
		user = frappe.get_doc("User", DEMO_EMAIL)
		user.enabled = 1
		user.first_name = DEMO_FULL_NAME
		user.user_type = "System User"
		user.send_welcome_email = 0
		if frappe.db.exists("Workspace", "Digital Invoicing"):
			user.default_workspace = "Digital Invoicing"
		# Show DI + ERPNext modules (do not block).
		user.set("block_modules", [])
		user.flags.ignore_permissions = True
		user.flags.ignore_password_policy = True
		user.save()
	else:
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": DEMO_EMAIL,
				"first_name": DEMO_FULL_NAME,
				"enabled": 1,
				"send_welcome_email": 0,
				"user_type": "System User",
				"new_password": password,
			}
		)
		if frappe.db.exists("Workspace", "Digital Invoicing"):
			user.default_workspace = "Digital Invoicing"
		user.flags.ignore_permissions = True
		user.flags.ignore_password_policy = True
		user.flags.no_welcome_mail = True
		user.insert()

	# Read-only demo role only — never System Manager / DI Panel User (those can write).
	wanted = {DEMO_ROLE}
	for role in list(frappe.get_roles(DEMO_EMAIL)):
		if role not in wanted and role not in ("All", "Guest", "Desk User"):
			user.remove_roles(role)
	user.add_roles(DEMO_ROLE)
	user.set("block_modules", [])
	user.flags.ignore_permissions = True
	user.save()
	_update_password(DEMO_EMAIL, password, logout_all_sessions=1)


def _ensure_user_permissions() -> None:
	_ensure_up(DEMO_EMAIL, "Seller Or Company", DEMO_SELLER)
	if frappe.db.exists("Company", DEMO_SELLER):
		_ensure_up(DEMO_EMAIL, "Company", DEMO_SELLER)


def _ensure_up(user: str, allow: str, for_value: str) -> None:
	if frappe.db.exists(
		"User Permission",
		{"user": user, "allow": allow, "for_value": for_value},
	):
		return
	frappe.get_doc(
		{
			"doctype": "User Permission",
			"user": user,
			"allow": allow,
			"for_value": for_value,
			"apply_to_all_doctypes": 1 if allow == "Company" else 0,
			"applicable_for": "" if allow == "Company" else allow,
		}
	).insert(ignore_permissions=True)


def rotate_demo_password_if_due() -> dict:
	"""Daily job: after rotate_on, set the scheduled password once."""
	if not frappe.db.exists("DocType", SETTINGS_DOCTYPE):
		return {"ok": 0, "reason": "no settings"}
	if not frappe.db.exists(SETTINGS_DOCTYPE, SETTINGS_DOCTYPE):
		return {"ok": 0, "reason": "not provisioned"}

	settings = frappe.get_doc(SETTINGS_DOCTYPE, SETTINGS_DOCTYPE)
	if cint(settings.password_rotated):
		return {"ok": 1, "reason": "already rotated"}
	if not settings.rotate_on or cstr(settings.rotate_on) > today():
		return {"ok": 1, "reason": "not due", "rotate_on": cstr(settings.rotate_on)}

	password = cstr(settings.get_password("next_password", raise_exception=False) or "").strip()
	user = cstr(settings.demo_user or DEMO_EMAIL)
	if not password or not frappe.db.exists("User", user):
		return {"ok": 0, "reason": "missing password or user"}

	_update_password(user, password, logout_all_sessions=1)
	settings.db_set("password_rotated", 1)
	frappe.db.commit()
	return {"ok": 1, "reason": "rotated", "user": user}


def _smc_logo_src() -> str:
	"""Black-and-white SMC seal as a public PNG URL (wkhtmltopdf blocks local files)."""
	import subprocess
	from pathlib import Path

	src = Path(__file__).resolve().parent / "public" / "images" / "smc-logo.svg"
	if not src.exists():
		return ""

	bw_svg = Path("/tmp/smc-logo-bw.svg")
	svg = src.read_text(encoding="utf-8")
	svg = svg.replace("#868a4a", "#111111").replace("#868A4A", "#111111")
	bw_svg.write_text(svg, encoding="utf-8")

	site_path = Path(frappe.get_site_path("public", "files", "smc-logo-bw.png"))
	site_path.parent.mkdir(parents=True, exist_ok=True)
	try:
		subprocess.run(
			["rsvg-convert", "-w", "240", "-h", "240", "-o", str(site_path), str(bw_svg)],
			check=True,
			capture_output=True,
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Demo PDF logo convert")
		return ""

	return "https://sheikhmahboob.com/files/smc-logo-bw.png"


def build_demo_welcome_html(
	initial_password: str,
	rotate_on: str = "",
	rotated_password: str = "",
	*,
	valid_from: str = "",
	valid_until: str = "",
) -> str:
	"""Professional B&W demo credentials letter. Rotated password is never printed."""
	from frappe.utils import formatdate

	login_url = get_url("/login")
	if login_url.startswith("http://"):
		login_url = "https://" + login_url[len("http://") :]

	issued = valid_from or today()
	expires = valid_until or rotate_on or cstr(add_days(today(), 10))
	try:
		issued_label = formatdate(issued, "dd MMM yyyy")
	except Exception:
		issued_label = cstr(issued)
	try:
		expires_label = formatdate(expires, "dd MMM yyyy")
	except Exception:
		expires_label = cstr(expires)

	logo = _smc_logo_src()
	logo_html = (
		f'<img class="seal" src="{logo}" alt="Sheikh Mahboob &amp; Co." />' if logo else ""
	)

	return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Demo Access — Sheikh Mahboob &amp; Co.</title>
<style>
@page {{ size: A4; margin: 18mm 16mm; }}
* {{ box-sizing: border-box; }}
body {{
	margin: 0;
	color: #111;
	font-family: "Times New Roman", Times, serif;
	font-size: 12.5px;
	line-height: 1.45;
	background: #fff;
}}
.sheet {{
	border: 1.5px solid #111;
	padding: 22px 26px 18px;
	min-height: 240mm;
}}
.letterhead {{
	text-align: center;
	border-bottom: 2px solid #111;
	padding-bottom: 14px;
	margin-bottom: 18px;
}}
.seal {{
	width: 78px;
	height: 78px;
	display: block;
	margin: 0 auto 8px;
}}
.firm {{
	font-size: 20px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	margin: 0;
}}
.firm-sub {{
	font-size: 11px;
	margin: 4px 0 0;
	letter-spacing: 0.08em;
	text-transform: uppercase;
}}
.doc-title {{
	text-align: center;
	font-size: 15px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	margin: 0 0 6px;
}}
.doc-ref {{
	text-align: center;
	font-size: 11px;
	margin: 0 0 16px;
	color: #333;
}}
.intro {{
	margin: 0 0 14px;
	text-align: justify;
}}
table.creds {{
	width: 100%;
	border-collapse: collapse;
	margin: 10px 0 16px;
}}
table.creds th,
table.creds td {{
	border: 1px solid #111;
	padding: 9px 11px;
	text-align: left;
	vertical-align: top;
}}
table.creds th {{
	width: 32%;
	font-weight: 700;
	background: #f2f2f2;
}}
.mono {{
	font-family: Consolas, "Courier New", monospace;
	font-size: 12px;
}}
.terms {{
	font-size: 11px;
	margin: 0 0 22px;
}}
.terms li {{ margin-bottom: 4px; }}
.validity {{
	border: 1px solid #111;
	padding: 10px 12px;
	margin: 0 0 28px;
	font-size: 12px;
}}
.validity strong {{ letter-spacing: 0.04em; }}
.sign-block {{
	margin-top: 36px;
	width: 46%;
}}
.sign-line {{
	border-bottom: 1px solid #111;
	height: 36px;
	margin-bottom: 6px;
}}
.sign-name {{
	font-family: "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive;
	font-size: 26px;
	line-height: 1;
	margin: 0 0 4px;
}}
.sign-title {{
	font-size: 11px;
	margin: 0;
}}
.footer {{
	margin-top: 40px;
	border-top: 1px solid #111;
	padding-top: 8px;
	font-size: 10px;
	text-align: center;
	color: #333;
}}
</style></head><body>
<div class="sheet">
	<div class="letterhead">
		{logo_html}
		<p class="firm">Sheikh Mahboob &amp; Co.</p>
		<p class="firm-sub">Tax · Corporate · Digital Invoicing — Lahore</p>
	</div>

	<p class="doc-title">Demo Access Credentials</p>
	<p class="doc-ref">Digital Invoicing Software — Read-Only Demonstration Account</p>

	<p class="intro">
		This letter issues temporary demonstration access to the Digital Invoicing
		desk at Sheikh Mahboob &amp; Co. The login below is for evaluation of
		features only. It uses sample (demo) data and does not expose live client
		records.
	</p>

	<table class="creds">
		<tr><th>Login URL</th><td class="mono">{login_url}</td></tr>
		<tr><th>Email / Username</th><td class="mono">{DEMO_EMAIL}</td></tr>
		<tr><th>Password</th><td class="mono">{initial_password}</td></tr>
		<tr><th>Demo company</th><td>{DEMO_SELLER}</td></tr>
		<tr><th>Access level</th><td>Read only — cannot add, edit, delete, or submit</td></tr>
	</table>

	<div class="validity">
		<strong>Validity:</strong>
		Issued {issued_label} &nbsp;|&nbsp; Valid until {expires_label}
		<br/>Access may be withdrawn earlier without notice.
	</div>

	<ol class="terms">
		<li>Credentials are confidential. Do not share outside the intended recipient.</li>
		<li>This account is read-only and limited to the demo company named above.</li>
		<li>Live taxpayer data, tokens, and production filings are not available on this login.</li>
	</ol>

	<div class="sign-block">
		<p class="sign-name">Sheikh Mahboob</p>
		<div class="sign-line"></div>
		<p class="sign-title"><strong>Sheikh Mahboob</strong><br/>Proprietor / Tax Consultant<br/>Sheikh Mahboob &amp; Co., Lahore</p>
	</div>

	<div class="footer">
		Confidential — for authorised demonstration use only · sheikhmahboob.com
	</div>
</div>
</body></html>"""
