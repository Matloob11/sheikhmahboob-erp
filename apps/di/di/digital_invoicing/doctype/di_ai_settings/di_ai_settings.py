import frappe
from frappe import _
from frappe.model.document import Document


class DIAISettings(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		allow_fbr_lookups: DF.Check
		allow_fbr_validate: DF.Check
		api_key: DF.Password | None
		daily_messages_per_user: DF.Int
		default_environment: DF.Literal["Sandbox", "Production"]
		enabled: DF.Check
		extra_instructions: DF.SmallText | None
		fallback_models: DF.SmallText | None
		max_output_tokens: DF.Int
		max_tool_rounds: DF.Int
		model: DF.Data
		reasoning_effort: DF.Literal["low", "medium", "high", "xhigh"]
		store_on_openai: DF.Check
		turn_budget_seconds: DF.Int
	# end: auto-generated types

	def validate(self):
		self.model = (self.model or "").strip()
		if not self.model:
			frappe.throw(_("Model is required."))
		# Keep each turn well inside the 120 second desk limit nginx enforces.
		if self.turn_budget_seconds and self.turn_budget_seconds > 90:
			frappe.throw(_("Turn budget must be 90 seconds or less; the desk times out at 120."))
		if self.max_tool_rounds and self.max_tool_rounds > 20:
			frappe.throw(_("Tool rounds must be 20 or fewer."))
