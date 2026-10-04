const $=id=>document.getElementById(id);let csrf='',connected=false,previewTimer=null,busy=false,cameraSignature=null;
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(message,error=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').className=error?'error':''}
async function api(path,data){const options=data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data)};const r=await fetch(path,options);const j=await r.json();if(!r.ok)throw Error(j.error||'Something went wrong. Try again.');return j}
function range(){if(!$('camera').value)throw Error('Connect and load the camera list first.');const start=$('date').value+'T'+$('start').value,end=$('end-date').value+'T'+$('end').value;const length=(new Date(end)-new Date(start))/1000;if(!(length>0&&length<=21600))throw Error('Choose a clip between one second and six hours.');return {channel:Number($('camera').value),start,end}}
function lengthLabel(seconds){return seconds<60?`${seconds} seconds`:seconds<3600?`${Math.floor(seconds/60)}m ${seconds%60}s`:`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`}
function updateDuration(){try{const d=range();$('duration').textContent=lengthLabel((new Date(d.end)-new Date(d.start))/1000)}catch(e){$('duration').textContent='Check times'}}
function clearPlayer(){$('timeline').disabled=true;clearTimeout(previewTimer);$('player').src='about:blank';$('player').hidden=true;$('empty').hidden=false;$('stop').hidden=true;$('preview-state').textContent='Ready when you are';['backward','forward','forward-minute'].forEach(id=>$(id).disabled=true)}
async function refresh(){
 const state=await api('/api/state');csrf=state.csrf;connected=state.connected;
 $('connection').textContent=connected?'Recorder connected':'Disconnected';$('connection').className='badge'+(connected?' connected':'');
 $('view').disabled=!connected||busy||!state.cameras.length;
 $('export').disabled=!connected||busy||!state.cameras.length||state.jobs.some(j=>j.status==='working');
 $('disconnect').hidden=!connected;$('refresh-cameras').disabled=!connected;
 $('camera-error').hidden=!state.camera_error;$('camera-error').textContent=state.camera_error||'';
 const signature=JSON.stringify(state.cameras);
 if(signature!==cameraSignature){
  const selected=$('camera').value;cameraSignature=signature;$('camera').replaceChildren();
  if(!state.cameras.length){const o=document.createElement('option');o.value='';o.textContent=connected?'Camera list unavailable':'Connect to load cameras';$('camera').append(o)}
  state.cameras.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=`${String(c.id+1).padStart(2,'0')} · ${c.name}`;$('camera').append(o)});
  if(state.cameras.some(c=>String(c.id)===selected))$('camera').value=selected;
  $('camera').disabled=!state.cameras.length;
 }
 renderJobs(state.jobs);renderClips(state.clips)
}
function renderJobs(jobs){$('jobs').innerHTML=jobs.filter(j=>j.status!=='complete').reverse().map(j=>`<div class="job"><div><strong>${esc(j.camera)}</strong><p>${esc(j.message)}</p>${j.status==='working'?'<p>Exporting the selected recording…</p>':''}</div>${j.status==='working'?'<progress aria-label="Export in progress"></progress><button class="quiet" data-cancel>Cancel export</button>':''}</div>`).join('');$('jobs').querySelectorAll('[data-cancel]').forEach(b=>b.onclick=async()=>{try{await api('/api/cancel',{});notice('Cancelling export…')}catch(e){notice(e.message,true)}})}
function renderClips(clips){$('count').textContent=`${clips.length} clip${clips.length===1?'':'s'}`;$('no-clips').hidden=clips.length>0;$('clips').innerHTML=clips.map(c=>`<article class="clip"><div><h3>${esc(c.camera)}</h3><p>${esc(c.date)} · ${esc(c.start)} – ${esc(c.end)}</p><p>${(c.size/1048576).toFixed(1)} MB · MP4</p></div><a href="/clips/${encodeURIComponent(c.name)}" download>Save ↓</a></article>`).join('')}
$('login-form').onsubmit=async e=>{e.preventDefault();$('connect').disabled=true;notice('Connecting to your recorder…');try{const result=await api('/api/connect',Object.fromEntries(new FormData(e.target)));e.target.password.value='';$('login').hidden=true;notice(result.camera_error||'Recorder connected. Camera names loaded from your recorder.',!!result.camera_error);await refresh()}catch(e){notice(e.message,true)}finally{$('connect').disabled=false}};
$('refresh-cameras').onclick=async()=>{try{$('refresh-cameras').disabled=true;notice('Reading camera names from the recorder…');await api('/api/cameras-refresh',{});await refresh();notice('Camera list updated from the recorder.')}catch(e){notice(e.message,true);await refresh()}};
$('settings').onclick=()=>{$('login').hidden=!$('login').hidden};
$('disconnect').onclick=async()=>{try{previewActive=false;clearPlayer();await api('/api/disconnect',{});await refresh();$('login').hidden=false;notice('Recorder disconnected.')}catch(e){notice(e.message,true)}};
let previewBounds=null,segmentStart=null,segmentPosition=0,previewActive=false,previewPaused=false,draggingTimeline=false;
function stamp(date){const pad=v=>String(v).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`}
async function watch(data, fresh=false, paused=false){
 busy=true;$('view').disabled=true;notice('Opening your recording…');
 try{
  if(fresh)previewBounds={...data};
  const speed=Number($('speed').value);clearPlayer();previewActive=false;
  const result=await api('/api/preview',{...data,speed});
  segmentStart=new Date(data.start);segmentPosition=0;previewActive=true;previewPaused=paused;
  $('timeline').max=Math.floor((new Date(previewBounds.end)-new Date(previewBounds.start))/1000);$('timeline').disabled=false;$('timeline').value=Math.floor((segmentStart-new Date(previewBounds.start))/1000);
  $('preview-title').textContent=$('camera').selectedOptions[0].textContent.split(' · ').slice(1).join(' · ');
  $('preview-range').textContent=`${previewBounds.start.replace('T',' · ')} – ${previewBounds.end.replace('T',' · ')}`;
  $('empty').hidden=true;$('player').hidden=false;$('player').src=result.url+(paused?'&paused=1':'');$('stop').hidden=false;
  ['backward','forward','forward-minute'].forEach(id=>$(id).disabled=false);
  $('preview-state').textContent=`Streaming · ${speed}×`;notice('');
 }catch(e){notice(e.message,true)}finally{busy=false;await refresh()}
}
$('view').onclick=()=>{try{watch(range(),true)}catch(e){notice(e.message,true)}};
async function jump(seconds){
 if(!previewActive||busy)return;
 const earliest=new Date(previewBounds.start),end=new Date(previewBounds.end);
 const target=new Date(Math.max(earliest.getTime(),segmentStart.getTime()+(segmentPosition+seconds)*1000));
 if(target>=end){notice('You have reached the end of the selected clip.');return}
 await watch({...previewBounds,start:stamp(target)},false,previewPaused);
}
$('backward').onclick=()=>jump(-10);$('forward').onclick=()=>jump(30);$('forward-minute').onclick=()=>jump(60);
$('speed').onchange=()=>{if(previewActive)jump(0)};
window.addEventListener('message',event=>{
 if(event.origin!=='http://127.0.0.1:1986'||event.source!==$('player').contentWindow||event.data?.type!=='clip-position'||!previewActive)return;
 if(!Number.isFinite(event.data.seconds))return;
 segmentPosition=event.data.seconds;previewPaused=event.data.paused;
 const current=new Date(segmentStart.getTime()+segmentPosition*1000);
 $('position').textContent=current.toLocaleTimeString();
 if(!draggingTimeline){$('timeline').value=Math.floor((current-new Date(previewBounds.start))/1000);$('seek-time').textContent=current.toLocaleTimeString()+' · '+lengthLabel(Number($('timeline').value))+' of '+lengthLabel(Number($('timeline').max));}
 $('preview-state').textContent=event.data.paused?'Paused':event.data.waiting?'Buffering…':`Streaming · ${$('speed').value}×`;
 if(current>=new Date(previewBounds.end)){previewActive=false;clearPlayer();$('preview-state').textContent='Clip finished · View clip to replay';api('/api/preview-stop',{}).catch(()=>{})}
});
$('timeline').oninput=()=>{draggingTimeline=true;const t=new Date(new Date(previewBounds.start).getTime()+Number($('timeline').value)*1000);$('seek-time').textContent=t.toLocaleTimeString()};
$('timeline').onchange=async()=>{if(!previewActive||busy){draggingTimeline=false;return}const offset=Math.min(Number($('timeline').max)-1,Number($('timeline').value));const target=new Date(new Date(previewBounds.start).getTime()+offset*1000);await watch({...previewBounds,start:stamp(target)},false,previewPaused);draggingTimeline=false;};
$('stop').onclick=async()=>{previewActive=false;clearPlayer();await api('/api/preview-stop',{}).catch(e=>notice(e.message,true))};
$('export').onclick=async()=>{busy=true;$('export').disabled=true;try{await api('/api/export',range());notice('Export started. Your MP4 will appear under Your clips.')}catch(e){notice(e.message,true)}finally{busy=false;await refresh()}};
$('quit').onclick=async()=>{try{await api('/api/quit',{});clearPlayer();document.body.innerHTML='<main><h1>App closed.</h1><p>You can close this browser tab. Open Camera Clips to return.</p></main>';clearInterval(poll)}catch(e){notice(e.message,true)}};
['date','end-date','start','end','camera'].forEach(id=>$(id).addEventListener('change',updateDuration));
$('date').addEventListener('change',()=>{$('end-date').value=$('date').value;updateDuration()});
refresh().catch(e=>notice(e.message,true));const poll=setInterval(()=>refresh().catch(()=>{}),2000);

const today=stamp(new Date()).slice(0,10);$('date').value=today;$('end-date').value=today;updateDuration();
