import importlib.util
import json
import sys
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("private_worker_health", ROOT / "health_service.py")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class HealthServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), module.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.thread.join(timeout=3)
        cls.httpd.server_close()

    def request(self, method, path):
        conn = HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=3)
        try:
            conn.request(method, path)
            response = conn.getresponse()
            body = response.read()
            return response.status, body
        finally:
            conn.close()

    def test_health_contains_no_actions_or_credentials(self):
        status, body = self.request("GET", "/health")
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "ready")
        self.assertEqual(data["instagram_connection"], "disabled")
        self.assertEqual(data["follows"], "disabled")
        self.assertEqual(data["unfollows"], "disabled")
        self.assertNotIn("token", body.decode().lower())
        self.assertNotIn("password", body.decode().lower())

    def test_post_or_other_path_cannot_trigger_actions(self):
        self.assertEqual(self.request("POST", "/health")[0], 405)
        self.assertEqual(self.request("GET", "/followers")[0], 404)


if __name__ == "__main__":
    unittest.main()
