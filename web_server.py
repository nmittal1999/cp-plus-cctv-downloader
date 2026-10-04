"""Private loopback web interface for the direct RTSP camera connector."""
import datetime as dt
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
import atexit
from recorder_connection import Recorder
from video_tools import HERE, MEDIA, export_stream

ASSETS = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "web"
PORT = 8765
SESSIONS = {}
LOCK = threading.Lock()
CLIPS = HERE / "Clips"
BRIDGE = "http://127.0.0.1:1986"
BRIDGE_PROCESS = None

def bridge(path, method="GET"):
    with urllib.request.urlopen(urllib.request.Request(BRIDGE + path, method=method), timeout=12) as response:
        return response.read()

def open_browser():
    edge = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
    if edge.exists():
        subprocess.Popen([str(edge), f"http://127.0.0.1:{PORT}/"])
    else:
        webbrowser.open(f"http://127.0.0.1:{PORT}/")


class Session:
    def __init__(self):
        self.recorder = None
        self.csrf = secrets.token_urlsafe(24)
        self.jobs, self.previews = {}, {}
        self.last_seen = time.monotonic()
        self.web_port = 80
        self.camera_error = None

    def stop_previews(self):
        for preview in self.previews.values():
            if not preview.get("stopped"):
                try: bridge("/api/streams?src=" + preview["name"], "DELETE")
                except Exception: pass
            preview["stopped"] = True
        self.previews.clear()



def interval(data, cameras):
    channel = int(data["channel"])
    if channel not in {camera["id"] for camera in cameras}:
        raise ValueError("Choose a valid camera.")
    start, end = dt.datetime.fromisoformat(data["start"]), dt.datetime.fromisoformat(data["end"])
    if start.tzinfo or end.tzinfo:
        raise ValueError("Use the recorder's local date and time.")
    duration = (end - start).total_seconds()
    if not 0 < duration <= 21600:
        raise ValueError("Choose an interval between one second and six hours.")
    return channel, start, end, duration


def clip_list(cameras=()):
    CLIPS.mkdir(parents=True, exist_ok=True)
    found = []
    names = {camera["id"]: camera["name"] for camera in cameras}
    for path in sorted(CLIPS.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)[:60]:
        if path.stat().st_size == 0 or ".partial." in path.name or ".working." in path.name:
            continue
        match = re.match(r"Camera(\d+)_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_to_(\d{2}-\d{2}-\d{2})", path.name)
        camera = int(match[1]) - 1 if match else None
        label = names.get(camera, f"Camera {camera + 1}" if camera is not None else "Camera clip")
        try: label = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))["camera"]
        except (OSError, ValueError, KeyError): pass
        found.append({"name": path.name, "size": path.stat().st_size,
            "camera": label,
            "date": match[2] if match else "", "start": match[3].replace("-", ":") if match else "",
            "end": match[4].replace("-", ":") if match else ""})
    return found


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        # Requests and credentials are not logged.
        pass

    def valid_host(self):
        return self.headers.get("Host") in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")

    def session(self, create=False):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except cookies.CookieError:
            pass
        token = jar.get("camera_session")
        token = token.value if token else None
        with LOCK:
            session = SESSIONS.get(token)
            if session is None and create:
                token = secrets.token_urlsafe(32)
                session = SESSIONS[token] = Session()
            if session:
                session.last_seen = time.monotonic()
        self.cookie_token = token if create else None
        return session

    def send_headers(self, status, kind, length=None):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-src http://127.0.0.1:1986; frame-ancestors 'none'; base-uri 'none'")
        if getattr(self, "cookie_token", None):
            self.send_header("Set-Cookie", f"camera_session={self.cookie_token}; HttpOnly; SameSite=Strict; Path=/")

    def respond(self, data, status=200):
        payload = json.dumps(data).encode()
        self.send_headers(status, "application/json; charset=utf-8", len(payload))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.cookie_token = None
        if not self.valid_host():
            self.respond({"error": "Invalid local address."}, 403)
            return
        path = urllib.parse.urlsplit(self.path).path
        try:
            if path in ("/", "/app.css", "/app.js"):
                file = ASSETS / ({"/": "index.html"}.get(path, path[1:]))
                payload = file.read_bytes()
                self.send_headers(200, mimetypes.guess_type(file.name)[0] or "application/octet-stream", len(payload))
                self.end_headers()
                self.wfile.write(payload)
                return
            session = self.session(create=(path == "/api/state"))
            if session is None:
                self.respond({"error": "Open the camera page first."}, 401)
                return
            if path == "/api/state":
                self.respond({"csrf": session.csrf, "connected": session.recorder is not None,
                    "cameras": session.recorder.cameras if session.recorder else [],
                    "camera_error": session.camera_error,
                    "clips": clip_list(session.recorder.cameras if session.recorder else []), "jobs": list(session.jobs.values())})
            elif path.startswith("/clips/"):
                self.send_clip(urllib.parse.unquote(path[len("/clips/"):]))
            else:
                self.respond({"error": "Not found."}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            self.respond({"error": str(error)}, 400)

    def do_POST(self):
        self.cookie_token = None
        if not self.valid_host() or self.headers.get("Origin") not in (None, f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"):
            self.respond({"error": "Use the local camera page."}, 403)
            return
        session = self.session()
        if session is None or self.headers.get("X-CSRF-Token") != session.csrf:
            self.respond({"error": "Refresh the camera page and try again."}, 403)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 16384:
                raise ValueError("Invalid request.")
            data = json.loads(self.rfile.read(size))
            path = urllib.parse.urlsplit(self.path).path
            if path == "/api/connect":
                if any(job["status"] == "working" for job in session.jobs.values()):
                    raise ValueError("Wait for the current export or cancel it before reconnecting.")
                session.stop_previews()
                recorder = Recorder()
                recorder.connect(str(data["address"]).strip(), int(data["port"]), str(data["username"]), str(data["password"]))
                if session.recorder:
                    session.recorder.close()
                session.recorder = recorder
                session.web_port = int(data.get("web_port", 80))
                session.camera_error = None
                try: recorder.discover_cameras(session.web_port)
                except RuntimeError as error: session.camera_error = str(error)
                self.respond({"connected": True, "camera_error": session.camera_error})
            elif path == "/api/cameras-refresh":
                if session.recorder is None: raise ValueError("Connect to your recorder first.")
                try:
                    cameras = session.recorder.discover_cameras(session.web_port)
                    session.camera_error = None
                    self.respond({"cameras": cameras})
                except RuntimeError as error:
                    session.camera_error = str(error)
                    raise
            elif path == "/api/disconnect":
                if any(job["status"] == "working" for job in session.jobs.values()):
                    raise ValueError("Cancel the current export before disconnecting.")
                session.stop_previews()
                if session.recorder:
                    session.recorder.close()
                session.recorder = None
                session.camera_error = None
                self.respond({"connected": False})
            elif path == "/api/preview-stop":
                session.stop_previews()
                self.respond({"stopped": True})
            elif path == "/api/cancel":
                event = getattr(session, "cancel", None)
                if event:
                    event.set()
                self.respond({"cancelled": True})
            elif path in ("/api/preview", "/api/export"):
                if session.recorder is None:
                    raise ValueError("Connect to your recorder first.")
                channel, start, end, duration = interval(data, session.recorder.cameras)
                camera_name = next(camera["name"] for camera in session.recorder.cameras if camera["id"] == channel)
                session.recorder.describe(session.recorder.url(channel, start, end))
                if path == "/api/preview":
                    session.stop_previews()
                    token = secrets.token_urlsafe(24)
                    speed = float(data.get("speed", 1))
                    if speed not in (0.5, 1, 2, 4, 8): raise ValueError("Choose a supported playback speed.")
                    name = "preview_" + token
                    query = urllib.parse.urlencode({"name": name, "src": session.recorder.url(channel, start, end, credentials=True) + (f"#scale={speed:.3f}#media=video" if speed != 1 else "")})
                    bridge("/api/streams?" + query, "PATCH")
                    session.previews[token] = {"name": name, "stopped": False}
                    self.respond({"url": BRIDGE + "/stream.html?src=" + name + f"&mode=mse&speed={speed:g}&duration={duration:g}", "id": token, "duration": duration})
                else:
                    if any(job["status"] == "working" for job in session.jobs.values()):
                        raise ValueError("An export is already running.")
                    token = secrets.token_urlsafe(12)
                    name = f"Camera{channel + 1:02d}_{start:%Y-%m-%d_%H-%M-%S}_to_{end:%H-%M-%S}_{time.time_ns()}.mp4"
                    job = {"started": time.time(), "duration": duration, "id": token, "name": name, "camera": camera_name, "status": "working", "message": "Starting export..."}
                    session.jobs[token] = job
                    session.cancel = cancel = threading.Event()
                    recorder = session.recorder
                    def export():
                        try:
                            def report(text, percent=None):
                                job["message"] = text
                            CLIPS.mkdir(exist_ok=True)
                            target = (CLIPS / name).with_suffix(".working.mp4")
                            length = export_stream(recorder, channel, start, end, target, cancel, report)
                            target.replace(CLIPS / name)
                            try: (CLIPS / name).with_suffix(".json").write_text(json.dumps({"camera": camera_name}, ensure_ascii=False), encoding="utf-8")
                            except OSError: pass
                            job.update(status="complete", message=f"Ready Â· {length:.1f} seconds", url="/clips/" + urllib.parse.quote(name))
                        except Exception as error:
                            job.update(status="cancelled" if cancel.is_set() else "failed", message=str(error))
                            partial = (CLIPS / name).with_suffix(".working.mp4")
                            if partial.exists():
                                partial.rename(partial.with_suffix(".partial.mp4"))
                    threading.Thread(target=export, daemon=True).start()
                    self.respond(job)
            elif path == "/api/quit":
                if any(job["status"] == "working" for job in session.jobs.values()):
                    raise ValueError("Cancel or finish the export before closing the app.")
                self.respond({"closed": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            else:
                self.respond({"error": "Not found."}, 404)
        except Exception as error:
            self.respond({"error": str(error)}, 400)

    def send_clip(self, name):
        if Path(name).name != name or not name.lower().endswith(".mp4"):
            raise ValueError("Invalid clip name.")
        file = CLIPS / name
        size = file.stat().st_size
        start, end, status = 0, size - 1, 200
        requested_range = self.headers.get("Range")
        if requested_range:
            match = re.fullmatch(r"bytes=(\d+)-(\d*)", requested_range)
            if not match:
                self.send_headers(416, "video/mp4", 0)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            start, end = int(match[1]), min(int(match[2]), size - 1) if match[2] else size - 1
            if start > end:
                raise ValueError("Invalid video range.")
            status = 206
        self.send_headers(status, "video/mp4", end - start + 1)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Disposition", f"attachment; filename={name}")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with file.open("rb") as source:
            source.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = source.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


def main():
    global BRIDGE_PROCESS
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        open_browser()
        return
    config = {"api": {"listen": "127.0.0.1:1986", "static_dir": str(HERE / "runtime/go2rtc/player")}, "rtsp": {"listen": ""}, "webrtc": {"listen": ""}, "log": {"level": "fatal"}, "streams": {}}
    BRIDGE_PROCESS = subprocess.Popen([str(HERE / "runtime/go2rtc/go2rtc-speed.exe"), "-config", json.dumps(config)], cwd=HERE,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    atexit.register(BRIDGE_PROCESS.terminate)
    for attempt in range(50):
        try: bridge("/api"); break
        except Exception: time.sleep(.1)
    else:
        BRIDGE_PROCESS.terminate()
        raise RuntimeError("The bundled streaming component could not start.")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, open_browser).start()
    try:
        server.serve_forever()
    finally:
        for session in SESSIONS.values():
            session.stop_previews()
            if session.recorder:
                session.recorder.close()
        server.server_close()
        BRIDGE_PROCESS.terminate()


if __name__ == "__main__":
    main()
