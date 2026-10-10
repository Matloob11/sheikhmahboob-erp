"""STATL registration helpers (P1-4)."""

import unittest

from di.integrations.statl import normalise_registration_type, registration_mismatch


class TestRegistrationHelpers(unittest.TestCase):
	def test_normalise_registered_and_unregistered(self):
		self.assertEqual(normalise_registration_type({"registrationType": "Registered"}), "Registered")
		self.assertEqual(normalise_registration_type({"status": "Un-Registered"}), "Unregistered")

	def test_mismatch_comparison(self):
		self.assertTrue(registration_mismatch("Registered", "Unregistered"))
		self.assertFalse(registration_mismatch("Registered", "Registered"))
		self.assertFalse(registration_mismatch("Registered", ""))
