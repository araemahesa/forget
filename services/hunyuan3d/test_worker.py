"""Run: python3 -m unittest discover -s services/hunyuan3d -v (Pillow required)."""
import base64
import http.client
import io
import json
from pathlib import Path
import struct
import tempfile
import threading
import time
import unittest
from http.server import HTTPServer

from PIL import Image
import worker


def glb(textured=True, external=False):
    document = {"asset": {"version": "2.0"}, "meshes": [{"primitives": []}],
                "buffers": [{"byteLength": 4}]}
    if textured:
        document.update(images=[{"bufferView": 0}], textures=[{"source": 0}],
                        materials=[{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}])
    if external:
        document["buffers"][0]["uri"] = "https://example.invalid/model.bin"
    payload = json.dumps(document).encode()
    payload += b" " * (-len(payload) % 4)
    chunks = struct.pack("<II", len(payload), 0x4E4F534A) + payload + struct.pack("<II", 4, 0x004E4942) + b"\0" * 4
    return struct.pack("<4sII", b"glTF", 2, len(chunks) + 12) + chunks


def request_data(**changes):
    out = io.BytesIO()
    Image.new("RGB", (32, 32), "red").save(out, "PNG")
    data = {"image_base64": base64.b64encode(out.getvalue()).decode(), "seed": 1, "steps": 2, "texture": True}
    data.update(changes)
    return data


class WorkerTests(unittest.TestCase):
    def test_token_auth_and_private_file(self):
        token = b"a" * 48
        self.assertTrue(worker.authorized("Bearer " + token.decode(), token))
        for header in [None, "", "Bearer wrong", "Basic " + token.decode(), "Bearer " + "é" * 48]:
            self.assertFalse(worker.authorized(header, token))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "token"
            path.write_bytes(token)
            path.chmod(0o600)
            self.assertEqual(worker.read_token(path), token)
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                worker.read_token(path)
            path.chmod(0o600)
            link = Path(tmp) / "link"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                worker.read_token(link)

    def test_input_bounds_and_real_decode(self):
        image, options = worker.decode_input(request_data())
        self.assertEqual(image.size, (32, 32))
        self.assertEqual(options, {"seed": 1, "steps": 2, "texture": True})
        bad = [dict(seed=True), dict(seed=-1), dict(seed=2147483648), dict(steps=0),
               dict(steps=51), dict(steps=1.5), dict(texture="true"), dict(url="https://invalid"),
               dict(image_base64="data:image/png;base64,AAAA"), dict(image_base64="é"),
               dict(image_base64=base64.b64encode(b"not an image").decode())]
        for changes in bad:
            with self.subTest(changes=changes), self.assertRaises(worker.Rejected):
                worker.decode_input(request_data(**changes))
        out = io.BytesIO()
        Image.new("RGB", (2049, 2049)).save(out, "PNG")
        with self.assertRaises(worker.Rejected):
            worker.decode_input(request_data(image_base64=base64.b64encode(out.getvalue()).decode()))

    def test_accepted_formats_and_animated_rejection(self):
        for format in ["PNG", "JPEG", "WEBP"]:
            out = io.BytesIO()
            Image.new("RGB", (40, 40), "blue").save(out, format)
            image, _ = worker.decode_input(request_data(image_base64=base64.b64encode(out.getvalue()).decode()))
            self.assertEqual(image.mode, "RGBA")
        for format in ["GIF", "PNG", "WEBP"]:
            out = io.BytesIO()
            Image.new("RGB", (40, 40), "red").save(out, format, save_all=True,
                append_images=[Image.new("RGB", (40, 40), "blue")], duration=100, loop=0)
            with self.assertRaises(worker.Rejected):
                worker.decode_input(request_data(image_base64=base64.b64encode(out.getvalue()).decode()))

    def test_glb_guards(self):
        self.assertEqual(worker.validate_glb(glb(), True), glb())
        for data, textured in [(b"fake", True), (glb(False), True), (glb(external=True), True),
                               (glb()[:-1], True), (glb().replace(b"glTF", b"bad!", 1), False)]:
            with self.subTest(data=data[:10]), self.assertRaises(ValueError):
                worker.validate_glb(data, textured)

    def wait_status(self, jobs, key, status):
        deadline = time.monotonic() + 3
        with jobs.condition:
            while jobs.items.get(key, {}).get("status") != status:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self.fail(f"Expected {status}")
                jobs.condition.wait(remaining)

    def test_single_inference_cancel_capacity_cleanup(self):
        started, release = threading.Event(), threading.Event()
        calls = []
        def engine(path, options, cancelled):
            calls.append(path)
            started.set()
            release.wait(3)
            return glb()
        with tempfile.TemporaryDirectory() as tmp:
            jobs = worker.Jobs(tmp, engine, max_jobs=2)
            try:
                image, options = worker.decode_input(request_data())
                first = jobs.submit(image, options)
                self.assertTrue(started.wait(2))
                second = jobs.submit(image, options)
                self.assertEqual(second["status"], "queued")
                with self.assertRaises(worker.Rejected) as rejected:
                    jobs.submit(image, options)
                self.assertEqual(rejected.exception.status, 429)
                self.assertEqual(len(calls), 1)
                self.assertEqual(jobs.cancel(first["id"])["status"], "cancelled")
                self.assertEqual(len(calls), 1)  # Running GPU task not replaced early.
                release.set()
                self.wait_status(jobs, second["id"], "succeeded")
                self.assertEqual(len(calls), 2)
                self.assertFalse((Path(tmp) / first["id"]).exists())
                with jobs.output(second["id"]) as output:
                    self.assertEqual(output.read(), glb())
                self.assertFalse((Path(tmp) / second["id"] / "input.png").exists())
                jobs.cancel(second["id"])
                self.assertFalse((Path(tmp) / second["id"]).exists())
            finally:
                release.set()
                jobs.close()

    def test_failure_sanitization_and_expiry(self):
        def fail(*_):
            raise ValueError("secret=do-not-expose")
        with tempfile.TemporaryDirectory() as tmp:
            jobs = worker.Jobs(tmp, fail, ttl=0)
            try:
                image, options = worker.decode_input(request_data())
                item = jobs.submit(image, options)
                with jobs.condition:
                    deadline = time.monotonic() + 3
                    while jobs.items.get(item["id"], {}).get("status") not in {None, "failed"}:
                        jobs.condition.wait(max(0.001, deadline - time.monotonic()))
                        if time.monotonic() >= deadline:
                            self.fail("Failure timeout")
                    job = jobs.items.get(item["id"])
                    if job:
                        self.assertNotIn("secret", jobs._public(job)["error"])
                    jobs._prune()
                    self.assertEqual(jobs.items, {})
                self.assertEqual(list(Path(tmp).iterdir()), [])
            finally:
                jobs.close()

    def test_http_contract(self):
        token = b"a" * 48
        with tempfile.TemporaryDirectory() as tmp:
            jobs = worker.Jobs(tmp, lambda *_: glb())
            server = HTTPServer(("127.0.0.1", 0), worker.handler_type(jobs, token, {"cuda_available": False, "ready": False}))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def call(method, path, data=None, auth=True, headers=None):
                connection = http.client.HTTPConnection(*server.server_address, timeout=3)
                request_headers = {"Content-Type": "application/json"}
                if auth:
                    request_headers["Authorization"] = "Bearer " + token.decode()
                request_headers.update(headers or {})
                connection.request(method, path, json.dumps(data) if data is not None else None, request_headers)
                response = connection.getresponse()
                status, body = response.status, response.read()
                connection.close()
                return status, body
            try:
                self.assertEqual(call("GET", "/health", auth=False)[0], 401)
                status, body = call("GET", "/health")
                self.assertEqual(status, 200)
                self.assertFalse(json.loads(body)["cuda_available"])
                self.assertFalse(json.loads(body)["ready"])
                self.assertEqual(call("GET", "/health/")[0], 404)
                self.assertEqual(call("POST", "/v1/jobs", {})[0], 400)
                self.assertEqual(call("POST", "/v1/jobs", {}, headers={"Content-Type": "text/plain"})[0], 415)
                self.assertEqual(call("GET", "/v1/jobs/../../token")[0], 404)
                status, body = call("POST", "/v1/jobs", request_data())
                self.assertEqual(status, 202)
                job = json.loads(body)
                self.assertRegex(job["id"], r"^[a-f0-9]{32}$")
                self.wait_status(jobs, job["id"], "succeeded")
                path = "/v1/jobs/" + job["id"]
                self.assertEqual(call("GET", path + "/model.glb", auth=False)[0], 401)
                self.assertEqual(call("GET", path + "/model.glb"), (200, glb()))
                self.assertEqual(json.loads(call("GET", path)[1])["output_url"], path + "/model.glb")
                self.assertEqual(json.loads(call("DELETE", path)[1])["status"], "cancelled")
                self.assertEqual(call("GET", path)[0], 404)
            finally:
                server.shutdown()
                thread.join()
                server.server_close()
                jobs.close()


if __name__ == "__main__":
    unittest.main()
