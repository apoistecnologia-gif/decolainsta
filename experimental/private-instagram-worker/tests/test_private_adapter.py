import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("private_adapter", ROOT / "adapter.py")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class FakeClient:
    def __init__(self):
        self.calls = []
        self.friendship = {"following": False, "followed_by": False, "outgoing_request": False}

    def user_id_from_username(self, name):
        self.calls.append(("lookup", name))
        return "123"

    def user_followers(self, user_id, amount=0):
        self.calls.append(("followers", user_id, amount))
        return {"1": object(), "2": object(), "3": object()}

    def user_friendship_v1(self, user_id):
        self.calls.append(("friendship", user_id))
        return self.friendship

    def user_follow(self, user_id):
        self.calls.append(("follow", user_id))
        return True

    def user_unfollow(self, user_id):
        self.calls.append(("unfollow", user_id))
        return True


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeClient()
        self.api = module.PrivateInstagramAdapter(self.fake)

    def test_sample_is_bounded_and_not_synthetic(self):
        self.assertEqual(self.api.read_reference_sample("ref", amount=3), ["1", "2", "3"])
        self.assertEqual(self.fake.calls[-1], ("followers", "123", 3))
        for invalid in [0, 6, -1]:
            with self.assertRaises(ValueError):
                self.api.read_reference_sample("ref", amount=invalid)

    def test_follow_is_a_single_call_and_skips_already_followed(self):
        self.assertTrue(self.api.follow_once("999"))
        self.assertEqual(self.fake.calls, [("friendship", "999"), ("follow", "999")])
        self.fake.calls.clear()
        self.fake.friendship["following"] = True
        self.assertFalse(self.api.follow_once("999"))
        self.assertEqual(self.fake.calls, [("friendship", "999")])

    def test_unfollow_preserves_a_followback_and_requires_actual_following(self):
        self.fake.friendship = {"following": True, "followed_by": True}
        self.assertFalse(self.api.unfollow_once("999"))
        self.assertEqual(self.fake.calls, [("friendship", "999")])
        self.fake.calls.clear()
        self.fake.friendship["followed_by"] = False
        self.assertTrue(self.api.unfollow_once("999"))
        self.assertEqual(self.fake.calls, [("friendship", "999"), ("unfollow", "999")])

    def test_cli_blocks_all_operations_by_default(self):
        spec2 = importlib.util.spec_from_file_location("private_cli", ROOT / "cli.py")
        sys.modules["adapter"] = module
        cli = importlib.util.module_from_spec(spec2)
        sys.modules[spec2.name] = cli
        spec2.loader.exec_module(cli)
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(cli.run("probe"), 2)
            self.assertEqual(cli.run("follow-once"), 2)
        with patch.dict("os.environ", {"PRIVATE_API_RESEARCH_APPROVED": "yes"}, clear=True):
            self.assertEqual(cli.run("follow-once"), 2)
        with patch.dict("os.environ", {
            "PRIVATE_API_RESEARCH_APPROVED": "yes",
            "PRIVATE_API_SINGLE_ACTION_APPROVED": "yes",
            "PRIVATE_API_APPROVED_TARGET": "target",
            "PRIVATE_API_EXPECTED_TARGET": "someone_else",
        }, clear=True):
            self.assertEqual(cli.run("follow-once"), 2)


if __name__ == "__main__":
    unittest.main()
