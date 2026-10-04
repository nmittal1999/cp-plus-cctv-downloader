import importlib.util
import json
import threading
import urllib.request
import http.cookiejar
from pathlib import Path
import datetime as dt

root=Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0,str(root))
import web_server as w
from tempfile import TemporaryDirectory

class FakeRecorder:
    def __init__(self): self.cameras=[]
    def connect(self,*args):pass
    def discover_cameras(self,*args):
        self.cameras=[{"id":0,"name":"Fetched front door"},{"id":4,"name":"Fetched backyard"}]
        return self.cameras
    def close(self):pass
    def describe(self,url):pass
    def url(self,*args,**kwargs):return 'rtsp://local.test/recorded'

calls=[]
w.Recorder=FakeRecorder
w.bridge=lambda path,method='GET':calls.append((path,method))
w.PORT=8799
w.SESSIONS.clear()
server=w.ThreadingHTTPServer(('127.0.0.1',w.PORT),w.Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
base='http://127.0.0.1:8799'
def get(path):return opener.open(base+path)
state=json.load(get('/api/state'))
assert state['cameras']==[] and not state['connected']
def post(path,payload,token=state['csrf']):
    return opener.open(urllib.request.Request(base+path,json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-CSRF-Token':token,'Origin':base}))
try:post('/api/connect',{},'wrong')
except urllib.error.HTTPError as e:assert e.code==403
else:raise AssertionError('CSRF accepted')
json.load(post('/api/connect',{'address':'test','port':554,'username':'test','password':'test'}))
assert json.load(get('/api/state'))['connected']
assert json.load(get('/api/state'))['cameras'][1]['id']==4
assert json.load(post('/api/cameras-refresh',{}))['cameras'][0]['name']=='Fetched front door'
data={'channel':0,'start':'2026-10-02T12:00:00','end':'2026-10-02T12:00:30'}
preview=json.load(post('/api/preview',data))
assert preview['url'].startswith(w.BRIDGE+'/stream.html?src=preview_')
assert calls[-1][1]=='PATCH' and 'ffmpeg' not in calls[-1][0]
fast_preview=json.load(post('/api/preview',{**data,'speed':4}))
assert 'speed=4' in fast_preview['url'] and '%23scale%3D4.000%23media%3Dvideo' in calls[-1][0]
eight_preview=json.load(post('/api/preview',{**data,'speed':8}))
assert 'speed=8' in eight_preview['url'] and '%23scale%3D8.000%23media%3Dvideo' in calls[-1][0]
try:post('/api/preview',{**data,'speed':100})
except urllib.error.HTTPError as e:assert e.code==400
else:raise AssertionError('Invalid playback speed accepted')
json.load(post('/api/preview-stop',{}))
assert calls[-1][1]=='DELETE'
try:post('/api/preview',{**data,'end':'2026-10-02T11:00:00'})
except urllib.error.HTTPError as e:assert e.code==400
else:raise AssertionError('Invalid time accepted')
with TemporaryDirectory() as tmp:
    w.CLIPS=Path(tmp)
    clip=w.CLIPS/'check.mp4';clip.write_bytes(b'0123456789')
    response=opener.open(urllib.request.Request(base+'/clips/check.mp4',headers={'Range':'bytes=2-5'}))
    assert response.status==206 and response.read()==b'2345'
    (w.CLIPS/'unfinished.working.mp4').write_bytes(b'partial')
    assert [c['name'] for c in w.clip_list()]==['check.mp4']
assert get('/').status==200
json.load(post('/api/disconnect',{}))
assert not json.load(get('/api/state'))['connected']
server.shutdown()
print('PASS: session, login, CSRF rejection, direct bridge preview, stop, invalid intervals, partial-file hiding, range download, disconnect, static page')
