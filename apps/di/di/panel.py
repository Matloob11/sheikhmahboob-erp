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


def get_allowed_sellers(user: str | None = None) -> list[str]:
	"""Client Panel assignment is the source of truth. User Permission is a fallback
	for sellers the client created themselves after login."""
	user = user or frappe.session.user
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
	if not is_panel_user(user):
		return None
	allowed = get_allowed_sellers(user)
	if not allowed:
		return "1=0"
	escaped = ", ".join(frappe.db.escape(name) for name in allowed)
	return f"`tab{doctype}`.`{fieldname}` in ({escaped})"


def get_seller_permission_query(user: str | None = None) -> str | None:
	if not is_panel_user(user):
		return None
	allowed = get_allowed_sellers(user)
	if not allowed:
		return "1=0"
	escaped = ", ".join(frappe.db.escape(name) for name in allowed)
	return f"`tab{SELLER_DOCTYPE}`.name in ({escaped})"


def get_buyer_permission_query(user: str | None = None) -> str | None:
	if not is_panel_user(user):
		return None
	allowed = get_allowed_sellers(user)
	if not allowed:
		return "1=0"
	escaped = ", ".join(frappe.db.escape(name) for name in allowed)
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
	if not is_panel_user(user):
		return True
	if ptype == "create":
		return True
	if getattr(doc, "doctype", None) == SELLER_DOCTYPE and callable(getattr(doc, "is_new", None)) and doc.is_new():
		return True
	seller = _seller_value(doc)
	allowed = set(get_allowed_sellers(user))
	if seller and seller in allowed:
		return True
	if getattr(doc, "doctype", None) == "Buyer" and not seller:
		return cstr(doc.get("buyer_registration_type")) == "Unregistered"
	return False


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


def repair_client_panel_assignments() -> None:
	"""Create missing User Permissions and seller extras for every Client Panel."""
	if not frappe.db.exists("DocType", "Client Panel"):
		return
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
