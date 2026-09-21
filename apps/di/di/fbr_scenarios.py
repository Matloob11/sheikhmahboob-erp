"""Official FBR Digital Invoicing sandbox scenarios SN001-SN028.

Sale type names match the live Sale Type master (FBR Technical Specification
for DI API, section 9), including existing casing such as "Exempt goods".
"""

# sn_no, description, sale / purchase type
FBR_SCENARIOS = [
	("SN001", "Goods at standard rate to registered buyers", "Goods at standard rate (default)"),
	("SN002", "Goods at standard rate to unregistered buyers", "Goods at standard rate (default)"),
	("SN003", "Sale of Steel (Melted and Re-Rolled)", "Steel melting and re-rolling"),
	("SN004", "Sale by Ship Breakers", "Ship breaking"),
	("SN005", "Reduced rate sale", "Goods at Reduced Rate"),
	("SN006", "Exempt goods sale", "Exempt goods"),
	("SN007", "Zero rated sale", "Goods at zero-rate"),
	("SN008", "Sale of 3rd schedule goods", "3rd Schedule Goods"),
	("SN009", "Cotton Spinners purchase from Cotton Ginners (Textile Sector)", "Cotton ginners"),
	("SN010", "Mobile Operators adds Sale (Telecom Sector)", "Telecommunication services"),
	("SN011", "Toll Manufacturing sale by Steel sector", "Toll Manufacturing"),
	("SN012", "Sale of Petroleum products", "Petroleum Products"),
	("SN013", "Electricity Supply to Retailers", "Electricity Supply to Retailers"),
	("SN014", "Sale of Gas to CNG stations", "Gas to CNG stations"),
	("SN015", "Sale of mobile phones", "Mobile Phones"),
	("SN016", "Processing / Conversion of Goods", "Processing/Conversion of Goods"),
	("SN017", "Sale of Goods where FED is charged in ST mode", "Goods (FED in ST Mode)"),
	("SN018", "Sale of Services where FED is charged in ST Mode", "Services (FED in ST Mode)"),
	("SN019", "Sale of Services", "Services"),
	("SN020", "Sale of Electric Vehicles", "Electric Vehicle"),
	("SN021", "Sale of Cement / Concrete Block", "Cement /Concrete Block"),
	("SN022", "Sale of Potassium Chlorate", "Potassium Chlorate"),
	("SN023", "Sale of CNG", "CNG Sales"),
	("SN024", "Goods sold that are listed in SRO 297(1)/2023", "Goods as per SRO.297(|)/2023"),
	("SN025", "Drugs sold at fixed ST rate under serial 81 of Eighth Schedule Table 1", "Non-Adjustable Supplies"),
	("SN026", "Sale to End Consumer by retailers", "Goods at standard rate (default)"),
	("SN027", "Sale to End Consumer by retailers", "3rd Schedule Goods"),
	("SN028", "Sale to End Consumer by retailers", "Goods at Reduced Rate"),
]


def official_sale_types():
	"""Unique FBR sale types in scenario order, no duplicates."""
	seen = []
	for _sn_no, _description, sale_type in FBR_SCENARIOS:
		if sale_type and sale_type not in seen:
			seen.append(sale_type)
	return seen
