const $=id=>document.getElementById(id);let csrf='',connected=false,previewTimer=null,busy=false,cameraSignature=null;
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(message,error=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').className=error?'error':''}
async function api(path,data){const options=data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data)};const r=await fetch(path,options);const j=await r.json();if(!r.ok)throw Error(j.error||'Something went wrong. Try again.');return j}
function range(){if(!$('camera').value)throw Error('Connect and load the camera list first.');const start=$('date').value+'T'+$('start').value,end=$('end-date').value+'T'+$('end').value;const length=(new Date(end)-new Date(start))/1000;if(!(length>0&&length<=21600))throw Error('Choose a clip between one second and six hours.');return {channel:Number($('camera').value),start,end}}
function lengthLabel(seconds){return seconds<60?`${seconds} seconds`:seconds<3600?`${Math.floor(seconds/60)}m ${seconds%60}s`:`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`}
function updateDuration(){try{const d=range();$('duration').textContent=lengthLabel((new Date(d.end)-new Date(d.start))/1000)}catch(e){$('duration').textContent='Check times'}}
function clearPlayer(){clearTimeout(preparationTimer);$('hover-preview').hidden=true;hoverOffset=null;$('timeline').disabled=true;clearTimeout(previewTimer);$('player').src='about:blank';$('player').hidden=true;$('empty').hidden=false;$('stop').hidden=true;$('preview-state').textContent='Ready when you are';['backward','forward','forward-minute'].forEach(id=>$(id).disabled=true)}
async function refresh(){
 const state=await api('/api/state');csrf=state.csrf;connected=state.connected;
 $('connection').textContent=connected?'Recorder connected':'Disconnected';$('connection').className='badge'+(connected?' connected':'');
 $('view').disabled=!connected||busy||!state.cameras.length;
 $('export').disabled=!connected||busy||!state.cameras.length||false;
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
 if(typeof renderCameraSelection==='function')renderCameraSelection(state.cameras);renderJobs(state.jobs);renderClips(state.clips)
}
function renderJobs(jobs){$('jobs').innerHTML=jobs.filter(j=>j.status!=='complete').reverse().map(j=>`<div class="job"><div><strong>${esc(j.camera)}</strong><p>${esc(j.message)}</p></div>${['working','queued'].includes(j.status)?`<progress aria-label="Export in progress"></progress><button class="quiet" data-cancel="${esc(j.id)}">Cancel export</button>`:''}</div>`).join('');$('jobs').querySelectorAll('[data-cancel]').forEach(b=>b.onclick=async()=>{try{await api('/api/cancel',{id:b.dataset.cancel});await refresh()}catch(e){notice(e.message,true)}})}
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
  if(fresh){previewBounds={...data};resetThumbnailCache();}
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

let thumbGeneration=0,thumbTimer=null,hoverOffset=null,thumbBusy=false;
const thumbCache=new Map();
function cacheThumbnail(offset,value){thumbCache.set(offset,value);updatePreparationStatus();while(thumbCache.size>100){const key=thumbCache.keys().next().value,old=thumbCache.get(key);if(old.startsWith('blob:'))URL.revokeObjectURL(old);thumbCache.delete(key)}}
function resetThumbnailCache(){thumbGeneration++;clearTimeout(preparationTimer);preparedOffsets.clear();clearTimeout(thumbTimer);for(const value of thumbCache.values()){if(value.startsWith('blob:'))URL.revokeObjectURL(value)}thumbCache.clear();hoverOffset=null;$('hover-preview').hidden=true;}
function setHoverImage(source){$('hover-image').src=source;$('hover-image').hidden=false;$('hover-loading').hidden=true;}
function updatePreparationStatus(){const offsets=preparationOffsets(),ready=offsets.filter(n=>thumbCache.has(n)).length;$('thumbnail-status').textContent=prepareEnabled&&previewActive?`Seek previews: ${ready} of ${offsets.length} ready`:'';}
const thumbnailsEnabled=false;let prepareEnabled=false;
// Thumbnails are disabled pending a rework.
$('prepare-thumbnails').checked=false;$('prepare-thumbnails').disabled=true;
$('preferences').onclick=()=>{$('preferences-page').hidden=false;$('preferences-page').scrollIntoView({behavior:'smooth',block:'start'})};
$('preferences-close').onclick=()=>{$('preferences-page').hidden=true};
let preparationTimer=null,preparedOffsets=new Set(),hoverSecond=0;
$('prepare-thumbnails').onchange=()=>{prepareEnabled=$('prepare-thumbnails').checked;try{localStorage.setItem('prepare-thumbnails',String(prepareEnabled))}catch(e){}clearTimeout(preparationTimer);updatePreparationStatus();if(prepareEnabled)startThumbnailPreparation()};
function preparationOffsets(){const duration=Number($('timeline').max),step=Math.max(5,Math.ceil(duration/60/5)*5);const offsets=[];for(let n=0;n<duration;n+=step)offsets.push(n);return offsets}
function startThumbnailPreparation(){updatePreparationStatus();clearTimeout(preparationTimer);if(thumbnailsEnabled&&prepareEnabled&&previewActive)preparationTimer=setTimeout(prepareNextThumbnail,1200)}
async function prepareNextThumbnail(){
 if(!prepareEnabled||!previewActive)return;
 if(thumbBusy||busy){startThumbnailPreparation();return}
 const candidates=preparationOffsets().filter(n=>!thumbCache.has(n)&&!preparedOffsets.has(n));if(hoverOffset!==null)candidates.sort((a,b)=>Math.abs(a-hoverOffset)-Math.abs(b-hoverOffset));const offset=candidates[0];
 if(offset===undefined)return;
 const generation=thumbGeneration;preparedOffsets.add(offset);await loadHoverThumbnail(offset,generation,true);startThumbnailPreparation();
}
async function loadHoverThumbnail(offset,generation,background=false){
 if(!thumbnailsEnabled||thumbBusy||generation!==thumbGeneration||(!background&&hoverOffset!==offset))return;
 thumbBusy=true;const bounds={...previewBounds};
 try{
  const result=await api('/api/thumbnail',{...bounds,offset});
  for(let attempt=0;attempt<40&&generation===thumbGeneration&&previewActive;attempt++){
   const response=await fetch(result.url);
   if(response.status===200){const blob=await response.blob();if(generation!==thumbGeneration)break;const url=URL.createObjectURL(blob);cacheThumbnail(offset,url);if(hoverOffset===offset&&!$('hover-preview').hidden)setHoverImage(url);break}
   if(response.status!==202){if(hoverOffset===offset)$('hover-loading').textContent='Preview unavailable';break}
   await new Promise(resolve=>setTimeout(resolve,400));
  }
 }catch(e){if(hoverOffset===offset)$('hover-loading').textContent='Preview unavailable'}
 finally{thumbBusy=false;if(previewActive&&hoverOffset!==null&&!thumbCache.has(hoverOffset)&&(hoverOffset!==offset||generation!==thumbGeneration))thumbTimer=setTimeout(()=>loadHoverThumbnail(hoverOffset,thumbGeneration),0)}
}
function hoverThumbnail(event){
 if(!thumbnailsEnabled||!previewActive||$('timeline').disabled)return;
 const rect=$('timeline').getBoundingClientRect();const ratio=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
 const duration=Number($('timeline').max),second=Math.min(duration-1,Math.floor(ratio*duration));
 const bucket=Math.floor(second/5)*5;hoverOffset=bucket;hoverSecond=second;
 const panel=$('hover-preview'),container=$('timeline').parentElement.getBoundingClientRect();
 panel.style.left=Math.max(6,Math.min(container.width-206,event.clientX-container.left-100))+'px';panel.hidden=false;
 $('hover-time').textContent=new Date(new Date(previewBounds.start).getTime()+second*1000).toLocaleTimeString();
 if(thumbCache.has(bucket)){setHoverImage(thumbCache.get(bucket));return}
 $('hover-image').hidden=true;$('hover-loading').hidden=false;$('hover-loading').textContent='Loading preview…';
 clearTimeout(thumbTimer);thumbTimer=setTimeout(()=>loadHoverThumbnail(bucket,thumbGeneration),300);
}
$('timeline').addEventListener('pointermove',hoverThumbnail);
$('timeline').addEventListener('pointerleave',()=>{hoverOffset=null;clearTimeout(thumbTimer);$('hover-preview').hidden=true});
window.addEventListener('message',event=>{
 if(!thumbnailsEnabled||event.origin!=='http://127.0.0.1:1986'||event.source!==$('player').contentWindow||event.data?.type!=='clip-thumbnail'||!previewActive)return;
 if(!Number.isFinite(event.data.seconds)||typeof event.data.image!=='string'||!event.data.image.startsWith('data:image/jpeg;base64,')||event.data.image.length>250000)return;
 const elapsed=(segmentStart-new Date(previewBounds.start))/1000+event.data.seconds;
 const bucket=Math.floor(elapsed/5)*5;if(bucket<0||bucket>Number($('timeline').max)||thumbCache.has(bucket))return;
 cacheThumbnail(bucket,event.data.image);
 if(thumbCache.size>100){const key=thumbCache.keys().next().value,value=thumbCache.get(key);if(value.startsWith('blob:'))URL.revokeObjectURL(value);thumbCache.delete(key)}
 if(hoverOffset===bucket&&!$('hover-preview').hidden)setHoverImage(event.data.image);
});

const today=stamp(new Date()).slice(0,10);$('date').value=today;$('end-date').value=today;updateDuration();
