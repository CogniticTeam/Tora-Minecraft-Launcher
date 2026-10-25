import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from server import create_server

TOKEN = "unit-test-token-for-community-only-123456"


class CommunityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server(0, TOKEN)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = "http://127.0.0.1:" + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, auth=True, method="GET"):
        headers = {"Authorization": "Bearer " + TOKEN} if auth else {}
        return urlopen(Request(self.origin + path, headers=headers, method=method), timeout=3)

    def test_health_and_community_contract(self):
        with self.request("/health") as r:
            self.assertEqual(json.load(r)["status"], "ok")
        with self.request("/v1/community") as r:
            data = json.load(r)
            self.assertEqual(data["status"], "coming_soon")
            self.assertFalse(any(data["features"].values()))
            self.assertNotIn(TOKEN, json.dumps(data))

    def test_origin_requires_gateway_credential(self):
        with self.assertRaises(HTTPError) as error:
            self.request("/v1/community", auth=False)
        self.assertEqual(error.exception.code, 401)

    def test_unrelated_services_are_not_exposed(self):
        for path in ("/v1/chat/completions", "/auth", "/config", "/downloads"):
            with self.assertRaises(HTTPError) as error:
                self.request(path)
            self.assertEqual(error.exception.code, 404)

    def test_writes_are_disabled_and_head_has_no_body(self):
        with self.assertRaises(HTTPError) as error:
            self.request("/v1/community", method="POST")
        self.assertEqual(error.exception.code, 405)
        with self.request("/health", method="HEAD") as r:
            self.assertEqual(r.read(), b"")

    def test_missing_secret_refuses_startup(self):
        with self.assertRaises(RuntimeError):
            create_server(0, "short")


if __name__ == "__main__":
    unittest.main()
