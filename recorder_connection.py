"""Direct RTSP authentication and playback; no vendor SDK or KVMS files."""
import hashlib
import secrets
import socket
import urllib.parse
import urllib.request
import re
import ssl
import json


class Recorder:
    def __init__(self):
        self.address = self.user = self.password = ""
        self.port = 554
        self.cameras = []

    def discover_cameras(self, web_port=80):
        """Read channel titles from the recorder using HTTP Digest authentication."""
        web_port = int(web_port)
        if not 1 <= web_port <= 65535:
            raise ValueError("Choose a valid recorder web port.")
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs): return None
        # This appliance uses its own certificate. The HTTPS handler is scoped to
        # the configured recorder and redirects are refused, including RPC calls.
        bases = ([f"https://{self.address}:443", f"http://{self.address}:80"] if web_port == 80
                 else [f"https://{self.address}:{web_port}", f"http://{self.address}:{web_port}"])
        failures = []
        for base in bases:
            manager = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            manager.add_password(None, base, self.user, self.password)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                urllib.request.HTTPSHandler(context=ssl._create_unverified_context()),
                urllib.request.HTTPDigestAuthHandler(manager))
            try:
                with opener.open(base + "/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle", timeout=6) as response:
                    raw = response.read(1048577)
                if len(raw) > 1048576: raise ValueError("Oversized channel list")
                try: text = raw.decode("utf-8-sig")
                except UnicodeDecodeError: text = raw.decode("gb18030")
                cameras = self.parse_channel_titles(text)
                if not cameras: raise ValueError("Channel-title response had no names")
                self.cameras = cameras
                return cameras
            except Exception as error:
                detail = f"HTTP {error.code}" if isinstance(error, urllib.error.HTTPError) else (str(error) if isinstance(error, ValueError) else type(error).__name__)
                failures.append(f"{urllib.parse.urlsplit(base).scheme.upper()} channel titles: {detail}")
            try:
                cameras = self.rpc_cameras(opener, base)
                self.cameras = cameras
                return cameras
            except Exception as error:
                detail = f"HTTP {error.code}" if isinstance(error, urllib.error.HTTPError) else (str(error) if isinstance(error, ValueError) else type(error).__name__)
                failures.append(f"{urllib.parse.urlsplit(base).scheme.upper()} web API: {detail}")
        raise RuntimeError("Camera discovery failed. " + "; ".join(failures) + ".")

    def rpc_cameras(self, opener, base):
        sequence = 0
        def rpc(method, params=None, session=None, login=False):
            nonlocal sequence
            sequence += 1
            payload = {"method": method, "params": params or {}, "id": sequence}
            if session is not None: payload["session"] = session
            request = urllib.request.Request(base + ("/RPC2_Login" if login else "/RPC2"),
                data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
            with opener.open(request, timeout=6) as response:
                raw = response.read(1048577)
            if len(raw) > 1048576: raise ValueError("Oversized web API response")
            return json.loads(raw)
        challenge = rpc("global.login", {"userName": self.user, "password": "", "clientType": "Web3.0"}, login=True)
        params, session = challenge.get("params", {}), challenge.get("session")
        if params.get("encryption") != "Default" or not session:
            raise ValueError("Unsupported web login challenge")
        md5 = lambda value: hashlib.md5(value.encode("utf-8")).hexdigest().upper()
        hashed = md5(self.user + ":" + params["realm"] + ":" + self.password)
        response = md5(self.user + ":" + params["random"] + ":" + hashed)
        result = rpc("global.login", {"userName": self.user, "password": response, "clientType": "Web3.0",
            "loginType": "Direct", "authorityType": "Default", "passwordType": "Default"}, session, True)
        if not result.get("result"): raise ValueError("Web API login rejected")
        session = result.get("session", session)
        try:
            result = rpc("configManager.getConfig", {"name": "ChannelTitle"}, session)
            if not result.get("result"): raise ValueError("Web API could not read channel titles")
            table = result.get("params", {}).get("table")
            cameras = []
            if isinstance(table, list):
                for index, item in enumerate(table):
                    if isinstance(item, dict) and "Name" in item:
                        cameras.append({"id": index, "name": str(item["Name"]).strip() or f"Camera {index + 1}"})
            if not cameras: raise ValueError("Web API returned no channel names")
            return cameras
        finally:
            try: rpc("global.logout", session=session)
            except Exception: pass

    @staticmethod
    def parse_channel_titles(text):
        cameras = {}
        for line in text.splitlines():
            match = re.fullmatch(r"(?:table\.)?ChannelTitle\[(\d+)\]\.Name=(.*)", line.strip())
            if not match: continue
            channel = int(match[1])
            if not 0 <= channel < 4096: continue
            name = match[2].strip()
            if len(name) >= 2 and name[0] == name[-1] and name[0] in ('"', "'"): name = name[1:-1]
            cameras[channel] = {"id": channel, "name": name or f"Camera {channel + 1}"}
        return [cameras[channel] for channel in sorted(cameras)]

    def url(self, channel, start=None, end=None, credentials=False):
        authority = f"{self.address}:{self.port}"
        if credentials:
            authority = urllib.parse.quote(self.user, safe="") + ":" + urllib.parse.quote(self.password, safe="") + "@" + authority
        if start is None:
            query = f"channel={channel + 1}&subtype=0"
            path = "/cam/realmonitor"
        else:
            query = f"channel={channel + 1}&starttime={start:%Y_%m_%d_%H_%M_%S}&endtime={end:%Y_%m_%d_%H_%M_%S}"
            path = "/cam/playback"
        return f"rtsp://{authority}{path}?{query}"

    @staticmethod
    def read_response(connection):
        response = bytearray()
        while b"\r\n\r\n" not in response:
            part = connection.recv(4096)
            if not part:
                raise RuntimeError("The recorder closed the RTSP connection.")
            response.extend(part)
            if len(response) > 65536:
                raise RuntimeError("The recorder returned an invalid RTSP response.")
        header, body = bytes(response).split(b"\r\n\r\n", 1)
        lines = header.decode("latin1").split("\r\n")
        status = int(lines[0].split()[1])
        headers = {line.split(":", 1)[0].lower(): line.split(":", 1)[1].strip()
                   for line in lines[1:] if ":" in line}
        length = int(headers.get("content-length", 0))
        while len(body) < length:
            part = connection.recv(min(4096, length - len(body)))
            if not part:
                raise RuntimeError("The recorder returned an incomplete stream description.")
            body += part
        return status, headers, body

    def authorization(self, challenge, uri, method="DESCRIBE"):
        if not challenge.lower().startswith("digest "):
            raise RuntimeError("This recorder did not offer RTSP Digest authentication.")
        options = urllib.request.parse_keqv_list(urllib.request.parse_http_list(challenge[7:]))
        algorithm = options.get("algorithm", "MD5").upper()
        if algorithm not in ("MD5", "MD5-SESS", "SHA-256", "SHA-256-SESS"):
            raise RuntimeError("The recorder offered an unsupported RTSP authentication algorithm.")
        def hash_text(text):
            factory = hashlib.sha256 if algorithm.startswith("SHA-256") else hashlib.md5
            return factory(text.encode("utf-8")).hexdigest()
        nonce, realm = options["nonce"], options["realm"]
        cnonce = secrets.token_hex(12)
        ha1 = hash_text(f"{self.user}:{realm}:{self.password}")
        if algorithm.endswith("-SESS"):
            ha1 = hash_text(f"{ha1}:{nonce}:{cnonce}")
        ha2 = hash_text(method + ":" + uri)
        qop = options.get("qop", "")
        if qop and "auth" not in [item.strip() for item in qop.split(",")]:
            raise RuntimeError("The recorder offered an unsupported RTSP authentication mode.")
        response = hash_text(f"{ha1}:{nonce}:00000001:{cnonce}:auth:{ha2}") if qop else hash_text(f"{ha1}:{nonce}:{ha2}")
        def quoted(value):
            return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
        pairs = {"username": self.user, "realm": realm, "nonce": nonce,
                 "uri": uri, "response": response}
        if "opaque" in options:
            pairs["opaque"] = options["opaque"]
        auth = "Digest " + ", ".join(key + "=" + quoted(value) for key, value in pairs.items())
        auth += ", algorithm=" + algorithm
        if qop:
            auth += ', qop=auth, nc=00000001, cnonce=' + quoted(cnonce)
        elif algorithm.endswith("-SESS"):
            auth += ', cnonce=' + quoted(cnonce)
        return auth

    def describe(self, uri):
        with socket.create_connection((self.address, self.port), timeout=8) as connection:
            connection.settimeout(8)
            for sequence in (1, 2):
                request = f"DESCRIBE {uri} RTSP/1.0\r\nCSeq: {sequence}\r\nAccept: application/sdp\r\nUser-Agent: ClipDownloader/2\r\n"
                if sequence == 2:
                    request += "Authorization: " + self.authorization(challenge, uri) + "\r\n"
                connection.sendall((request + "\r\n").encode("utf-8"))
                status, headers, body = self.read_response(connection)
                if status == 401 and sequence == 1:
                    challenge = headers.get("www-authenticate", "")
                    continue
                if status == 401:
                    raise RuntimeError("Recorder login failed. Check the username and password.")
                if status != 200:
                    raise RuntimeError(f"The recorder rejected this stream (RTSP {status}). Recorded RTSP playback may be unavailable for this camera or time.")
                if b"m=video" not in body:
                    raise RuntimeError("The recorder did not return a video stream.")
                return

    def connect(self, address, port, user, password):
        if any(c in address for c in "\r\n/@ "):
            raise ValueError("Enter an IP address or hostname without a URL prefix.")
        self.address, self.port, self.user, self.password = address, port, user, password
        try:
            self.describe(self.url(0))
        except Exception:
            self.close()
            raise
        return

    def close(self):
        self.password = self.user = ""
