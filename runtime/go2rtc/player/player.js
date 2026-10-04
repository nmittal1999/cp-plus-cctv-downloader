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

let origin=null;
setInterval(()=>{
 if(!player.video || !player.video.buffered.length)return;
 if(origin===null)origin=player.video.buffered.start(0);
 parent.postMessage({type:'clip-position',seconds:Math.max(0,player.video.currentTime-origin),
  waiting:player.preparing||player.video.readyState<3,paused:player.video.paused&&!player.preparing},'http://127.0.0.1:8765');
},500);
