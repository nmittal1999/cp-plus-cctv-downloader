const fs=require('fs'),vm=require('vm'),assert=require('assert');
class Element{constructor(){this.value='1';this.max=30;this.style={};this.children=[];this.queries=new Map();this.contentWindow={postMessage:(message)=>this.messages.push(message)};this.messages=[];this.parentElement={appendChild(){}};this.options=[]}set innerHTML(v){this.html=v}get innerHTML(){return this.html}append(...v){this.children.push(...v)}replaceChildren(){this.children=[]}remove(){this.removed=true}querySelector(q){if(!this.queries.has(q))this.queries.set(q,new Element());return this.queries.get(q)}querySelectorAll(){return this.children.flatMap(l=>l.children.filter(c=>c instanceof Element))}}
const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};const requests=[],listeners=[];let id=0;
let clock=0;const context={performance:{now:()=>clock},setInterval(){},$,document:{querySelector:()=>new Element(),createElement:()=>new Element(),createTextNode:v=>v},window:{addEventListener:(type,fn)=>listeners.push(fn)},esc:String,range:()=>({channel:0,start:'2026-10-02T12:00:00',end:'2026-10-02T12:00:30'}),stamp:d=>d.toISOString().slice(0,19),lengthLabel:String,notice(){},refresh:async()=>{},clearPlayer(){},busy:false,previewActive:false,api:async(path,data)=>{requests.push({path,data});return path==='/api/preview'?{id:'id'+(++id),url:'http://127.0.0.1:1986/stream.html?src=fixture'}:{}},console};
vm.createContext(context);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../web/multi.js'),'utf8'),context);
context.advance=delta=>{clock+=delta};context.report=(tile,data)=>listeners[0]({origin:'http://127.0.0.1:1986',source:tile.frame.contentWindow,data:{type:'clip-position',...data}});
(async()=>{
 await vm.runInContext(`(async()=>{
 const bounds={channel:0,start:'2026-10-02T12:00:00',end:'2026-10-02T12:00:30'};
 const a=makeTile(0,bounds),b=makeTile(4,bounds);await openTile(a);await openTile(b);
 if(!a.frame.src.includes('paused=1')||!b.frame.src.includes('paused=1'))throw Error('Autoplay bypassed startup barrier');
 a.syncReady=true;a.lastReport=performance.now();b.syncReady=false;b.lastReport=performance.now();syncTick();advance(500);syncTick();
 if(groupPosition()!==0||!groupHolding)throw Error('Started before all cameras ready');
 b.syncReady=true;a.lastReport=b.lastReport=performance.now();syncTick();advance(400);a.lastReport=b.lastReport=performance.now();syncTick();
 if(groupHolding||Math.abs(groupPosition()-.4)>.001)throw Error('Common clock failed to advance');
 b.syncReady=false;syncTick();const held=groupPosition();advance(800);syncTick();if(groupPosition()!==held)throw Error('Clock advanced while one camera buffered');
 b.syncReady=true;a.lastReport=b.lastReport=performance.now();syncTick();if(groupHolding)throw Error('Failed to resume group');
 setGroupPlaying(false);const paused=groupPosition();advance(1000);syncTick();if(groupPosition()!==paused)throw Error('Paused clock moved');
 await seekGroup(12);if(a.segmentOffset!==12||b.segmentOffset!==12||groupPlaying)throw Error('Shared paused seek failed');
 setGroupPlaying(true);a.syncReady=b.syncReady=true;a.lastReport=b.lastReport=performance.now();syncTick();advance(2000);syncTick();if(!groupHolding)throw Error('Stale camera reports did not hold group');
 a.node.querySelector('.tile-offset').value=3;a.node.querySelector('.tile-offset').onchange();
 const sent=a.frame.messages.at(-1);if(sent.seconds!==Math.max(0,groupPosition()-a.segmentOffset+3))throw Error('Preroll adjustment not applied');
 report(a,{seconds:3,ready:true,paused:true});if(a.position!==a.segmentOffset)throw Error('Preroll incorrectly counted in shared timeline');
 })()`,context);
 console.log('PASS: startup barrier, shared clock, buffering hold/resume, paused clock, synchronized seek, stale report hold');
})().catch(e=>{console.error(e);process.exitCode=1});
