// Independent recorded streams, with shared commands and per-camera controls.
const multiTiles=new Map(),selectedCameras=new Set();let multiCameraSignature='',multiEpoch=0,multiBusy=false;
const oldPreview=document.querySelector('.preview');oldPreview.hidden=true;
const gridPanel=document.createElement('section');gridPanel.className='multi-panel';
gridPanel.innerHTML='<div class="card multi-toolbar"><div><h2>Camera views</h2><p class="muted" id="multi-summary">Select cameras to watch together.</p></div><div class="multi-actions"><label class="camera-choice"><input id="sync-cameras" type="checkbox" checked> Keep cameras in sync</label><button id="play-all" class="quiet">Play all</button><button id="pause-all" class="quiet">Pause all</button><button id="stop-all" class="quiet">Stop all</button><label>Speed<select id="multi-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></label><label>Seek all<input id="multi-seek" type="range" min="0" max="30" value="0" step="1" disabled></label><span id="multi-time" class="muted"></span></div><p class="hint">With synchronization enabled, cameras start together and wait together when a stream buffers. Audio plays from one camera at a time.</p></div><div id="multi-grid" class="multi-grid"></div>';
oldPreview.parentElement.appendChild(gridPanel);
function renderCameraSelection(cameras){
 const signature=JSON.stringify(cameras);if(signature===multiCameraSignature)return;multiCameraSignature=signature;
 const available=new Set(cameras.map(c=>c.id));for(const id of selectedCameras)if(!available.has(id))selectedCameras.delete(id);
 if(!selectedCameras.size&&cameras.length)selectedCameras.add(cameras[0].id);
 $('camera-checks').replaceChildren();
 for(const c of cameras){const label=document.createElement('label');label.className='camera-choice';const input=document.createElement('input');input.type='checkbox';input.value=c.id;input.checked=selectedCameras.has(c.id);input.onchange=()=>{if(input.checked)selectedCameras.add(c.id);else selectedCameras.delete(c.id);};label.append(input,document.createTextNode(`${String(c.id+1).padStart(2,'0')} · ${c.name}`));$('camera-checks').append(label)}
}
$('select-all').onclick=()=>{const inputs=[...$('camera-checks').querySelectorAll('input')],all=inputs.every(i=>i.checked);for(const input of inputs){input.checked=!all;if(input.checked)selectedCameras.add(Number(input.value));else selectedCameras.delete(Number(input.value))}};
function selectedRange(){if(!selectedCameras.size)throw Error('Select at least one camera.');const data=range();return {...data,channels:[...selectedCameras]}}
function commandTile(tile,command,extra={}){tile.frame.contentWindow.postMessage({type:'clip-control',command,...extra},'http://127.0.0.1:1986')}
function tileClock(tile,offset){return new Date(new Date(tile.bounds.start).getTime()+offset*1000).toLocaleTimeString()}
function updateMultiSummary(){const live=[...multiTiles.values()].filter(t=>t.id).length;$('multi-summary').textContent=`${live} of ${multiTiles.size} cameras open`;$('multi-seek').disabled=!live;}
function makeTile(channel,bounds){
 const camera=[...$('camera').options].find(o=>Number(o.value)===channel);const title=camera?camera.textContent:`Camera ${channel+1}`;
 const node=document.createElement('article');node.className='card camera-tile';
 node.innerHTML=`<div class="tile-heading"><h2>${esc(title)}</h2><button class="quiet tile-close" aria-label="Close ${esc(title)}">×</button></div><div class="tile-screen"><iframe title="${esc(title)} recorded footage" allow="autoplay; fullscreen" allowfullscreen></iframe></div><div class="tile-controls"><span class="tile-status" role="status">Opening…</span><input class="tile-seek" type="range" min="0" max="${(new Date(bounds.end)-new Date(bounds.start))/1000}" value="0" step="1" aria-label="Seek ${esc(title)}"><span class="tile-time muted"></span><label class="tile-alignment">Early footage (seconds)<input class="tile-offset" type="number" min="0" max="30" step="0.1" value="0" aria-label="Early footage adjustment for ${esc(title)}"></label><p class="hint">If the picture starts before the requested time, enter the difference. Check again after seeking.</p><div class="tile-buttons"><button class="quiet tile-play">Pause</button><button class="quiet tile-audio">Audio</button><button class="quiet tile-retry">Retry</button><button class="quiet tile-save">Save clip</button></div></div>`;
 $('multi-grid').append(node);
 const tile={channel,bounds:{...bounds,channel},node,frame:node.querySelector('iframe'),status:node.querySelector('.tile-status'),seek:node.querySelector('.tile-seek'),time:node.querySelector('.tile-time'),id:null,position:0,segmentOffset:0,recordingLead:0,paused:false,muted:true,version:0,pending:false};multiTiles.set(channel,tile);
 node.querySelector('.tile-close').onclick=async()=>{tile.version++;multiTiles.delete(channel);node.remove();if(tile.id)await api('/api/preview-stop',{id:tile.id}).catch(()=>{});updateMultiSummary()};
 node.querySelector('.tile-play').onclick=()=>{if(syncEnabled){setGroupPlaying(!groupPlaying);return}tile.paused=!tile.paused;commandTile(tile,tile.paused?'pause':'play');node.querySelector('.tile-play').textContent=tile.paused?'Play':'Pause'};
 node.querySelector('.tile-audio').onclick=()=>{const enable=tile.muted;for(const other of multiTiles.values()){other.muted=other!==tile||!enable;commandTile(other,'mute',{muted:other.muted});other.node.querySelector('.tile-audio').textContent=other.muted?'Audio':'Mute'}};
 node.querySelector('.tile-offset').onchange=()=>{
  const value=Number(node.querySelector('.tile-offset').value);if(!Number.isFinite(value)||value<0||value>30){notice('Choose an early-footage adjustment between 0 and 30 seconds.',true);return}
  if(syncEnabled)freezeGroup();tile.recordingLead=value;tile.syncReady=false;
  if(syncEnabled)syncTick();else commandTile(tile,'align',{seconds:Math.max(0,tile.position-tile.segmentOffset+value)});
 };
 node.querySelector('.tile-retry').onclick=()=>openTile(tile,tile.position,tile.paused);
 node.querySelector('.tile-save').onclick=async()=>{try{await api('/api/export',tile.bounds);notice('Clip added to the download queue.');await refresh()}catch(e){notice(e.message,true)}};
 tile.seek.oninput=()=>{tile.dragging=true;tile.time.textContent=tileClock(tile,Number(tile.seek.value))};
 tile.seek.onchange=async()=>{if(syncEnabled){await seekGroup(Number(tile.seek.value));tile.dragging=false;return}await openTile(tile,Number(tile.seek.value),tile.paused);tile.dragging=false};
 return tile;
}
async function openTile(tile,offset=0,paused=false){
 const version=++tile.version,epoch=multiEpoch;tile.pending=true;tile.syncReady=false;tile.lastReport=0;tile.status.textContent='Opening…';
 const length=(new Date(tile.bounds.end)-new Date(tile.bounds.start))/1000;offset=Math.max(0,Math.min(length-1,Math.floor(offset)));
 const start=stamp(new Date(new Date(tile.bounds.start).getTime()+offset*1000));
 try{
  const result=await api('/api/preview',{...tile.bounds,start,speed:Number($('multi-speed').value),multi:true,replace_id:tile.id});
  if(epoch!==multiEpoch||version!==tile.version||multiTiles.get(tile.channel)!==tile){await api('/api/preview-stop',{id:result.id});return}
  tile.id=result.id;tile.segmentOffset=offset;tile.position=offset;tile.paused=paused;tile.seek.value=offset;tile.time.textContent=tileClock(tile,offset);
  tile.frame.src=result.url+'&muted='+(tile.muted?'1':'0')+((paused||syncEnabled)?'&paused=1':'');tile.status.textContent=paused?'Paused':'Buffering…';tile.node.querySelector('.tile-play').textContent=paused?'Play':'Pause';
 }catch(e){if(version===tile.version){tile.id=null;tile.status.textContent=e.message;tile.frame.src='about:blank'}}finally{if(version===tile.version)tile.pending=false;updateMultiSummary()}
}
async function stopMulti(){multiEpoch++;for(const tile of multiTiles.values()){tile.version++;tile.frame.src='about:blank'}multiTiles.clear();$('multi-grid').replaceChildren();await api('/api/preview-stop',{}).catch(()=>{});updateMultiSummary()}
async function limited(tasks,limit=3){let next=0;await Promise.all(Array.from({length:Math.min(limit,tasks.length)},async()=>{while(next<tasks.length){const task=tasks[next++];await task()}}))}
$('view').onclick=async()=>{
 if(multiBusy)return;
 try{const data=selectedRange();if(data.channels.length>16)throw Error('Select up to 16 cameras to view together.');multiBusy=true;busy=true;await stopMulti();groupOffset=0;groupPlaying=true;groupHolding=true;previewActive=false;clearPlayer();$('multi-seek').max=(new Date(data.end)-new Date(data.start))/1000;$('multi-seek').value=0;const tiles=data.channels.map(channel=>makeTile(channel,data));notice('Opening selected cameras…');await limited(tiles.map(tile=>()=>openTile(tile)));notice('');}catch(e){notice(e.message,true)}finally{multiBusy=false;busy=false;await refresh()}
};
$('export').onclick=async()=>{try{const data=selectedRange();busy=true;const errors=[];for(const channel of data.channels){try{await api('/api/export',{...data,channel})}catch(e){errors.push(`Camera ${channel+1}: ${e.message}`)}}notice(errors.length?errors.join('; '):`${data.channels.length} clips added to the download queue.`,!!errors.length)}catch(e){notice(e.message,true)}finally{busy=false;await refresh()}};
$('play-all').onclick=()=>{if(syncEnabled){setGroupPlaying(true);return}for(const tile of multiTiles.values()){tile.paused=false;commandTile(tile,'play')}};
$('pause-all').onclick=()=>{if(syncEnabled){setGroupPlaying(false);return}for(const tile of multiTiles.values()){tile.paused=true;commandTile(tile,'pause')}};
$('stop-all').onclick=()=>stopMulti();
$('multi-speed').onchange=()=>{if(syncEnabled)return seekGroup(multiTiles.size?Math.min(...[...multiTiles.values()].map(t=>t.position)):0);return limited([...multiTiles.values()].map(tile=>()=>openTile(tile,tile.position,tile.paused)))};
$('multi-seek').oninput=()=>{groupDragging=true;$('multi-time').textContent=lengthLabel(Number($('multi-seek').value))};
$('multi-seek').onchange=()=>{groupDragging=false;const offset=Number($('multi-seek').value);if(syncEnabled)return seekGroup(offset);return limited([...multiTiles.values()].map(tile=>()=>openTile(tile,offset,tile.paused)))};
window.addEventListener('message',event=>{
 if(event.origin!=='http://127.0.0.1:1986'||event.data?.type!=='clip-position'||!Number.isFinite(event.data.seconds))return;
 const tile=[...multiTiles.values()].find(t=>t.frame.contentWindow===event.source);if(!tile||tile.pending)return;
 tile.position=Math.max(0,tile.segmentOffset+event.data.seconds-tile.recordingLead);tile.paused=event.data.paused;tile.syncReady=event.data.ready===true;tile.lastReport=performance.now();
 if(!tile.dragging){tile.seek.value=Math.floor(tile.position);tile.time.textContent=tileClock(tile,tile.position)}
 tile.status.textContent=syncEnabled&&groupPlaying&&groupHolding?'Waiting for cameras…':tile.paused?'Paused':event.data.waiting?'Buffering…':`Playing · ${$('multi-speed').value}×`;
 tile.node.querySelector('.tile-play').textContent=tile.paused?'Play':'Pause';
 if(tile.position>=Number(tile.seek.max)){commandTile(tile,'pause');tile.status.textContent='Clip finished';if(tile.id){api('/api/preview-stop',{id:tile.id}).catch(()=>{});tile.id=null;updateMultiSummary()}}
});
const previousDisconnect=$('disconnect').onclick;$('disconnect').onclick=async()=>{await stopMulti();await previousDisconnect()};

let syncEnabled=true,groupOffset=0,groupAnchor=performance.now(),groupPlaying=true,groupHolding=true,syncLoading=false,groupDragging=false;
function groupPosition(){return groupOffset+(groupPlaying&&!groupHolding?(performance.now()-groupAnchor)/1000*Number($('multi-speed').value):0)}
function freezeGroup(){groupOffset=groupPosition();groupAnchor=performance.now();groupHolding=true;}
function setGroupPlaying(playing){freezeGroup();groupPlaying=playing;for(const tile of multiTiles.values()){tile.paused=!playing;tile.node.querySelector('.tile-play').textContent=playing?'Pause':'Play'}syncTick();}
async function seekGroup(offset){
 freezeGroup();syncLoading=true;const duration=Number($('multi-seek').max);groupOffset=Math.max(0,Math.min(duration-1,Math.floor(offset)));
 try{await limited([...multiTiles.values()].map(tile=>()=>openTile(tile,groupOffset,!groupPlaying)))}finally{syncLoading=false;groupAnchor=performance.now();syncTick()}
}
$('sync-cameras').onchange=()=>{syncEnabled=$('sync-cameras').checked;if(syncEnabled){groupOffset=multiTiles.size?Math.min(...[...multiTiles.values()].map(t=>t.position)):0;seekGroup(groupOffset)}else{for(const tile of multiTiles.values())commandTile(tile,groupPlaying?'play':'pause')}};
function syncTick(){
 if(!syncEnabled||!multiTiles.size)return;
 const tiles=[...multiTiles.values()].filter(t=>t.id||t.pending);
 if(!tiles.length)return;
 const now=performance.now(),ready=!multiBusy&&!syncLoading&&tiles.every(t=>!t.pending&&t.syncReady&&now-t.lastReport<1500);
 if(!ready&&!groupHolding)freezeGroup();
 if(ready&&groupHolding&&groupPlaying){groupAnchor=now;groupHolding=false;}
 const position=groupPosition();
 for(const tile of tiles)if(!tile.pending)commandTile(tile,'sync',{seconds:Math.max(0,position-tile.segmentOffset+tile.recordingLead),playing:groupPlaying&&!groupHolding});
 if(!syncLoading&&!groupDragging){$('multi-seek').value=Math.floor(position);$('multi-time').textContent=lengthLabel(Math.floor(position))+(groupPlaying?(groupHolding?' · Waiting for cameras…':' · In sync'):' · Paused')}
}
setInterval(syncTick,200);
