import {VideoRTC} from './video-rtc.js';
// The base player handles streaming and browser controls without diagnostic overlays.
class RecordedPlayer extends VideoRTC {
    oninit(){super.oninit();this.video.addEventListener("play",()=>{this.initiallyPaused=false;});}
    play() {
        if(this.initiallyPaused){this.preparing=false;return;}
        if ((this.requestedRate || 1) === 1) return super.play();
        if (this.startBufferTimer) clearInterval(this.startBufferTimer);
        this.preparing = true;
        const started = performance.now();
        const duration = Number(new URLSearchParams(location.search).get('duration')) || 30;
        const target = Math.min(3, Math.max(0.2, duration - 0.3));
        this.startBufferTimer = setInterval(() => {
            const video = this.video;
            const ahead = video.buffered.length ? video.buffered.end(video.buffered.length - 1) - video.currentTime : 0;
            if (ahead >= target || (video.readyState >= 2 && performance.now() - started > 1000)) {
                clearInterval(this.startBufferTimer);
                this.preparing = false;
                video.muted = true;
                video.playbackRate = this.requestedRate;
                super.play();
            }
        }, 100);
    }
}
customElements.define('video-player', RecordedPlayer);
const player = document.createElement('video-player');
const rate=Number(new URLSearchParams(location.search).get('speed')) || 1;
player.requestedRate=[0.5,1,2,4,8].includes(rate)?rate:1;
player.media=player.requestedRate===1?'video,audio':'video';
player.clipDuration=Number(new URLSearchParams(location.search).get('duration'))||30;
player.initiallyPaused=new URLSearchParams(location.search).get('paused')==='1';
player.mode = 'mse';
player.background = true;
player.src = new URL('api/ws?src=' + encodeURIComponent(new URLSearchParams(location.search).get('src') || ''), location.href);
document.body.appendChild(player);
if(new URLSearchParams(location.search).get('muted')==='1')player.video.muted=true;
window.addEventListener('message',event=>{
 if(event.origin!=='http://127.0.0.1:8765'||event.source!==parent||event.data?.type!=='clip-control')return;
 const command=event.data.command;
 if(command==='pause'){player.initiallyPaused=true;if(player.startBufferTimer)clearInterval(player.startBufferTimer);player.preparing=false;player.video.pause();}
 if(command==='play'){player.initiallyPaused=false;player.play();}
 if(command==='mute')player.video.muted=!!event.data.muted;
 if((command==='sync'||command==='align')&&Number.isFinite(event.data.seconds)){
  syncTarget=Math.max(0,event.data.seconds);
  const video=player.video;if(origin===null&&video.buffered.length)origin=video.buffered.start(0);
  if(origin===null)return;
  const target=origin+syncTarget;
  let available=false;for(let i=0;i<video.buffered.length;i++)if(target>=video.buffered.start(i)&&target<video.buffered.end(i))available=true;
  let drift=target-video.currentTime;
  if(available&&Math.abs(drift)>.35){video.currentTime=target;drift=0;}
  if((command==='sync'&&!event.data.playing)||!available){player.initiallyPaused=true;if(player.startBufferTimer)clearInterval(player.startBufferTimer);player.preparing=false;video.pause();}
  else{
   player.initiallyPaused=false;player.preparing=false;if(player.startBufferTimer)clearInterval(player.startBufferTimer);
   video.playbackRate=player.requestedRate*Math.max(.85,Math.min(1.15,1+drift*.3));
   if(video.paused)video.play().catch(()=>{});
  }
 }

});

let origin=null,syncTarget=null;
setInterval(()=>{
 const video=player.video;if(!video)return;
 if(origin===null&&video.buffered.length)origin=video.buffered.start(0);
 const seconds=origin===null?0:Math.max(0,video.currentTime-origin);
 const target=(origin||0)+(syncTarget===null?seconds:syncTarget);
 let ahead=0;for(let i=0;i<video.buffered.length;i++)if(target>=video.buffered.start(i)&&target<video.buffered.end(i))ahead=video.buffered.end(i)-target;
 const ready=origin!==null&&video.readyState>=2&&ahead>=Math.min(.6,Math.max(.05,player.clipDuration-(syncTarget===null?seconds:syncTarget)-.05));
 parent.postMessage({type:'clip-position',seconds,ready,bufferAhead:ahead,
  waiting:player.preparing||video.readyState<3,paused:video.paused&&!player.preparing},'http://127.0.0.1:8765');
},200);

// Thumbnail capture disabled pending a rework.
