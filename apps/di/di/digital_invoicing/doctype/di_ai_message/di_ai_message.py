from frappe.model.document import Document


class DIAIMessage(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		content: DF.LongText | None
		created_at: DF.Datetime | None
		duration_ms: DF.Int
		input_tokens: DF.Int
		output_tokens: DF.Int
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
		role: DF.Literal["user", "assistant", "tool", "error"]
		tool_args: DF.Code | None
		tool_call_id: DF.Data | None
		tool_name: DF.Data | None
		tool_result: DF.Code | None
	# end: auto-generated types

	pass
