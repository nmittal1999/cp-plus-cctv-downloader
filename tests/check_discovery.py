import sys,threading,hashlib,urllib.request
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from recorder_connection import Recorder

class Server(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        auth=self.headers.get('Authorization')
        if not auth:
            self.send_response(401);self.send_header('WWW-Authenticate','Digest realm="test", nonce="fixture", algorithm=MD5, qop="auth"');self.end_headers();return
        fields=urllib.request.parse_keqv_list(urllib.request.parse_http_list(auth[7:]))
        h=lambda s:hashlib.md5(s.encode()).hexdigest()
        expected=h(f"{h('test:test:password')}:fixture:{fields['nc']}:{fields['cnonce']}:auth:{h('GET:'+fields['uri'])}")
        assert fields['response']==expected
        data='table.ChannelTitle[0].Name=Front door\r\ntable.ChannelTitle[4].Name=庭院\r\ntable.ChannelTitle[8].Name=\r\n'.encode()
        self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

server=ThreadingHTTPServer(('127.0.0.1',0),Server);threading.Thread(target=server.serve_forever,daemon=True).start()
r=Recorder();r.address='127.0.0.1';r.user='test';r.password='password'
assert r.discover_cameras(server.server_port)==[{'id':0,'name':'Front door'},{'id':4,'name':'庭院'},{'id':8,'name':'Camera 9'}]
assert Recorder.parse_channel_titles('table.ChannelTitle[2].Name="Renamed garage"\ntable.ChannelTitle[1].Other=value')==[{'id':2,'name':'Renamed garage'}]
server.shutdown()
print('PASS: HTTP Digest authentication, recorder channel IDs, Unicode names, blank name fallback, quoted rename parsing')
