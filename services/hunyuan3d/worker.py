#!/usr/bin/env python3
"""Private, single-GPU image-to-GLB worker. Never expose directly to Internet."""
import argparse
import base64
import binascii
import gc
import hmac
import io
import json
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import struct
import tempfile
import threading
import time
import uuid
import warnings
from http.server import BaseHTTPRequestHandler, HTTPServer

from PIL import Image, ImageOps, UnidentifiedImageError

MODEL = "tencent/Hunyuan3D-2"
SOURCE_REVISION = "f8db63096c8282cb27354314d896feba5ba6ff8a"
MODEL_REVISION = "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf"
VERSION = "1.0.0"
MAX_IMAGE = 8 * 1024 * 1024
MAX_BODY = 12 * 1024 * 1024
MAX_OUTPUT = 64 * 1024 * 1024
MAX_PIXELS = 4 * 1024 * 1024
MAX_JOBS = 4
TTL = 3600
ID = re.compile(r"[0-9a-f]{32}\Z")
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class Rejected(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def read_token(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("Token file must be owned by current user with mode 0600")
        token = stream.read(257).strip()
    if not re.fullmatch(rb"[A-Za-z0-9_-]{32,256}", token):
        raise ValueError("Token must contain 32..256 URL-safe ASCII characters")
    return token


def authorized(header, token):
    expected = b"Bearer " + token
    return isinstance(header, str) and hmac.compare_digest(header.encode("utf-8"), expected)


def decode_input(data):
    if not isinstance(data, dict) or set(data) - {"image_base64", "seed", "steps", "texture"}:
        raise Rejected("Expected image_base64, seed, steps, texture only")
    seed, steps, texture = data.get("seed", 0), data.get("steps", 30), data.get("texture", True)
    if type(seed) is not int or not 0 <= seed <= 2147483647:
        raise Rejected("seed must be integer 0..2147483647")
    if type(steps) is not int or not 1 <= steps <= 50:
        raise Rejected("steps must be integer 1..50")
    if type(texture) is not bool:
        raise Rejected("texture must be boolean")
    encoded = data.get("image_base64")
    if not isinstance(encoded, str) or not encoded or len(encoded) > 4 * ((MAX_IMAGE + 2) // 3):
        raise Rejected("image_base64 must be raw base64, at most 8 MiB decoded")
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > MAX_IMAGE:
            raise Rejected("Image exceeds 8 MiB", 413)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in {"PNG", "JPEG", "WEBP"} or getattr(image, "n_frames", 1) != 1:
                    raise Rejected("Only single-frame PNG, JPEG, WebP accepted")
                if image.width * image.height > MAX_PIXELS or max(image.size) > 4096 or min(image.size) < 16:
                    raise Rejected("Image must be 16..4096 pixels per side and at most 4 megapixels")
                image.verify()
            with Image.open(io.BytesIO(raw)) as image:
                image.load()
                image = ImageOps.exif_transpose(image).convert("RGBA")
                image.thumbnail((1024, 1024))
                # Metadata removed; inference never opens user-controlled paths or URLs.
                clean = Image.frombytes("RGBA", image.size, image.tobytes())
    except Rejected:
        raise
    except (ValueError, TypeError, OSError, binascii.Error, UnidentifiedImageError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise Rejected("Invalid or unsafe image") from None
    return clean, {"seed": seed, "steps": steps, "texture": texture}


def validate_glb(blob, textured):
    """Reject non-GLB2, external resources, or missing requested base-color texture."""
    if not isinstance(blob, bytes) or not 20 <= len(blob) <= MAX_OUTPUT:
        raise ValueError("Invalid output size")
    magic, version, length = struct.unpack_from("<4sII", blob)
    if magic != b"glTF" or version != 2 or length != len(blob):
        raise ValueError("Invalid GLB2 header")
    offset, document, binary = 12, None, False
    while offset < len(blob):
        if offset + 8 > len(blob):
            raise ValueError("Truncated chunk")
        size, kind = struct.unpack_from("<II", blob, offset)
        offset += 8
        if size % 4 or offset + size > len(blob):
            raise ValueError("Invalid chunk length")
        if document is None:
            if kind != 0x4E4F534A:
                raise ValueError("Missing JSON chunk")
            document = json.loads(blob[offset:offset + size])
        elif kind == 0x004E4942:
            binary = True
        offset += size
    if not isinstance(document, dict) or not document.get("meshes") or not binary:
        raise ValueError("Missing mesh or binary data")
    for entry in document.get("buffers", []) + document.get("images", []):
        if "uri" in entry:
            raise ValueError("Resources must be embedded in GLB binary chunk")
    if textured:
        images, textures = document.get("images", []), document.get("textures", [])
        if not images or not all("bufferView" in image for image in images):
            raise ValueError("Missing embedded texture image")
        if not textures or not any("baseColorTexture" in material.get("pbrMetallicRoughness", {})
                                   for material in document.get("materials", [])):
            raise ValueError("Missing base-color texture")
    return blob


class Engine:
    def __init__(self, model_dir):
        import torch
        self.torch = torch
        self.model_dir = str(model_dir)
        self.health = {"cuda_available": bool(torch.cuda.is_available()), "ready": False}
        if not self.health["cuda_available"]:
            raise RuntimeError("CUDA unavailable; install matching NVIDIA driver/PyTorch first")
        # Real CUDA operation, not merely driver presence.
        torch.ones(1, device="cuda").add_(1)
        torch.cuda.synchronize()
        from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
        from hy3dgen.texgen import Hunyuan3DPaintPipeline
        from hy3dgen.rembg import BackgroundRemover
        self.shape_type = Hunyuan3DDiTFlowMatchingPipeline
        self.paint_type = Hunyuan3DPaintPipeline
        self.remover = BackgroundRemover()
        self.health.update(ready=True, gpu=torch.cuda.get_device_name(0),
                           cuda_version=torch.version.cuda)

    def __call__(self, image_path, options, cancelled):
        torch = self.torch
        shape = paint = None
        try:
            with Image.open(image_path) as source:
                image = self.remover(source.convert("RGBA"))
            if cancelled.is_set():
                return None
            torch.manual_seed(options["seed"])
            with torch.inference_mode():
                shape = self.shape_type.from_pretrained(self.model_dir, device="cuda",
                                                       subfolder="hunyuan3d-dit-v2-0")
                mesh = shape(image=image, num_inference_steps=options["steps"],
                             generator=torch.Generator(device="cuda").manual_seed(options["seed"]),
                             octree_resolution=256, num_chunks=8000, enable_pbar=False)[0]
                # ponytail: reload per job; cache only after measured 24GB VRAM budget permits it.
                del shape
                shape = None
                gc.collect()
                torch.cuda.empty_cache()
                if cancelled.is_set():
                    return None
                if options["texture"]:
                    from hy3dgen.shapegen import FloaterRemover, DegenerateFaceRemover, FaceReducer
                    mesh = FloaterRemover()(mesh)
                    mesh = DegenerateFaceRemover()(mesh)
                    mesh = FaceReducer()(mesh)
                    paint = self.paint_type.from_pretrained(self.model_dir,
                                                           subfolder="hunyuan3d-paint-v2-0")
                    # Pinned custom paint pipeline mixes CPU/CUDA tensors with diffusers offload.
                    # Shape is already released; keep paint on CUDA for correctness on 24GB.
                    mesh = paint(mesh, image=image)
                if cancelled.is_set():
                    return None
                return validate_glb(mesh.export(file_type="glb"), options["texture"])
        finally:
            del shape, paint
            gc.collect()
            torch.cuda.empty_cache()


class Jobs:
    def __init__(self, root, engine, ttl=TTL, max_jobs=MAX_JOBS):
        self.root, self.engine, self.ttl, self.max_jobs = Path(root), engine, ttl, max_jobs
        self.items = {}
        self.condition = threading.Condition(threading.RLock())
        self.stopping = False
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _prune(self):
        for key, job in list(self.items.items()):
            if not job["active"] and job["status"] not in {"queued", "running"} and time.monotonic() - job["updated"] > self.ttl:
                shutil.rmtree(self.root / key, ignore_errors=True)
                del self.items[key]

    def _public(self, job):
        result = {"id": job["id"], "status": job["status"], "model": MODEL}
        if "error" in job:
            result["error"] = job["error"]
        if job["status"] == "succeeded":
            result["output_url"] = f'/v1/jobs/{job["id"]}/model.glb'
        return result

    def submit(self, image, options):
        with self.condition:
            self._prune()
            if len(self.items) >= self.max_jobs:
                raise Rejected("Job capacity reached; delete completed jobs or retry after expiry", 429)
            key = uuid.uuid4().hex
            directory = self.root / key
            directory.mkdir(mode=0o700)
            try:
                image.save(directory / "input.png", format="PNG")
            except Exception:
                shutil.rmtree(directory, ignore_errors=True)
                raise
            job = {"id": key, "status": "queued", "options": options,
                   "cancel": threading.Event(), "updated": time.monotonic(), "active": False}
            self.items[key] = job
            self.condition.notify_all()
            return self._public(job)

    def _job(self, key):
        if not ID.fullmatch(key) or key not in self.items:
            raise Rejected("Job not found", 404)
        return self.items[key]

    def get(self, key):
        with self.condition:
            self._prune()
            return self._public(self._job(key))

    def cancel(self, key):
        with self.condition:
            job = self._job(key)
            job["cancel"].set()
            job.update(status="cancelled", updated=time.monotonic())
            job.pop("error", None)
            if not job["active"]:
                shutil.rmtree(self.root / key, ignore_errors=True)
                # Explicit delete immediately frees queue capacity.
                del self.items[key]
            return self._public(job)

    def output(self, key):
        with self.condition:
            job = self._job(key)
            if job["status"] != "succeeded":
                raise Rejected("Output not ready", 409)
            # Open while lock held so DELETE cannot race path lookup.
            return (self.root / key / "model.glb").open("rb")

    def _run(self):
        while True:
            with self.condition:
                self._prune()
                if self.stopping:
                    return
                job = next((j for j in self.items.values() if j["status"] == "queued"), None)
                if job is None:
                    self.condition.wait(timeout=5)
                    continue
                job.update(status="running", active=True)
            directory = self.root / job["id"]
            try:
                blob = self.engine(directory / "input.png", job["options"], job["cancel"])
                with self.condition:
                    if not job["cancel"].is_set():
                        validate_glb(blob, job["options"]["texture"])
                        with (directory / "model.glb").open("xb") as output:
                            output.write(blob)
                        job["status"] = "succeeded"
            except Exception as error:
                print(f"Job {job['id']} failed ({type(error).__name__})", flush=True)
                with self.condition:
                    if not job["cancel"].is_set():
                        job.update(status="failed", error="Inference failed; check CUDA memory, model files and setup")
            finally:
                with self.condition:
                    (directory / "input.png").unlink(missing_ok=True)
                    job.update(active=False, updated=time.monotonic())
                    if job["status"] != "succeeded":
                        shutil.rmtree(directory, ignore_errors=True)
                    if job["cancel"].is_set():
                        self.items.pop(job["id"], None)
                    self.condition.notify_all()

    def close(self):
        with self.condition:
            self.stopping = True
            for job in self.items.values():
                job["cancel"].set()
            self.condition.notify_all()
        self.thread.join()  # GPU tasks must finish before private root is removed.


def handler_type(jobs, token, health):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ForgeKitHunyuan/" + VERSION
        sys_version = ""
        timeout = 10

        def log_message(self, *_args):
            pass  # Do not log payloads, Authorization, or user-controlled URL strings.

        def setup(self):
            super().setup()
            self.connection.settimeout(self.timeout)

        def _json(self, value, status=200):
            data = json.dumps(value, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def _dispatch(self):
            self.close_connection = True
            try:
                if not authorized(self.headers.get("Authorization"), token):
                    raise Rejected("Unauthorized", 401)
                if self.path == "/health" and self.command == "GET":
                    return self._json({"model": MODEL, "version": VERSION,
                                       "source_revision": SOURCE_REVISION,
                                       "model_revision": MODEL_REVISION, **health})
                if self.path == "/v1/jobs" and self.command == "POST":
                    if self.headers.get_content_type() != "application/json":
                        raise Rejected("Content-Type must be application/json", 415)
                    lengths = self.headers.get_all("Content-Length", [])
                    if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or len(lengths[0]) > 10 or not lengths[0].isdigit():
                        raise Rejected("Exactly one Content-Length required", 411)
                    length = int(lengths[0])
                    if not 0 < length <= MAX_BODY:
                        raise Rejected("Request body exceeds limit", 413)
                    body = self.rfile.read(length)
                    if len(body) != length:
                        raise Rejected("Incomplete request body")
                    try:
                        data = json.loads(body)
                    except (ValueError, RecursionError):
                        raise Rejected("Invalid JSON") from None
                    image, options = decode_input(data)
                    try:
                        return self._json(jobs.submit(image, options), 202)
                    finally:
                        image.close()
                match = re.fullmatch(r"/v1/jobs/([0-9a-f]{32})(/model\.glb)?", self.path)
                if not match:
                    raise Rejected("Endpoint not found", 404)
                key, output = match.groups()
                if not output and self.command == "GET":
                    return self._json(jobs.get(key))
                if not output and self.command == "DELETE":
                    return self._json(jobs.cancel(key))
                if output and self.command == "GET":
                    with jobs.output(key) as stream:
                        self.send_response(200)
                        self.send_header("Content-Type", "model/gltf-binary")
                        self.send_header("Content-Length", str(os.fstat(stream.fileno()).st_size))
                        self.send_header("Cache-Control", "no-store")
                        self.send_header("X-Content-Type-Options", "nosniff")
                        self.end_headers()
                        shutil.copyfileobj(stream, self.wfile, length=65536)
                    return
                raise Rejected("Method not allowed", 405)
            except Rejected as error:
                self._json({"error": str(error)}, error.status)
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                pass
            except Exception:
                self._json({"error": "Worker request failed"}, 500)

        do_GET = do_POST = do_DELETE = do_PUT = do_PATCH = do_OPTIONS = do_HEAD = _dispatch
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", choices=["127.0.0.1"], default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path,
                        default=Path.home() / ".local/state/forgekit-hunyuan3d")
    args = parser.parse_args()
    os.umask(0o077)
    token = read_token(args.token_file)
    root = args.data_dir.expanduser().absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Data directory must be owned by current user with mode 0700")
    import fcntl
    with (root / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for child in root.glob("session-*"):
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
        model_dir = args.model_dir.expanduser().resolve(strict=True)
        for folder in ["hunyuan3d-dit-v2-0", "hunyuan3d-paint-v2-0", "hunyuan3d-delight-v2-0"]:
            if not (model_dir / folder).is_dir():
                raise ValueError("Model snapshot incomplete; rerun setup")
        engine = Engine(model_dir)
        with tempfile.TemporaryDirectory(prefix="session-", dir=root) as session:
            jobs = Jobs(session, engine)
            try:
                with HTTPServer((args.host, args.port), handler_type(jobs, token, engine.health)) as server:
                    print(f"ForgeKit Hunyuan3D {VERSION} listening on {args.host}:{args.port}", flush=True)
                    server.serve_forever()
            finally:
                jobs.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        # Never print arbitrary dependency exception text: it may include credentials/URLs.
        print(f"Worker startup failed ({type(error).__name__}); verify setup, private paths and CUDA", flush=True)
        raise SystemExit(1)
