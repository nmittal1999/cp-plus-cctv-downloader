import sys,json,threading,time,urllib.request,urllib.error,http.cookiejar,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import web_server as w
class Recorder:
 def __init__(self):self.cameras=[{'id':i,'name':f'Camera {i+1}'} for i in range(20)]
 def connect(self,*args):pass
 def discover_cameras(self,*args):return self.cameras
 def describe(self,*args):pass
 def url(self,*args,**kwargs):return 'rtsp://fixture/recorded'
 def close(self):pass
w.Recorder=Recorder;calls=[];w.bridge=lambda path,method='GET':calls.append((path,method));w.PORT=8799;w.SESSIONS.clear()
server=w.ThreadingHTTPServer(('127.0.0.1',w.PORT),w.Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));base='http://127.0.0.1:8799'
def get(path):return client.open(base+path)
csrf=json.load(get('/api/state'))['csrf']
def post(path,data):return json.load(client.open(urllib.request.Request(base+path,json.dumps(data).encode(),headers={'Content-Type':'application/json','X-CSRF-Token':csrf,'Origin':base})))
post('/api/connect',{'address':'fixture','port':554,'username':'fixture','password':'fixture'})
data={'channel':0,'start':'2026-10-02T12:00:00','end':'2026-10-02T12:00:30','multi':True}
ids=[post('/api/preview',{**data,'channel':i})['id'] for i in range(16)]
owner=next(iter(w.SESSIONS.values()));assert len(owner.previews)==16 and not any(method=='DELETE' for _,method in calls)
try:post('/api/preview',{**data,'channel':16})
except urllib.error.HTTPError as e:assert e.code==400
else:raise AssertionError('Stream limit not enforced')
post('/api/preview-stop',{'id':ids[3]});assert len(owner.previews)==15 and ids[2] in owner.previews
replacement=post('/api/preview',{**data,'channel':2,'replace_id':ids[2],'speed':8});assert len(owner.previews)==15 and ids[2] not in owner.previews
post('/api/preview-stop',{});assert not owner.previews
assert get('/multi.js').status==200
try:post('/api/thumbnail',{})
except urllib.error.HTTPError as e:assert e.code==410
else:raise AssertionError('Thumbnails enabled')
active=set();maximum=[0];lock=threading.Lock();release=threading.Event()
def export(recorder,channel,start,end,target,cancel,report):
 with lock:active.add(channel);maximum[0]=max(maximum[0],len(active))
 try:
  target.write_bytes(b'fixture')
  while not release.wait(.02):
   if cancel.is_set():raise InterruptedError('Cancelled')
  return 30
 finally:
  with lock:active.remove(channel)
w.export_stream=export
with tempfile.TemporaryDirectory() as folder:
 w.CLIPS=Path(folder)
 jobs=[post('/api/export',{**data,'channel':i}) for i in range(3)]
 time.sleep(.1);assert maximum[0]==2 and owner.jobs[jobs[2]['id']]['status']=='queued'
 post('/api/cancel',{'id':jobs[2]['id']});time.sleep(.3);assert owner.jobs[jobs[2]['id']]['status']=='cancelled'
 post('/api/cancel',{'id':jobs[0]['id']});time.sleep(.1);assert owner.jobs[jobs[0]['id']]['status']=='cancelled' and owner.jobs[jobs[1]['id']]['status']=='working'
 try:post('/api/disconnect',{})
 except urllib.error.HTTPError as e:assert e.code==400
 else:raise AssertionError('Disconnected during export')
 release.set()
 for _ in range(50):
  if owner.jobs[jobs[1]['id']]['status']=='complete':break
  time.sleep(.02)
 assert owner.jobs[jobs[1]['id']]['status']=='complete'
 assert len(list(w.CLIPS.glob('*.mp4')))==2 # completed and cancelled partial
 assert len(w.clip_list())==1
post('/api/disconnect',{});server.shutdown()
print('PASS: 16 concurrent streams, capacity limit, independent stop/replacement, multi assets, thumbnails disabled, bounded exports, queued/active cancellation isolation, disconnect gate, completed/partial files')
