import json,sys,hashlib,threading,urllib.request
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from recorder_connection import Recorder
methods=[]
class Server(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        methods.append(data['method']);params=data['params']
        if data['method']=='global.login' and not params['password']:
            result={'result':False,'session':'fixture','params':{'encryption':'Default','realm':'test','random':'nonce'}}
        elif data['method']=='global.login':
            h=lambda s:hashlib.md5(s.encode()).hexdigest().upper()
            assert params['password']==h('user:nonce:'+h('user:test:secret'))
            assert data['session']=='fixture'
            result={'result':True,'session':'fixture'}
        elif data['method']=='configManager.getConfig':
            assert params=={'name':'ChannelTitle'} and data['session']=='fixture'
            result={'result':True,'params':{'table':[{'Name':'Actual door'},{'Name':'Actual garage'}]}}
        else:result={'result':True}
        body=json.dumps(result).encode();self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
server=ThreadingHTTPServer(('127.0.0.1',0),Server);threading.Thread(target=server.serve_forever,daemon=True).start()
r=Recorder();r.user='user';r.password='secret'
assert r.rpc_cameras(urllib.request.build_opener(urllib.request.ProxyHandler({})),f'http://127.0.0.1:{server.server_port}')==[{'id':0,'name':'Actual door'},{'id':1,'name':'Actual garage'}]
assert methods==['global.login','global.login','configManager.getConfig','global.logout']
server.shutdown();print('PASS: challenge login, actual-name parsing, read-only config request, session logout')
