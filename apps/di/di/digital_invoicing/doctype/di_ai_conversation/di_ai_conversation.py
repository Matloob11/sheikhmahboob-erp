from frappe.model.document import Document


class DIAIConversation(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from di.digital_invoicing.doctype.di_ai_message.di_ai_message import DIAIMessage

		draft_invoice: DF.Link | None
		invoice_context: DF.Link | None
		last_error: DF.SmallText | None
		last_response_id: DF.Data | None
		messages: DF.Table[DIAIMessage]
		model: DF.Data | None
		seller: DF.Link | None
		status: DF.Literal["Active", "Closed"]
		title: DF.Data | None
		total_input_tokens: DF.Int
		total_output_tokens: DF.Int
		user: DF.Link
	# end: auto-generated types

	pass
