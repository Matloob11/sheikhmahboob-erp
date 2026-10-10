"""HS Code search ranking and SQL assembly, without a site."""

import unittest
from unittest.mock import MagicMock, patch

import frappe

from di.ai import hs_search

ROWS = [
	{
		"name": "8421.2100",
		"short_description": "CENTRIFUGES, INCLUDING CENTRIFUGAL DRYERS;...",
		"description": "CENTRIFUGES, INCLUDING CENTRIFUGAL DRYERS; FILTERING OR PURIFYING MACHINERY - FILTERING OR PURIFYING MACHINERY AND APPARATUS FOR LIQUIDS - FOR FILTERING OR PURIFYING WATER",
		"uom": "",
	},
	{
		"name": "8421.3100",
		"short_description": "CENTRIFUGES, INCLUDING CENTRIFUGAL DRYERS;...",
		"description": "CENTRIFUGES, INCLUDING CENTRIFUGAL DRYERS; FILTERING OR PURIFYING MACHINERY - FILTERING OR PURIFYING MACHINERY FOR GASES - INTAKE AIR FILTERS FOR INTERNAL COMBUSTION ENGINES",
		"uom": "",
	},
	{
		"name": "2201.1010",
		"short_description": "WATERS, INCLUDING NATURAL OR...",
		"description": "WATERS, INCLUDING NATURAL OR ARTIFICIAL MINERAL WATERS - MINERAL WATERS AND AERATED WATERS - MINERAL WATERS",
		"uom": "Liter",
	},
	{
		"name": "4820.9000",
		"short_description": "REGISTERS, ACCOUNT BOOKS, NOTE...",
		"description": "REGISTERS, ACCOUNT BOOKS, NOTE BOOKS, ORDER BOOKS - OTHER",
		"uom": "Numbers, pieces, units",
	},
]


class TestTokens(unittest.TestCase):
	def test_drops_stop_words_and_fragments(self):
		self.assertEqual(hs_search.tokens("Water filter of RO plant"), ["water", "filter", "ro", "plant"])
		self.assertEqual(hs_search.tokens("the and of"), [])
		self.assertEqual(hs_search.tokens("Filter, filter; FILTER"), ["filter"])

	def test_code_queries_are_recognised(self):
		self.assertTrue(hs_search.is_code("8421"))
		self.assertTrue(hs_search.is_code("8421.21"))
		self.assertTrue(hs_search.is_code("8421.2100"))
		self.assertFalse(hs_search.is_code("water"))
		self.assertFalse(hs_search.is_code("842"))


class TestRanking(unittest.TestCase):
	def test_leaf_hits_beat_parent_hits(self):
		words = hs_search.tokens("water filter")
		ranked = hs_search.rank(ROWS, words, "water filter", limit=3)
		self.assertEqual(ranked[0]["name"], "8421.2100")
		self.assertNotIn("4820.9000", [row["name"] for row in ranked])

	def test_rows_without_any_hit_are_dropped(self):
		ranked = hs_search.rank(ROWS, ["notebook"], "notebook")
		self.assertEqual(ranked, [])

	def test_limit_is_respected(self):
		ranked = hs_search.rank(ROWS, ["purifying"], "purifying", limit=1)
		self.assertEqual(len(ranked), 1)

	def test_all_words_matched_bonus_orders_specific_lines_first(self):
		words = hs_search.tokens("mineral waters")
		ranked = hs_search.rank(ROWS, words, "mineral waters")
		self.assertEqual(ranked[0]["name"], "2201.1010")


class TestSearchSql(unittest.TestCase):
	def test_words_travel_as_parameters_never_in_the_sql_text(self):
		db = MagicMock()
		db.sql.return_value = ROWS
		with patch.object(frappe, "db", db, create=True):
			result = hs_search.search(
				"water filter' or 1=1 -- alpha beta gamma delta epsilon zeta eta theta", limit=99
			)
		sql, params = db.sql.call_args.args
		self.assertNotIn("water", sql)
		self.assertNotIn("1=1", sql)
		self.assertIn("%(w0)s", sql)
		self.assertIn("limit %(max_rows)s", sql)
		self.assertEqual(params["w0"], "%water%")
		self.assertEqual(params["w1"], "%filter%")
		# Ten real words, eight LIKE clauses: the cap is exercised, not assumed.
		self.assertEqual(len([key for key in params if key.startswith("w")]), 8)
		self.assertNotIn("w8", params)
		self.assertEqual(params["max_rows"], hs_search.MAX_CANDIDATES)
		self.assertTrue(db.sql.call_args.kwargs.get("as_dict"))
		self.assertEqual(result[0]["hs_code"], "8421.2100")
		self.assertLessEqual(len(result), hs_search.MAX_LIMIT)

	def test_code_prefix_uses_get_all_and_blank_query_skips_the_database(self):
		db = MagicMock()
		with (
			patch.object(frappe, "db", db, create=True),
			patch.object(frappe, "get_all", return_value=[ROWS[0]]) as get_all,
		):
			self.assertEqual(hs_search.search("8421", limit=99)[0]["hs_code"], "8421.2100")
			self.assertEqual(hs_search.search("   "), [])
			self.assertEqual(hs_search.search("the of and"), [])
		get_all.assert_called_once()
		self.assertEqual(get_all.call_args.kwargs["filters"], {"name": ["like", "8421%"]})
		self.assertEqual(get_all.call_args.kwargs["limit_page_length"], hs_search.MAX_LIMIT)
		db.sql.assert_not_called()
