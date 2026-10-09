"""Client Panel: provision a desk user who only sees their own sellers."""

from __future__ import annotations

import secrets
import string

import frappe
from frappe import _
from frappe.utils import cstr, get_url
from frappe.utils.password import update_password as _update_password

PANEL_ROLE = "DI Panel User"
SELLER_DOCTYPE = "Seller Or Company"
ALLOWED_MODULES = {"Digital Invoicing", "Core", "Desk", "Workflow"}
PROTECTED_USERS = {"Administrator", "Guest"}

# Rights DI Panel User must keep when a DocType is in Custom DocPerm mode.
# Demo / Role Permission Manager Custom DocPerm rows otherwise hide JSON DocPerm.
PANEL_WRITE_DOCTYPES = {
	"Sale Tax Invoice": {
		"read": 1,
		"write": 1,
		"create": 1,
		"delete": 0,
		"submit": 1,
		"cancel": 0,
		"amend": 0,
		"report": 1,
		"export": 1,
		"import": 0,
		"print": 1,
		"email": 1,
		"share": 0,
		"select": 1,
	},
	"Buyer": {
		"read": 1,
		"write": 1,
		"create": 1,
		"delete": 1,
		"submit": 0,
		"cancel": 0,
		"amend": 0,
		"report": 1,
		"export": 1,
		"import": 0,
		"print": 1,
		"email": 1,
		"share": 0,
		"select": 1,
	},
	"Tax Item": {
		"read": 1,
		"write": 1,
		"create": 1,
		"delete": 1,
		"submit": 0,
		"cancel": 0,
		"amend": 0,
		"report": 1,
		"export": 1,
		"import": 0,
		"print": 1,
		"email": 1,
		"share": 0,
		"select": 1,
	},
	"Seller Or Company": {
		"read": 1,
		"write": 1,
		"create": 1,
		"delete": 0,
		"submit": 0,
		"cancel": 0,
		"amend": 0,
		"report": 1,
		"export": 1,
		"import": 0,
		"print": 1,
		"email": 1,
		"share": 0,
		"select": 1,
	},
}

PANEL_READ_DOCTYPES = (
	"HS Code",
	"HS Uom",
	"Province",
	"Sale Type",
	"Transaction Type",
	"Scenario",
	"Sandbox Scenario",
	"SRO Schedule",
	"SRO Item",
	"DI Error Code",
)

PANEL_READ_RIGHTS = {
	"read": 1,
	"write": 0,
	"create": 0,
	"delete": 0,
	"submit": 0,
	"cancel": 0,
	"amend": 0,
	"report": 1,
	"export": 1,
	"import": 0,
	"print": 1,
	"email": 1,
	"share": 0,
	"select": 1,
}

_PERM_COPY_FIELDS = (
	"read",
	"write",
	"create",
	"delete",
	"submit",
	"cancel",
	"amend",
	"report",
	"export",
	"import",
	"print",
	"email",
	"share",
	"select",
	"if_owner",
)


def generate_panel_password(length: int = 12) -> str:
	"""Readable password with upper, lower, and a digit. No symbols (PDF / SMS)."""
	length = max(length, 10)
	alphabet = string.ascii_letters + string.digits
	while True:
		chars = [
			secrets.choice(string.ascii_lowercase),
			secrets.choice(string.ascii_uppercase),
			secrets.choice(string.digits),
		]
		chars.extend(secrets.choice(alphabet) for _ in range(length - 3))
		secrets.SystemRandom().shuffle(chars)
		password = "".join(chars)
		if any(c.islower() for c in password) and any(c.isupper() for c in password) and any(c.isdigit() for c in password):
			return password


def single_client_assignment_ok(seller_names: list[str]) -> bool:
	return len([name for name in seller_names if name]) <= 1


def get_login_url() -> str:
	return get_url("/login")


def ensure_di_panel_role() -> None:
	if frappe.db.exists("Role", PANEL_ROLE):
		role = frappe.get_doc("Role", PANEL_ROLE)
		changed = False
		if not role.desk_access:
			role.desk_access = 1
			changed = True
		if role.home_page != "/desk/digital-invoicing":
			role.home_page = "/desk/digital-invoicing"
			changed = True
		if changed:
			role.save(ignore_permissions=True)
		return

	frappe.get_doc(
		{
			"doctype": "Role",
			"role_name": PANEL_ROLE,
			"desk_access": 1,
			"home_page": "/desk/digital-invoicing",
		}
	).insert(ignore_permissions=True)


def is_panel_user(user: str | None = None) -> bool:
	user = user or frappe.session.user
	if user in PROTECTED_USERS:
		return False
	roles = set(frappe.get_roles(user))
	if "System Manager" in roles:
		return False
	return PANEL_ROLE in roles


def is_scoped_seller_user(user: str | None = None) -> bool:
	"""Client panel users and the read-only demo viewer both see only their sellers."""
	from di.demo import is_demo_viewer

	return is_panel_user(user) or is_demo_viewer(user)


def get_allowed_sellers(user: str | None = None) -> list[str]:
	"""Client Panel assignment is the source of truth. User Permission is a fallback
	for sellers the client created themselves after login.

	The demo viewer is locked to DEMO TRADERS via User Permission only.
	"""
	from di.demo import DEMO_SELLER, is_demo_viewer

	user = user or frappe.session.user
	if is_demo_viewer(user):
		permitted = frappe.get_all(
			"User Permission",
			filters={"user": user, "allow": SELLER_DOCTYPE},
			pluck="for_value",
		)
		return [name for name in permitted if name] or [DEMO_SELLER]

	assigned = frappe.get_all(
		"Client Panel Seller",
		filters={"parent": user, "parenttype": "Client Panel"},
		pluck="seller",
	)
	permitted = frappe.get_all(
		"User Permission",
		filters={"user": user, "allow": SELLER_DOCTYPE},
		pluck="for_value",
	)
	seen = []
	for name in list(assigned or []) + list(permitted or []):
		if name and name not in seen:
			seen.append(name)
	return seen


def get_client_panel_name(user: str | None = None) -> str | None:
	user = user or frappe.session.user
	return frappe.db.get_value("Client Panel", {"email": user}, "name")


def apply_default_seller(doc, fieldname: str) -> None:
	if not is_panel_user():
		return
	if doc.get(fieldname):
		return
	allowed = get_allowed_sellers()
	if len(allowed) == 1:
		doc.set(fieldname, allowed[0])


def apply_default_seller_on_buyer(doc, method=None) -> None:
	apply_default_seller(doc, "seller")


def apply_default_seller_on_tax_item(doc, method=None) -> None:
	apply_default_seller(doc, "seller")


def apply_default_seller_on_invoice(doc, method=None) -> None:
	apply_default_seller(doc, "seller__business_name")


def _seller_value(doc) -> str | None:
	if getattr(doc, "doctype", None) == SELLER_DOCTYPE:
		return doc.name
	return doc.get("seller") or doc.get("seller__business_name")


def _permission_query(doctype: str, fieldname: str, user: str | None = None) -> str | None:
	if not is_scoped_seller_user(user):
		return None
	allowed = get_allowed_sellers(user)
	if not allowed:
		return "1=0"
	escaped = ", ".join(frappe.db.escape(name) for name in allowed)
	return f"`tab{doctype}`.`{fieldname}` in ({escaped})"


def get_seller_permission_query(user: str | None = None) -> str | None:
	if not is_scoped_seller_user(user):
		return None
	allowed = get_allowed_sellers(user)
	if not allowed:
		return "1=0"
	escaped = ", ".join(frappe.db.escape(name) for name in allowed)
	return f"`tab{SELLER_DOCTYPE}`.name in ({escaped})"


def get_buyer_permission_query(user: str | None = None) -> str | None:
	from di.demo import is_demo_viewer

	if not is_scoped_seller_user(user):
		return None
	allowed = get_allowed_sellers(user)
	if not allowed:
		return "1=0"
	escaped = ", ".join(frappe.db.escape(name) for name in allowed)
	# Demo must not see shared walk-in buyers that belong to every real client.
	if is_demo_viewer(user):
		return f"`tabBuyer`.`seller` in ({escaped})"
	return (
		f"(`tabBuyer`.`seller` in ({escaped})"
		" or (ifnull(`tabBuyer`.`seller`,'')=''"
		" and `tabBuyer`.`buyer_registration_type`='Unregistered'))"
	)


def get_tax_item_permission_query(user: str | None = None) -> str | None:
	return _permission_query("Tax Item", "seller", user)


def get_invoice_permission_query(user: str | None = None) -> str | None:
	return _permission_query("Sale Tax Invoice", "seller__business_name", user)


def has_seller_scoped_permission(doc, ptype: str | None = None, user: str | None = None) -> bool:
	from di.demo import is_demo_viewer

	user = user or frappe.session.user
	if is_demo_viewer(user):
		# Read-only: never create / write / delete / submit under this login.
		if ptype not in (None, "read", "print", "email", "export", "report", "share"):
			return False
		seller = _seller_value(doc)
		allowed = set(get_allowed_sellers(user))
		if seller and seller in allowed:
			return True
		return False

	if not is_panel_user(user):
		return True

	allowed = set(get_allowed_sellers(user))
	seller = _seller_value(doc)
	is_new = callable(getattr(doc, "is_new", None)) and doc.is_new()

	# New Seller Or Company: panel user may create their own company before the
	# Client Panel Seller row exists (assignment is written after insert).
	if getattr(doc, "doctype", None) == SELLER_DOCTYPE and is_new:
		return True

	# Shared walk-in Unregistered Buyer (no seller): readable, not writable.
	if getattr(doc, "doctype", None) == "Buyer" and not seller:
		if cstr(doc.get("buyer_registration_type")) != "Unregistered":
			return False
		return ptype in (None, "read", "print", "email", "export", "report", "select")

	if ptype == "create":
		# Blank seller is filled in before_validate; a named foreign seller is not.
		return (not seller) or (seller in allowed)

	if seller and seller in allowed:
		# Re-pointing a saved draft to another seller must not slip through: the
		# hook sees the in-memory value, so also require the stored seller.
		if (
			ptype in ("write", "delete", "submit", "cancel")
			and not is_new
			and getattr(doc, "name", None)
			and getattr(doc, "doctype", None)
		):
			stored = _stored_seller(doc)
			if stored and stored not in allowed:
				return False
		return True
	return False


def _stored_seller(doc) -> str | None:
	"""Seller currently on disk for a named document (ignores in-memory edits)."""
	doctype = getattr(doc, "doctype", None)
	name = getattr(doc, "name", None)
	if not doctype or not name:
		return None
	if doctype == SELLER_DOCTYPE:
		return name
	field = "seller__business_name" if doctype == "Sale Tax Invoice" else "seller"
	return frappe.db.get_value(doctype, name, field)


def ensure_user_permission(user: str, seller: str) -> None:
	if not user or not seller:
		return
	name = frappe.db.get_value(
		"User Permission",
		{"user": user, "allow": SELLER_DOCTYPE, "for_value": seller},
		"name",
	)
	if name:
		doc = frappe.get_doc("User Permission", name)
		if doc.apply_to_all_doctypes or cstr(doc.applicable_for) != SELLER_DOCTYPE:
			doc.apply_to_all_doctypes = 0
			doc.applicable_for = SELLER_DOCTYPE
			doc.save(ignore_permissions=True)
		return
	frappe.get_doc(
		{
			"doctype": "User Permission",
			"user": user,
			"allow": SELLER_DOCTYPE,
			"for_value": seller,
			"apply_to_all_doctypes": 0,
			"applicable_for": SELLER_DOCTYPE,
		}
	).insert(ignore_permissions=True)


def remove_user_permission(user: str, seller: str) -> None:
	for name in frappe.get_all(
		"User Permission",
		filters={"user": user, "allow": SELLER_DOCTYPE, "for_value": seller},
		pluck="name",
	):
		frappe.delete_doc("User Permission", name, ignore_permissions=True, force=True)


def sync_assigned_seller_permissions(user: str, previous: set[str], current: set[str]) -> None:
	for seller in current:
		ensure_user_permission(user, seller)
		provision_assigned_seller(seller)
	for seller in previous - current:
		remove_user_permission(user, seller)


def provision_assigned_seller(seller: str) -> None:
	"""Copy admin API keys onto the seller and make sure an unregistered buyer exists."""
	if not seller or not frappe.db.exists(SELLER_DOCTYPE, seller):
		return
	_copy_di_settings_tokens(seller)
	_ensure_unregistered_buyer(seller)


def _copy_di_settings_tokens(seller: str) -> None:
	settings_name = frappe.db.get_value("DI Settings", {"company": seller}, "name")
	if not settings_name:
		return
	settings = frappe.get_doc("DI Settings", settings_name)
	token = cstr(settings.get_password("access_token", raise_exception=False) or "").strip()
	if not token:
		return
	doc = frappe.get_doc(SELLER_DOCTYPE, seller)
	field = "production_token" if cstr(settings.sync_mode) == "Production" else "sandbox_token"
	if cstr(doc.get_password(field, raise_exception=False) or "").strip():
		return
	doc.set(field, token)
	doc.save(ignore_permissions=True)


def _ensure_unregistered_buyer(seller: str) -> str:
	found = frappe.db.get_value(
		"Buyer",
		{"seller": seller, "buyer_registration_type": "Unregistered"},
		"name",
	)
	if found:
		return found
	label = f"Unregistered Buyer ({seller})"[:140]
	if frappe.db.exists("Buyer", label):
		doc = frappe.get_doc("Buyer", label)
		if not doc.seller:
			doc.seller = seller
			doc.save(ignore_permissions=True)
		return label
	province = cstr(frappe.db.get_value(SELLER_DOCTYPE, seller, "seller_province") or "PUNJAB")
	address = cstr(frappe.db.get_value(SELLER_DOCTYPE, seller, "seller_address") or "Pakistan")
	frappe.get_doc(
		{
			"doctype": "Buyer",
			"seller": seller,
			"buyer_businessname": label,
			"buyer_registration_type": "Unregistered",
			"buyer_ntncnic": "3520298765431",
			"buyer_province": province,
			"buyer_address": address,
		}
	).insert(ignore_permissions=True)
	return label


def _doctype_has_custom_perms(doctype: str) -> bool:
	return bool(frappe.db.exists("Custom DocPerm", {"parent": doctype}))


def fill_custom_docperm_gaps_from_docperm(doctype: str) -> int:
	"""When Custom DocPerm is active, copy any DocPerm roles that are missing.

	Frappe ignores DocPerm entirely once a DocType has any Custom DocPerm row.
	Demo / Role Permission Manager often leave only one role in Custom DocPerm,
	which hides DI Panel User and All from the sidebar.
	"""
	if not _doctype_has_custom_perms(doctype):
		return 0
	existing = {
		(row.role, int(row.permlevel or 0))
		for row in frappe.get_all(
			"Custom DocPerm",
			filters={"parent": doctype},
			fields=["role", "permlevel"],
		)
	}
	added = 0
	for row in frappe.get_all("DocPerm", filters={"parent": doctype}, fields=["*"]):
		key = (row.role, int(row.permlevel or 0))
		if key in existing:
			continue
		values = {field: int(row.get(field) or 0) for field in _PERM_COPY_FIELDS}
		frappe.get_doc(
			{
				"doctype": "Custom DocPerm",
				"parent": doctype,
				"parenttype": "DocType",
				"parentfield": "permissions",
				"role": row.role,
				"permlevel": int(row.permlevel or 0),
				**values,
			}
		).insert(ignore_permissions=True)
		existing.add(key)
		added += 1
	return added


def upsert_custom_docperm(doctype: str, role: str, values: dict, permlevel: int = 0) -> None:
	"""Create or update one Custom DocPerm row. Only call when custom mode is already on."""
	existing = frappe.db.exists(
		"Custom DocPerm",
		{"parent": doctype, "role": role, "permlevel": permlevel},
	)
	if existing:
		doc = frappe.get_doc("Custom DocPerm", existing)
		dirty = False
		for key, value in values.items():
			if int(doc.get(key) or 0) != int(value):
				doc.set(key, value)
				dirty = True
		if dirty:
			doc.save(ignore_permissions=True)
		return
	frappe.get_doc(
		{
			"doctype": "Custom DocPerm",
			"parent": doctype,
			"parenttype": "DocType",
			"parentfield": "permissions",
			"role": role,
			"permlevel": permlevel,
			**values,
		}
	).insert(ignore_permissions=True)


def ensure_di_panel_permissions() -> dict:
	"""Restore Client Panel DocType access after Custom DocPerm overrides DocPerm."""
	ensure_di_panel_role()
	gaps = 0
	ensured = []

	targets = set(PANEL_WRITE_DOCTYPES) | set(PANEL_READ_DOCTYPES)
	# Also repair any other DocType already stuck in custom-perm mode (e.g. demo list).
	for name in frappe.get_all("Custom DocPerm", pluck="parent"):
		if name:
			targets.add(name)

	for doctype in sorted(targets):
		if not frappe.db.exists("DocType", doctype):
			continue
		gaps += fill_custom_docperm_gaps_from_docperm(doctype)
		if not _doctype_has_custom_perms(doctype):
			# DocPerm from the DocType JSON is still active — leave it alone.
			continue
		if doctype in PANEL_WRITE_DOCTYPES:
			upsert_custom_docperm(doctype, PANEL_ROLE, PANEL_WRITE_DOCTYPES[doctype])
			ensured.append(doctype)
		elif doctype in PANEL_READ_DOCTYPES:
			upsert_custom_docperm(doctype, PANEL_ROLE, PANEL_READ_RIGHTS)
			ensured.append(doctype)

	frappe.clear_cache()
	return {"gaps_filled": gaps, "panel_perms_ensured": ensured}


def repair_client_panel_assignments() -> None:
	"""Create missing User Permissions and seller extras for every Client Panel."""
	if not frappe.db.exists("DocType", "Client Panel"):
		return
	ensure_di_panel_permissions()
	for name in frappe.get_all("Client Panel", filters={"disabled": 0}, pluck="name"):
		try:
			panel = frappe.get_doc("Client Panel", name)
			if not panel.email:
				continue
			for seller in panel.assigned_seller_names():
				ensure_user_permission(panel.email, seller)
				provision_assigned_seller(seller)
		except Exception:
			frappe.log_error(title=f"Client Panel repair failed: {name}")


def block_non_di_modules(user_doc) -> None:
	user_doc.set("block_modules", [])
	for module in frappe.get_all("Module Def", pluck="name"):
		if module not in ALLOWED_MODULES:
			user_doc.append("block_modules", {"module": module})


def provision_panel_user(panel) -> None:
	"""Create or update the Frappe User that belongs to this Client Panel."""
	email = (panel.email or "").strip().lower()
	if email in PROTECTED_USERS:
		frappe.throw(_("Cannot create a Client Panel for {0}.").format(email))

	password = panel.get_password("welcome_password") if panel.get("welcome_password") else None
	enabled = 0 if panel.disabled else 1

	if frappe.db.exists("User", email):
		user = frappe.get_doc("User", email)
		if not is_panel_user(email) and "System Manager" in frappe.get_roles(email):
			frappe.throw(_("User {0} already exists and is not a Client Panel user.").format(email))
		user.enabled = enabled
		user.first_name = panel.full_name
		if PANEL_ROLE not in {row.role for row in user.roles}:
			user.add_roles(PANEL_ROLE)
		if frappe.db.exists("Workspace", "Digital Invoicing"):
			user.default_workspace = "Digital Invoicing"
		block_non_di_modules(user)
		user.flags.ignore_permissions = True
		user.flags.ignore_password_policy = True
		user.save()
	else:
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": panel.full_name,
				"enabled": enabled,
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
		user.add_roles(PANEL_ROLE)
		block_non_di_modules(user)
		user.flags.ignore_permissions = True
		user.save()

	panel.db_set("user", email, update_modified=False)
	panel.db_set("login_url", get_login_url(), update_modified=False)


def set_user_password(email: str, password: str) -> None:
	_update_password(email, password, logout_all_sessions=1)


def enforce_single_client_seller_cap(seller_doc) -> None:
	if not seller_doc.is_new() or not is_panel_user():
		return
	panel_name = get_client_panel_name()
	if not panel_name:
		return
	mode = frappe.db.get_value("Client Panel", panel_name, "mode")
	if mode != "Single Client":
		return
	if get_allowed_sellers():
		frappe.throw(_("Single Client mode allows only one Seller / Company."))


def grant_creator_seller_permission(seller_doc) -> None:
	user = frappe.session.user
	if not is_panel_user(user):
		return
	ensure_user_permission(user, seller_doc.name)
