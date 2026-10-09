import { DEFAULTS, TIMBRE_PROFILES, TIMBRE_KEYS, CHANNEL_PROFILES, applyTimbre, applyChannel } from './dsp.js?v=sound-profiles-v1';
const $ = id => document.getElementById(id);
let params = { ...DEFAULTS }, preset = 'patrol', mode = 'file', context, worklet, monitorGain, source, stream, fileBuffer, monoSamples, fileName = '', playing = false, startTime = 0, pausedAt = 0, micPending = false, micEpoch = 0, loadEpoch = 0, worker, exportBusy = false, initPromise, raf;
// A take keeps one seed across audition, comparison, and export. Only source/session changes renew it.
let fileSeed, micSeed, seedCounter=0;
function createTakeSeed(){
  let seed;
  try{const words=new Uint32Array(1);globalThis.crypto?.getRandomValues(words);seed=words[0];}catch{}
  // Non-security fallback for browsers without crypto; never used inside the audio loop.
  return seed || ((Date.now() ^ Math.floor(Math.random()*4294967296) ^ ++seedCounter) >>> 0) || 1;
}
let comparisonWorker, comparisonEpoch=0, comparison=null, comparisonKey='', playEpoch=0, comparisonGain;
let matchEnabled=false, matchTimer, playIntent=false, listenVolume=.8, micTransmitting=false;
const controls = [
  { title: '音色 / TIMBRE', items: [ ['highpass','低频切除',150,800,10,'Hz','厚实','轻薄'], ['lowpass','高频截止',1600,4200,50,'Hz','收窄','明亮'], ['leveler','语音稳幅',0,100,5,'%','关闭','均衡'], ['compression','压缩比例',1,8,.5,':1','自然','紧凑'], ['drive','饱和驱动',1,5,.1,'×','干净','粗粝'], ['emphasis','预加重',0,3,.1,'','柔和','锐利'], ['speaker','喇叭染色',0,6,.5,'dB','平直','共鸣'] ] },
  { title: '信道 / CHANNEL', items: [ ['quality','信号质量',0,100,1,'%','弱 / 衰落','强 / 稳定'], ['noise','底噪强度',0,100,1,'%','安静','嘶声'], ['squelch','静噪门限',0,65,1,'%','开放','严格'] ] }
];
const format = (value, unit) => `${Number.isInteger(value) ? value : value.toFixed(1)}${unit === 'Hz' ? ' Hz' : unit === 'dB' ? ' dB' : unit}`;
for (const group of controls) {
  const section = document.createElement('div'); section.className='control-group';
  const title = document.createElement('div'); title.className='group-label'; title.textContent=group.title; section.append(title);
  for (const [id,label,min,max,step,unit,left,right] of group.items) { const el=document.createElement('div'); el.className='control'; el.innerHTML=`<div class="control-header"><label for="${id}">${label}</label><output id="${id}-value"></output></div><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"><div class="control-hints"><span>${left}</span><span>${right}</span></div>`; section.append(el); el.querySelector('input').addEventListener('input', e=>{params[id]=Number(e.target.value);updateControls();sendParams();}); }
  $(group.title.startsWith('信道')?'rf-controls':'parameter-controls').append(section);
  for(const control of [...section.children]){const input=control.querySelector?.('input');if(input&&['highpass','lowpass','drive','speaker'].includes(input.id))$('common-controls').append(control);}
}
Object.entries(TIMBRE_PROFILES).forEach(([key,p],i)=>{ const b=document.createElement('button'); b.className='preset'; b.dataset.preset=key; b.innerHTML=`<span>0${i+1}</span><div><strong>${p.name}</strong><small>${p.tag}</small></div>`; b.addEventListener('click',()=>applyPreset(key)); $('presets').append(b); });
Object.entries(CHANNEL_PROFILES).forEach(([key,p])=>{const b=document.createElement('button');b.className='rf-choice';b.dataset.channel=key;b.textContent=p.name;b.addEventListener('click',()=>applyRF(key));$('rf-presets').append(b);});
for(let i=0;i<12;i++){const bar=document.createElement('i');bar.style.height=`${5+i*.8}px`;$('signal-bars').append(bar);}
function status(text,error=false){$('status-text').textContent=text;$('status').classList.toggle('error',error);}
function updateSourceUI(){
  $('current-source').textContent=mode==='file'?`文件试听 · ${fileName||'尚未载入'}`:'实时麦克风 · 不录音';
  $('current-source').title=fileName;
  $('mic-transport').hidden=mode!=='mic';$('mic-audition-options').hidden=mode!=='mic';$('mic-quick-stop').disabled=!stream&&!micPending;$('export-panel').hidden=mode!=='file';
  $('file-transport').hidden=mode!=='file';$('file-audition').hidden=mode!=='file';
  document.querySelector('.audition-bar').classList.toggle('mic-audition',mode==='mic');
  $('export').disabled=mode!=='file'||!monoSamples||exportBusy;
  $('export-source').textContent=mode==='mic'?'实时麦克风不录音。切回文件模式后可导出已载入文件。':fileName?`导出文件：${fileName}`:'载入文件后可导出';
  $('match-prepare').disabled=mode!=='file'||!monoSamples;
  $('seek').disabled=mode!=='file'||!fileBuffer;$('vox-threshold-control').hidden=!params.vox;$('voxThreshold').disabled=!params.vox;
  $('audition-state').textContent=mode==='mic'?(stream?`${micTransmitting?'发射中':params.vox?'等待讲话':'按住 PTT 通话'} · 监听${$('monitor').checked?'开':'关'}`:micPending?'等待麦克风权限':'麦克风关闭'):(playIntent?(playing?'正在试听':'更新匹配中…'):(fileBuffer?'已暂停 / 就绪':'载入文件后开始'));
}
function updateControls(){
  for(const id of ['perspective','radio','permit'])$(id).value=params[id];
  $('permit').disabled=params.perspective!=='operator';
  for(const id of ['quality','noise','squelch'])$(id).disabled=params.perspective==='operator';
  $('tailMs').disabled=params.perspective!=='receiver'||params.radio!=='analog';
  document.querySelectorAll('.rf-choice').forEach(e=>{e.disabled=params.perspective==='operator';const selected=Object.entries(CHANNEL_PROFILES[e.dataset.channel].params).every(([key,value])=>params[key]===value);e.classList.toggle('active',selected);e.setAttribute('aria-pressed',selected);});
  $('rf-help').textContent=params.perspective==='operator'?'本机侧音绕过远端 RF，信号设置已保留，切回接收端后生效。':'只改变接收条件，不改变音色、传输模式或通话提示。';
  $('radio-help').textContent=params.radio==='digital'?'数字风格仅模拟弱信号时的帧丢失；强信号不加位深破坏。不是 P25 / DMR 或任何语音编解码器。':'模拟窄带：弱信号会带来噪声与衰落；开台和静噪尾音在下方单独调整。';
  $('radio-screen').textContent=params.radio==='digital'?'DIGITAL-INSPIRED':'ANALOG VOICE';
  $('cue-help').textContent=params.perspective==='operator'?'本机侧音不受远端信号、底噪与静噪影响；许可音非真实品牌音。许可音开启时语音缓冲 90ms，关闭时 24ms。':'接收端没有本机许可音。模拟模式有开台声与可调静噪尾音；数字风格干净关闭。';
  for(const group of controls)for(const [id,,,,,unit] of group.items){$(id).value=params[id];$(`${id}-value`).textContent=format(params[id],unit);}
  for(const id of ['cueLevel','tailMs']){$(id).value=params[id];$(`${id}-value`).textContent=`${params[id]}${id==='tailMs'?' ms':'%'}`;}
  $('output').value=params.output; $('output-value').textContent=`${params.output}%`; $('voxThreshold').value=params.voxThreshold;$('voxThreshold-value').textContent=`${params.voxThreshold} dB`; $('vox').checked=params.vox;
  document.querySelectorAll('input[type=range]').forEach(e=>e.style.setProperty('--fill',`${(e.value-e.min)/(e.max-e.min)*100}%`));
  $('band-screen').textContent=`${params.highpass} — ${params.lowpass} Hz`;
  if(!playing&&!stream)updateSignal(params.quality,false);
  document.querySelectorAll('.preset').forEach(e=>{ const selected=e.dataset.preset===preset;e.classList.toggle('active',selected);e.setAttribute('aria-pressed',selected); });
  $('screen-preset').textContent=TIMBRE_PROFILES[preset].name; $('channel').textContent=`0${Object.keys(TIMBRE_PROFILES).indexOf(preset)+1}`;
  const modified=TIMBRE_KEYS.some(key=>params[key]!==TIMBRE_PROFILES[preset].params[key]);
  $('preset-description').textContent=TIMBRE_PROFILES[preset].description;
  $('preset-state').textContent=modified?'音色已修改':'原始音色';
  $('dry').classList.toggle('selected',params.mix===0);$('dry').setAttribute('aria-pressed',params.mix===0);$('wet').classList.toggle('selected',params.mix===1);$('wet').setAttribute('aria-pressed',params.mix===1);
}
function restartFileForSettings(){
  if(mode!=='file'||matchEnabled||(!playing&&!playIntent))return;
  capturePosition();stopPlayback(false);playFile({resume:true});
}
function settingsNotice(){
  if(mode==='mic'&&stream)$('preset-description').textContent+=' · 通话行为：下次发射生效';
  $('settings-status').textContent=mode==='mic'&&stream?'通话行为将在下次发射生效；持续 VOX 请停顿后再说话。':'文件参数即时生效；麦克风通话行为在下次发射生效。';
}
// Release held PTT without dispatching a stale snapshot before applying the complete patch.
function releaseForSettings(){if(!stream)return;$('ptt').classList.remove('transmitting');$('screen-mode').textContent='MIC / READY';}
function applyPreset(key){
  if(!TIMBRE_PROFILES[key])return;
  releaseForSettings();params=applyTimbre(params,key);preset=key;
  $('ptt').disabled=!stream||params.vox;updateControls();sendParams();settingsNotice();
  status(`已选择：${TIMBRE_PROFILES[key].name}。仅更新人声音色，其他设置与试听位置保留。`);
}
function applyRF(key){
  if(params.perspective==='operator'||!CHANNEL_PROFILES[key])return;
  params=applyChannel(params,key);updateControls();sendParams();
  status(`接收条件：${CHANNEL_PROFILES[key].name}。人声音色与通话提示保持不变。`);
}
function txState(){return mode==='file'?playing:!!stream&&(params.vox||$('ptt').classList.contains('transmitting'));}
function sendParams(){checkComparison();worklet?.port.postMessage({type:'params',params:{...params,vox:mode==='mic'&&params.vox,gateDry:mode==='mic',tx:txState()}});}
function updateSignal(value,carrier){$('quality-screen').textContent=`${Math.round(value)}%`;[...$('signal-bars').children].forEach((e,i)=>e.classList.toggle('on',i<value/100*12));$('carrier-dot').style.opacity=carrier?'1':'.25';$('carrier-text').textContent=carrier?'接收':'待机';}
function meter(data){if(mode==='mic'){micTransmitting=!!data.transmitting;updateSourceUI();}const db=v=>v>1e-5?`${Math.max(-60,20*Math.log10(v)).toFixed(0)}`:'−∞';for(const [id,v]of[['in',data.input],['out',data.output]]){$(`${id}-meter`).style.width=`${Math.max(0,Math.min(100,(20*Math.log10(v+1e-7)+60)/60*100))}%`;$(`${id}-db`).textContent=db(v);}updateSignal(data.signal,(data.transmitting??data.carrier)&&txState());}
async function ensureAudio(){
  if(initPromise)await initPromise;
  if(!context){initPromise=(async()=>{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('浏览器不支持 Web Audio，请使用新版 Chrome、Edge、Firefox 或 Safari。');const c=new AC();try{if(!c.audioWorklet)throw Error('需要 HTTPS 或 localhost，以及支持 AudioWorklet 的浏览器。');await c.audioWorklet.addModule(new URL('./worklet.js?v=sound-profiles-v1',import.meta.url));context=c;monitorGain=c.createGain();monitorGain.gain.value=mode==='mic'?0:listenVolume;monitorGain.connect(c.destination);}catch(e){await c.close();throw e;}})();try{await initPromise;}finally{initPromise=null;}}
  await context.resume();
}
function createProcessor(){worklet?.disconnect();worklet?.port.close();worklet=new AudioWorkletNode(context,'radio-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{seed:mode==='file'?fileSeed:micSeed,params:{...params,vox:mode==='mic'&&params.vox,gateDry:mode==='mic',tx:mode==='file'}}});worklet.connect(monitorGain);const active=worklet;worklet.port.onmessage=({data})=>{if(worklet===active&&data.type==='meter')meter(data);};}
function clearMeters(){meter({input:0,output:0,signal:params.quality,carrier:false});}
function capturePosition(){if(playing&&context)pausedAt=(context.currentTime-startTime)%playbackDuration();}
function stopPlayback(reset=true){++playEpoch;playIntent=false;playing=false;if(source){const old=source,gain=comparisonGain;old.onended=null;if(gain&&context){gain.gain.cancelScheduledValues(context.currentTime);gain.gain.setValueAtTime(gain.gain.value,context.currentTime);gain.gain.linearRampToValueAtTime(0,context.currentTime+.008);old.onended=()=>{old.disconnect();gain.disconnect();};try{old.stop(context.currentTime+.008);}catch{old.disconnect();gain.disconnect();}}else{try{old.stop();}catch{}old.disconnect();}source=null;comparisonGain=null;}if(reset)pausedAt=0;sendParams();$('play').innerHTML='<span>▶</span> 试听';$('stop').disabled=true;$('screen-mode').textContent='FILE / STANDBY';$('playhead').style.display='none';updateTime(pausedAt);updateSourceUI();setTimeout(()=>{if(!playing&&!stream){worklet?.disconnect();worklet?.port.close();worklet=null;clearMeters();}},400);}
function seconds(s){const n=Math.max(0,Math.floor(s));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
function playbackDuration(){return comparison?.duration||fileBuffer?.duration||0;}
function updateTime(time){$('timecode').innerHTML=`${seconds(time)} <i>/ ${seconds(playbackDuration())}</i>`;$('seek').value=playbackDuration()?Math.round(time/playbackDuration()*1000):0;$('seek').style.setProperty('--fill',`${Number($('seek').value)/10}%`);}
async function playFile({resume=false}={}){
  if(mode!=='file'||!fileBuffer)return;
  if(!resume&&(playing||playIntent)){capturePosition();stopPlayback(false);status('试听已暂停。');return;}
  playIntent=true;
  if(matchEnabled&&(!comparison||comparisonKey!==matchKey())){
    $('play').innerHTML='<span>Ⅱ</span> 暂停等待';$('stop').disabled=false;updateSourceUI();
    if(!comparisonWorker)prepareMatch();return;
  }
  const epoch=++playEpoch;
  try{
    await ensureAudio();if(epoch!==playEpoch||!playIntent||mode!=='file'||!fileBuffer)return;
    if(!comparison)createProcessor();else{worklet?.disconnect();worklet?.port.close();worklet=null;clearMeters();}
    const active=context.createBufferSource();source=active;active.buffer=comparison?(params.mix?comparison.wet:comparison.dry):fileBuffer;active.loop=$('loop').checked;
    if(comparison){comparisonGain=context.createGain();comparisonGain.gain.setValueAtTime(0,context.currentTime);comparisonGain.gain.linearRampToValueAtTime(1,context.currentTime+.008);active.connect(comparisonGain);comparisonGain.connect(monitorGain);}else active.connect(worklet);
    monitorGain.gain.setTargetAtTime(listenVolume,context.currentTime,.01);pausedAt=Math.min(pausedAt,Math.max(0,playbackDuration()-.001));playing=true;sendParams();active.start(0,pausedAt);startTime=context.currentTime-pausedAt;
    active.onended=()=>{if(source===active&&playing){stopPlayback();status('试听结束。可以调整参数再试一次。');}};
    $('play').innerHTML='<span>Ⅱ</span> 暂停';$('stop').disabled=false;$('playhead').style.display='block';$('screen-mode').textContent='FILE / RECEIVING';updateSourceUI();status(params.mix?'正在试听电台效果。':'正在试听原声。');
  }catch(e){if(epoch===playEpoch){stopPlayback(false);status(`音频启动失败：${e.message}`,true);}}
}
function setFile(buffer,name){finishExport();cancelComparison();if(mode==='file')stopPlayback();fileBuffer=buffer;fileSeed=createTakeSeed();fileName=name;monoSamples=new Float32Array(buffer.length);for(let ch=0;ch<buffer.numberOfChannels;ch++){const data=buffer.getChannelData(ch);for(let i=0;i<data.length;i++)monoSamples[i]+=data[i]/buffer.numberOfChannels;}$('file-source').classList.add('loaded');$('drop-zone').querySelector('strong').textContent='更换文件';$('file-info').hidden=false;$('file-name').textContent=name;$('file-details').textContent=`${seconds(buffer.duration)} · ${(buffer.sampleRate/1000).toFixed(1)} kHz · ${buffer.numberOfChannels} 声道 → 单声道`;$('wave-empty').hidden=true;$('play').disabled=false;updateSourceUI();updateTime(0);drawWave();status(`已载入 ${name}，可以开始试听。`);}
async function loadFile(file){if(!file||mode!=='file')return;cancelComparison();finishExport();const epoch=++loadEpoch;if(file.size>50*1024*1024){status('文件超过 50 MB。请先裁剪或压缩后再载入。',true);return;}stopPlayback();status('正在本地解码音频…');try{await ensureAudio();const bytes=await file.arrayBuffer();if(epoch!==loadEpoch)return;const buffer=await context.decodeAudioData(bytes);if(epoch!==loadEpoch)return;if(buffer.duration>600)throw Error('音频超过 10 分钟，请先裁剪。');if(!buffer.length)throw Error('音频内容为空。');setFile(buffer,file.name);}catch(e){if(epoch===loadEpoch)status(`无法读取文件：${e.message} 可尝试转换为 WAV 或 MP3。`,true);}finally{$('file-input').value='';}}
function drawWave(){const canvas=$('waveform'),rect=canvas.getBoundingClientRect();if(!rect.width)return;const dpr=window.devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);c.clearRect(0,0,rect.width,rect.height);if(!monoSamples)return;c.strokeStyle='#5272b7';c.lineWidth=1.4;const bins=Math.floor(rect.width/3);for(let b=0;b<bins;b++){const start=Math.floor(b*monoSamples.length/bins),end=Math.max(start+1,Math.floor((b+1)*monoSamples.length/bins));let max=0;for(let i=start;i<Math.min(end,monoSamples.length);i++)max=Math.max(max,Math.abs(monoSamples[i]));const h=Math.max(1,max*rect.height*.43);c.beginPath();c.moveTo(b*3+2,rect.height/2-h);c.lineTo(b*3+2,rect.height/2+h);c.stroke();}}
async function demo(){if(mode!=='file')return;cancelComparison();finishExport();try{const epoch=++loadEpoch;await ensureAudio();if(epoch!==loadEpoch||mode!=='file')return;const rate=context.sampleRate,b=context.createBuffer(1,rate*8,rate),d=b.getChannelData(0);for(let i=0;i<d.length;i++){const t=i/rate,phrase=t%2.2,envelope=Math.min(1,phrase*20)*Math.min(1,Math.max(0,(1.65-phrase)*12)),syllable=.5+.5*Math.sin(t*2*Math.PI*3.7);d[i]=envelope*syllable*(.19*Math.sin(2*Math.PI*170*t)+.11*Math.sin(2*Math.PI*510*t)+.07*Math.sin(2*Math.PI*1190*t));}setFile(b,'测试信号 · 合成语音节奏.wav');status('已载入合成测试信号（非真人语音）。拖入语音可获得更真实的体验。');}catch(e){status(e.message,true);}}
function stopMic(message=true){micTransmitting=false;++micEpoch;micPending=false;stream?.getTracks().forEach(track=>track.stop());stream=null;source?.disconnect();source=null;worklet?.disconnect();worklet?.port.close();worklet=null;if(monitorGain&&context)monitorGain.gain.setValueAtTime(0,context.currentTime);$('monitor').checked=false;$('ptt').classList.remove('transmitting');$('ptt').disabled=true;$('start-mic').disabled=false;$('start-mic').textContent='开启麦克风';$('stop-mic').disabled=true;$('mic-status').textContent='麦克风已关闭';$('screen-mode').textContent=mode==='mic'?'MIC / STANDBY':'FILE / STANDBY';clearMeters();updateSourceUI();if(message)status('已停止所有麦克风音轨，并关闭监听。');}
async function startMic(){if(micPending||stream)return;const epoch=++micEpoch;micPending=true;$('start-mic').disabled=true;$('stop-mic').disabled=false;$('start-mic').textContent='等待麦克风权限…';updateSourceUI();try{if(!window.isSecureContext)throw Error('麦克风需要 HTTPS 或 localhost。');if(!navigator.mediaDevices?.getUserMedia)throw Error('此浏览器不支持麦克风访问。');await ensureAudio();if(epoch!==micEpoch||mode!=='mic')return;const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});if(epoch!==micEpoch||mode!=='mic'){s.getTracks().forEach(t=>t.stop());return;}stream=s;micSeed=createTakeSeed();createProcessor();source=context.createMediaStreamSource(stream);source.connect(worklet);monitorGain.gain.setValueAtTime(0,context.currentTime);$('monitor').checked=false;$('ptt').disabled=params.vox;$('stop-mic').disabled=false;$('mic-status').textContent='麦克风已开启 · 监听关闭';$('start-mic').textContent='麦克风正在使用';$('screen-mode').textContent='MIC / READY';sendParams();updateSourceUI();for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(stream){stopMic(false);status('麦克风连接已断开。检查设备后重新开启。',true);}});status('监听关闭：不会听到语音或开关台声。戴耳机后手动开启「耳机监听」，选 B 电台，再按住 / 松开 PTT。');}catch(e){if(epoch===micEpoch){stopMic(false);const hints={NotAllowedError:'未获得麦克风权限。请在地址栏站点设置中允许访问，然后重试。',NotFoundError:'未找到麦克风。连接设备后重试。',NotReadableError:'麦克风被其他应用占用或无法读取，请检查设备。'};status(hints[e.name]||`麦克风启动失败：${e.message}`,true);}}finally{if(epoch===micEpoch)micPending=false;}}
function switchMode(next){if(mode===next)return;finishExport();cancelComparison();++loadEpoch;if(mode==='file')stopPlayback();else stopMic(false);mode=next;$('match-prepare').disabled=next!=='file';$('file-source').hidden=next!=='file';$('mic-source').hidden=next!=='mic';for(const m of ['file','mic']){$(`${m}-tab`).classList.toggle('active',m===next);$(`${m}-tab`).setAttribute('aria-selected',m===next);$(`${m}-tab`).tabIndex=m===next?0:-1;}$('screen-mode').textContent=next==='file'?'FILE / STANDBY':'MIC / STANDBY';updateSourceUI();settingsNotice();if(next==='file')drawWave();status(next==='mic'?'戴好耳机后，再开启麦克风。':'文件模式就绪。');}
function ptt(pressed){if(!stream||(params.vox&&pressed))return;$('ptt').classList.toggle('transmitting',pressed);$('screen-mode').textContent=pressed?'MIC / TRANSMITTING':'MIC / READY';sendParams();}
function exportWav(){if(mode!=='file'||!monoSamples||exportBusy)return;exportBusy=true;$('export').disabled=true;$('cancel-export').hidden=false;const samples=monoSamples.slice(),name=fileName.replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*]/g,'_');worker=new Worker(new URL('./render-worker.js?v=sound-profiles-v1',import.meta.url),{type:'module'});const current=worker;status('正在本地渲染 0%…');worker.onmessage=({data})=>{if(worker!==current||mode!=='file')return;if(data.error){finishExport();status(`导出失败：${data.error}`,true);}else if(data.buffer){const blob=new Blob([data.buffer],{type:'audio/wav'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${name}-radio.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);finishExport();status('WAV 已生成并交给浏览器下载。使用开始导出时的电台参数，包含 350ms 收尾。');}else status(`正在本地渲染 ${Math.round(data.progress*100)}%…`);};worker.onerror=e=>{if(worker!==current)return;finishExport();status(`导出失败：${e.message}`,true);};worker.postMessage({samples,rate:fileBuffer.sampleRate,seed:fileSeed,params:{...params}},[samples.buffer]);}
function finishExport(){worker?.terminate();worker=null;exportBusy=false;$('export').disabled=mode!=='file'||!monoSamples;$('cancel-export').hidden=true;}
$('file-input').addEventListener('change',e=>loadFile(e.target.files[0]));const zone=$('drop-zone');for(const event of ['dragenter','dragover'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.add('dragging');});for(const event of ['dragleave','drop'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.remove('dragging');});zone.addEventListener('drop',e=>loadFile(e.dataTransfer.files[0]));zone.tabIndex=0;zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file-input').click();}});
$('demo').addEventListener('click',demo);$('play').addEventListener('click',playFile);$('stop').addEventListener('click',()=>{if(comparisonWorker||matchTimer!==undefined){clearMatchJob();comparison=null;comparisonKey='';$('match-status').textContent='匹配待更新 · 按试听继续';}stopPlayback();status('试听已停止。');});$('loop').addEventListener('change',()=>{if(source&&mode==='file')source.loop=$('loop').checked;});$('file-tab').addEventListener('click',()=>switchMode('file'));$('mic-tab').addEventListener('click',()=>switchMode('mic'));document.querySelector('.tabbar').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();switchMode(mode==='file'?'mic':'file');$(`${mode}-tab`).focus();}});$('mic-tab').tabIndex=-1;
$('mic-quick-stop').addEventListener('click',()=>stopMic());$('start-mic').addEventListener('click',startMic);$('stop-mic').addEventListener('click',()=>stopMic());$('monitor').addEventListener('change',()=>{if(!stream){$('monitor').checked=false;status('请先开启麦克风。',true);return;}monitorGain.gain.setTargetAtTime($('monitor').checked?listenVolume:0,context.currentTime,.02);$('mic-status').textContent=`麦克风已开启 · 监听${$('monitor').checked?'开启':'关闭'}`;updateSourceUI();status($('monitor').checked?'监听已开启。请佩戴耳机并保持低音量。':'监听关闭：语音和开关台声均静音，麦克风仍在使用。');});
$('ptt').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();$('ptt').setPointerCapture(e.pointerId);ptt(true);});for(const e of ['pointerup','pointercancel','lostpointercapture'])$('ptt').addEventListener(e,()=>ptt(false));document.addEventListener('keydown',e=>{if(e.code==='Space'&&mode==='mic'&&stream&&!e.repeat&&!['INPUT','TEXTAREA','BUTTON','SELECT','A','SUMMARY'].includes(e.target.tagName)){e.preventDefault();ptt(true);}else if((e.code==='Space'||e.key==='Enter')&&e.target===$('ptt')){e.preventDefault();ptt(true);}});document.addEventListener('keyup',e=>{if(e.code==='Space'||e.key==='Enter')ptt(false);});window.addEventListener('blur',()=>ptt(false));
$('vox').addEventListener('change',()=>{ptt(false);params.vox=$('vox').checked;$('ptt').disabled=!stream||params.vox;updateSourceUI();sendParams();});for(const id of ['perspective','radio','permit'])$(id).addEventListener('change',()=>{releaseForSettings();params[id]=$(id).value;updateControls();sendParams();restartFileForSettings();settingsNotice();status(mode==='file'?'通话行为已更新，试听位置保留。':'通话行为在下次发射生效；持续 VOX 请停顿后再说话。');});for(const id of ['output','voxThreshold','cueLevel','tailMs'])$(id).addEventListener('input',()=>{params[id]=Number($(id).value);updateControls();sendParams();});for(const [id,mix] of [['dry',0],['wet',1]])$(id).addEventListener('click',()=>{const resume=(playing||playIntent)&&!!comparison;if(resume){capturePosition();stopPlayback(false);}params.mix=mix;updateControls();sendParams();if(resume)playFile({resume:true});status(mix?'试听已切换到 B 电台效果。':'试听已切换到 A 原声（未经电台处理）。');});$('reset').addEventListener('click',()=>applyPreset(preset));$('export').addEventListener('click',exportWav);$('cancel-export').addEventListener('click',()=>{finishExport();status('已取消导出。');});

function matchKey(){const {mix,vox,gateDry,voxThreshold,tx,...sound}=params;return JSON.stringify({seed:fileSeed,sound});}
function clearMatchJob(){++comparisonEpoch;if(matchTimer!==undefined){clearTimeout(matchTimer);matchTimer=undefined;}comparisonWorker?.terminate();comparisonWorker=null;}
function cancelComparison(message='匹配关闭 · 原始电平'){
  clearMatchJob();matchEnabled=false;
  const wasReady=!!comparison;comparison=null;comparisonKey='';
  if(wasReady&&mode==='file')stopPlayback(false);
  $('match-off').hidden=true;$('match-prepare').hidden=false;$('match-prepare').disabled=mode!=='file'||!monoSamples;$('match-status').textContent=message;
}
function checkComparison(){
  if(!matchEnabled||!comparisonKey||comparisonKey===matchKey())return;
  const resume=playing||playIntent;capturePosition();clearMatchJob();comparisonKey='';comparison=null;
  stopPlayback(false);playIntent=resume;
  $('match-status').textContent='参数已变化 · 正在自动更新…';
  if(resume){$('play').innerHTML='<span>Ⅱ</span> 暂停等待';$('stop').disabled=false;}updateSourceUI();
  matchTimer=setTimeout(()=>{matchTimer=undefined;if(matchEnabled&&mode==='file')prepareMatch();},180);
}
function prepareMatch(){
  if(mode!=='file'||!monoSamples)return status('请先载入文件。',true);
  const resume=playing||playIntent;capturePosition();clearMatchJob();comparison=null;comparisonKey='';stopPlayback(false);playIntent=resume;matchEnabled=true;
  const epoch=++comparisonEpoch,buffer=fileBuffer,key=matchKey();comparisonKey=key;
  $('match-prepare').hidden=true;$('match-off').hidden=false;$('match-status').textContent='正在更新匹配…';
  if(resume){$('play').innerHTML='<span>Ⅱ</span> 暂停等待';$('stop').disabled=false;}updateSourceUI();
  const current=new Worker(new URL('./comparison-worker.js?v=sound-profiles-v1',import.meta.url),{type:'module'});comparisonWorker=current;
  current.onmessage=({data})=>{
    if(epoch!==comparisonEpoch||mode!=='file'||fileBuffer!==buffer||!matchEnabled)return;
    if(key!==matchKey()){checkComparison();return;}
    current.terminate();comparisonWorker=null;
    if(data.error){stopPlayback(false);cancelComparison(`匹配失败：${data.error}`);return;}
    const make=samples=>{const b=context.createBuffer(1,samples.length,buffer.sampleRate);b.copyToChannel(samples,0);return b;};
    comparison={dry:make(data.dry),wet:make(data.wet),duration:data.wet.length/buffer.sampleRate};
    $('match-status').textContent=`匹配就绪 · A ${(20*Math.log10(data.dryGain)).toFixed(1)} dB / B ${(20*Math.log10(data.wetGain)).toFixed(1)} dB`;
    updateTime(pausedAt);if(playIntent)playFile({resume:true});else updateSourceUI();
  };
  current.onerror=()=>{if(epoch===comparisonEpoch){stopPlayback(false);cancelComparison('匹配失败，请重试。');}};
  const samples=monoSamples.slice();current.postMessage({samples,rate:buffer.sampleRate,seed:fileSeed,params:{...params}},[samples.buffer]);
}
$('match-prepare').addEventListener('click',()=>prepareMatch());
$('match-off').addEventListener('click',()=>{const resume=playing||playIntent;capturePosition();stopPlayback(false);cancelComparison();if(resume)playFile({resume:true});});
$('listen-volume').addEventListener('input',()=>{listenVolume=Number($('listen-volume').value)/100;$('listen-volume-value').textContent=`${Math.round(listenVolume*100)}%`;$('listen-volume').style.setProperty('--fill',`${listenVolume*100}%`);if(context&&monitorGain)monitorGain.gain.setTargetAtTime(mode==='file'||$('monitor').checked?listenVolume:0,context.currentTime,.02);});
$('seek').addEventListener('input',()=>{if(mode!=='file'||!fileBuffer)return;const resume=playing||playIntent,next=Number($('seek').value)/1000*playbackDuration();stopPlayback(false);pausedAt=next;updateTime(pausedAt);if(resume)playFile({resume:true});});

window.addEventListener('resize',drawWave);document.addEventListener('visibilitychange',()=>{if(document.hidden){ptt(false);if(stream||micPending)stopMic();}});window.addEventListener('pagehide',()=>{cancelComparison();stopMic(false);finishExport();context?.close();cancelAnimationFrame(raf);});
function animate(){if(playing&&fileBuffer){const time=(context.currentTime-startTime)%playbackDuration();updateTime(time);$('playhead').style.left=`${time/playbackDuration()*100}%`;}raf=requestAnimationFrame(animate);}updateControls();updateSourceUI();animate();

// Keep keyboard-focused controls below the actual sticky audition area.
if(typeof ResizeObserver!=='undefined'){new ResizeObserver(entries=>{document.documentElement.style.setProperty('--audition-height',`${entries[0].target.getBoundingClientRect().height}px`);}).observe(document.querySelector('.audition-bar'));}
