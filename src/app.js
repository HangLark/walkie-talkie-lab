import { DEFAULTS, TIMBRE_PROFILES, TIMBRE_KEYS, CHANNEL_PROFILES, applyTimbre, applyChannel } from './dsp.js?v=fm-file-ptt-v5';
import { OUTPUT_FADE_SECONDS, outputFadeSamples } from './output-boundary.js?v=fm-file-ptt-v5';
const $ = id => document.getElementById(id);
let params = { ...DEFAULTS }, preset = 'patrol', mode = 'file', context, worklet, monitorGain, source, stream, fileBuffer, monoSamples, fileName = '', playing = false, startTime = 0, pausedAt = 0, micPending = false, micEpoch = 0, loadEpoch = 0, worker, exportBusy = false, initPromise, raf;
// A take keeps one seed across audition, comparison, and export. Only source/session changes renew it.
let fileSeed, micSeed, seedCounter=0, demoController;
function createTakeSeed(){
  let seed;
  try{const words=new Uint32Array(1);globalThis.crypto?.getRandomValues(words);seed=words[0];}catch{}
  // Non-security fallback for browsers without crypto; never used inside the audio loop.
  return seed || ((Date.now() ^ Math.floor(Math.random()*4294967296) ^ ++seedCounter) >>> 0) || 1;
}
let calibrationWorker,calibrationBusy=false,calibrationUndo=null,txGainRevision=0;
let comparisonWorker, comparisonEpoch=0, comparison=null, comparisonKey='', playEpoch=0, comparisonGain, playbackSession;
let matchEnabled=false, matchTimer, playIntent=false, listenVolume=.8, micTransmitting=false;
let fileDraining=false;
const controls = [
  { title: '语音链路 / 未校准参数', items: [ ['highpass','低频切除',150,800,10,'Hz','厚实','轻薄'], ['lowpass','高频截止',1600,4200,50,'Hz','收窄','明亮'], ['leveler','输入稳幅辅助',0,100,5,'%','关闭','均衡'], ['compression','压缩比例',1,8,.5,':1','自然','紧凑'], ['drive','饱和驱动',1,5,.05,'×','干净','粗粝'], ['emphasis','预加重',0,3,.1,'','柔和','锐利'], ['speaker','输出共振 EQ',0,6,.1,'dB','平直','共鸣'] ] },
  { title: '信道 / CHANNEL', items: [ ['quality','相对信号质量',0,100,1,'%','低 C/N','高 C/N'], ['noise','底噪强度',0,100,1,'%','安静','嘶声'], ['squelch','相对静噪门限',0,65,1,'%','宽松','严格'] ] }
];
const cnrLabel=quality=>quality>=99.999?'无噪声':`${(-8+.48*quality).toFixed(1)} dB`;
const format = (value, unit) => `${Number.isInteger(value) ? value : Number(value.toFixed(2))}${unit === 'Hz' ? ' Hz' : unit === 'dB' ? ' dB' : unit}`;
for (const group of controls) {
  const section = document.createElement('div'); section.className='control-group';
  const title = document.createElement('div'); title.className='group-label'; title.textContent=group.title; section.append(title);
  for (const [id,label,min,max,step,unit,left,right] of group.items) { const el=document.createElement('div'); el.className='control'; el.innerHTML=`<div class="control-header"><label id="${id}-label" for="${id}">${label}</label><output id="${id}-value"></output></div><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"><div class="control-hints"><span>${left}</span><span>${right}</span></div>`; section.append(el); el.querySelector('input').addEventListener('input', e=>{params[id]=Number(e.target.value);updateControls();sendParams();}); }
  $(group.title.startsWith('信道')?'rf-controls':'parameter-controls').append(section);

}
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
  $('match-prepare').disabled=mode!=='file'||!monoSamples;updateCalibrationControls();
  $('seek').disabled=mode!=='file'||!fileBuffer;$('vox-threshold-control').hidden=!params.vox;$('voxThreshold').disabled=!params.vox;
  $('audition-state').textContent=mode==='mic'?(stream?`${micTransmitting?'发射中':params.vox?'等待讲话':'按住 PTT 通话'} · 监听${$('monitor').checked?'开':'关'}`:micPending?'等待麦克风权限':'麦克风关闭'):(playIntent?(playing?'正在试听':'更新匹配中…'):(fileDraining?'接收收尾 · 350 ms':fileBuffer?'已暂停 / 就绪':'载入文件后开始'));
}
function updateCalibrationControls(){const available=mode==='file'&&!!monoSamples&&params.radio==='analog'&&params.perspective==='receiver';$('calibrate-input').disabled=!available||calibrationBusy;$('cancel-calibration').hidden=!calibrationBusy;$('undo-calibration').hidden=!calibrationUndo||calibrationUndo.seed!==fileSeed;$('undo-calibration').disabled=!available||calibrationBusy;}
function cancelInputCalibration(clearUndo=false){calibrationWorker?.terminate();calibrationWorker=null;calibrationBusy=false;if(clearUndo)calibrationUndo=null;updateCalibrationControls();}
function updateControls(){
  updateCalibrationControls();
  const analogReceiver=params.perspective==='receiver'&&params.radio==='analog';
  $('baseline-label').textContent=analogReceiver?'窄带 FM 实验模型 · 300–3000 Hz 标称':params.perspective==='operator'?'本机侧音 · 音频近似':'数字式丢帧演示 · 无声码器';
  for(const id of ['perspective','radio','permit'])$(id).value=params[id];
  $('permit').disabled=params.perspective!=='operator';
  for(const id of ['quality','noise','squelch'])$(id).disabled=params.perspective==='operator';
  for(const id of ['highpass','lowpass','drive','compression','emphasis','leveler'])$(id).disabled=analogReceiver;
  $('noise').disabled=params.perspective==='operator'||analogReceiver;
  $('fm-propagation').value=params.fmPropagation||'static';$('fm-propagation').disabled=!analogReceiver;
  $('propagation-help').textContent=!analogReceiver?'传播模型仅用于模拟 FM 接收；当前路径绕过此设置。':params.fmPropagation==='moving'?'复基带 Rician 平坦衰落示意：K=4、最大多普勒 2 Hz、32 条散射分量。滑块设定平均 C/N；屏幕信号条显示实时瞬时模型 C/N，不是 RSSI。不代表真实路线。强接收仍可能清晰；可选“临界 C/N”观察衰落。暂停收尾内快速续播保留该段信道状态；收尾后续播或跳转会重启该段信道状态。':'固定接收仍包含所选 C/N 的加性噪声。移动模式在 FM 鉴频前加入时变复增益，不是人声音色预设。';
  $('channel-state').hidden=!analogReceiver||params.fmPropagation!=='moving';
  if(analogReceiver&&params.fmPropagation==='moving')$('channel-state').textContent='开始试听后显示瞬时模型 C/N。';
  $('fm-monitor').value=params.fmMonitor?'open':'auto';$('fm-monitor').disabled=!analogReceiver;
  $('squelch').disabled=params.perspective==='operator'||(analogReceiver&&params.fmMonitor);
  $('fm-monitor-help').textContent=analogReceiver?(params.fmMonitor?'关闭自动静噪：仅在通话试听与有限收尾内放行弱信号及噪声；待机保持安静。先降低试听音量。':'自动检测载波与噪声，弱信号可能被静音；不保证每次都有开关台噪声。关闭自动静噪仅用于通话试听；请先降低试听音量。'):'仅用于模拟 FM 接收；此设置不会启动播放、麦克风或耳机监听。';
  $('cueLevel').disabled=params.perspective!=='operator';
  $('txInputGainDb').disabled=!analogReceiver;$('txInputGainDb').value=params.txInputGainDb??0;$('txInputGainDb-value').textContent=`${(params.txInputGainDb??0)>0?'+':''}${(params.txInputGainDb??0).toFixed(2)} dB`;
  $('tx-mic-agc').disabled=!analogReceiver;$('tx-mic-agc').checked=!!params.txMicAgc;
  if(!analogReceiver){$('tx-deviation-value').textContent='—';$('tx-deviation-meter').style.width='0%';$('tx-deviation-help').textContent='当前路径不使用 FM 发射频偏';}
  $('tx-input-help').textContent=analogReceiver?'仅作用于 FM 发射端的数字输入。0 dB 不额外放大；原声 A 不变。AGC 校正限于 −12 / +6 dB，目标与时序为未校准假设。':'发射输入增益与 AGC 仅用于模拟 FM；当前路径不使用这些设置。';
  $('parameter-help').textContent=analogReceiver?'FM 接收使用固定带限、750 µs 加重与 ±2.5 kHz 限幅。灰色旧参数不参与此路径；发射输入在输入源面板调整。输出 EQ 是可选辅助，默认关闭。':'本机侧音与数字式演示沿用音频近似链路，未模拟真实设备或数字声码器。';
  $('tailMs').disabled=!analogReceiver;
  $('tailGainDb').disabled=!analogReceiver;$('tailGainDb').value=params.tailGainDb??0;$('tailGainDb-value').textContent=`${params.tailGainDb??0} dB`;
  $('tail-gain-help').textContent=analogReceiver?'额外音量处理：0 dB 不衰减；仅在发射载波及缓冲人声排空后降低尾噪，不改变静噪检测或尾音时长。':'仅作用于模拟 FM 接收尾噪；当前路径不使用此设置。';
  document.querySelectorAll('.rf-choice').forEach(e=>{e.disabled=params.perspective==='operator';const selected=Object.entries(CHANNEL_PROFILES[e.dataset.channel].params).every(([key,value])=>params[key]===value);e.classList.toggle('active',selected);e.setAttribute('aria-pressed',selected);});
  $('rf-help').textContent=params.perspective==='operator'?'本机侧音绕过远端 RF，信号设置已保留，切回接收端后生效。':analogReceiver?`${params.fmPropagation==='moving'?'平均模型':'模型'} C/N：${params.quality===100?'无噪声极限':(-8+.48*params.quality).toFixed(1)+' dB'}（接收滤波器内）。不是 RSSI / SINAD 或距离；底噪由 FM 信道产生，静噪检测解调高频噪声。`:'数字式演示的相对控制量，不是 RSSI / SINAD 或距离测量。';
  $('radio-help').textContent=params.perspective==='operator'?'本机侧音使用音频近似，不经过远端 FM 信道；模式选择保留供返回接收端使用。':params.radio==='digital'?'数字风格仅模拟弱信号时的帧丢失；强信号不加位深破坏。不是 P25 / DMR 或任何语音编解码器。':'实验性窄带 FM：复基带调制、加噪、接收滤波与鉴频。±2.5 kHz 频偏 / 750 µs 加重。机制已测试，尚未用配对设备录音校准。';
  $('radio-screen').textContent=params.perspective==='operator'?'LOCAL AUDIO APPROX.':params.radio==='digital'?'NO VOCODER':'FM BASEBAND / EXP.';
  $('cue-help').textContent=params.perspective==='operator'?'本机侧音不受远端信号、底噪与静噪影响；许可音非真实品牌音。许可音开启时语音缓冲 90ms，关闭时 24ms。':analogReceiver?'接收端没有本机许可音。自动静噪可能截去刚按 PTT 就说的开头；不额外补噪。尾音上限用于通话结束后的有限收尾。':'数字式接收没有本机许可音，也没有模拟静噪尾音；不包含真实声码器。';
  for(const group of controls)for(const [id,,,,,unit] of group.items){$(id).value=params[id];$(`${id}-value`).textContent=format(params[id],unit);}
  $('quality-label').textContent=analogReceiver?(params.fmPropagation==='moving'?'平均载噪比 C/N':'信道载噪比 C/N'):'相对信号质量';
  if(analogReceiver)$('quality-value').textContent=cnrLabel(params.quality);
  $('quality').setAttribute('aria-valuetext',analogReceiver?`${cnrLabel(params.quality)} 模型载噪比`:`${params.quality}% 相对信号质量`);
  for(const id of ['cueLevel','tailMs']){$(id).value=params[id];$(`${id}-value`).textContent=`${params[id]}${id==='tailMs'?' ms':'%'}`;}
  $('output').value=params.output; $('output-value').textContent=`${params.output}%`; $('voxThreshold').value=params.voxThreshold;$('voxThreshold-value').textContent=`${params.voxThreshold} dB`; $('vox').checked=params.vox;
  document.querySelectorAll('input[type=range]').forEach(e=>e.style.setProperty('--fill',`${(e.value-e.min)/(e.max-e.min)*100}%`));
  $('band-screen').textContent=analogReceiver?'300 — 3000 Hz · 固定':`${params.highpass} — ${params.lowpass} Hz`;
  updateSignal(params.quality,false);
  document.querySelectorAll('.preset').forEach(e=>{ const selected=e.dataset.preset===preset;e.classList.toggle('active',selected);e.setAttribute('aria-pressed',selected); });
  $('screen-preset').textContent=params.perspective==='operator'?'本机侧音':params.radio==='digital'?'数字式接收近似':'实验性 FM 接收'; $('channel').textContent=params.perspective==='operator'?'LOCAL':'RX';
  const modified=TIMBRE_KEYS.some(key=>params[key]!==TIMBRE_PROFILES[preset].params[key]);
  $('preset-description').textContent=analogReceiver?'通用窄带 FM 线路输出：默认输入增益 0 dB、AGC 与输出 EQ 关闭，不代表特定手台或喇叭。':'音频近似辅助路径，不代表真实设备。数字式演示没有声码器。';
  $('preset-state').textContent=modified?'基线已调整 · 未校准':'默认基线 · 未校准';
  $('dry').classList.toggle('selected',params.mix===0);$('dry').setAttribute('aria-pressed',params.mix===0);$('wet').classList.toggle('selected',params.mix===1);$('wet').setAttribute('aria-pressed',params.mix===1);
}
function restartFileForSettings(){
  if(mode!=='file'||matchEnabled||(!playing&&!playIntent))return;
  capturePosition();stopPlayback(false);playFile({resume:true});
}
function settingsNotice(){
  if(mode==='mic'&&stream)$('preset-description').textContent+=' · 通话行为：当前通话结束后生效';
  $('settings-status').textContent=mode==='mic'&&stream?'通话行为在当前通话收尾后生效；持续 VOX 请停顿后再说话。':'文件参数即时生效；麦克风通话行为在当前通话收尾后生效。';
}
// Release held PTT without dispatching a stale snapshot before applying the complete patch.
function releaseForSettings(){if(!stream)return;$('ptt').classList.remove('transmitting');$('screen-mode').textContent='MIC / READY';}
function applyPreset(key){
  if(!TIMBRE_PROFILES[key])return;
  releaseForSettings();params=applyTimbre(params,key);preset=key;
  $('ptt').disabled=!stream||params.vox;updateControls();sendParams();settingsNotice();
  status('语音链路已恢复默认基线。接收、通话设置与试听位置保留；基线尚未校准。');
}
function applyRF(key){
  if(params.perspective==='operator'||!CHANNEL_PROFILES[key])return;
  params=applyChannel(params,key);updateControls();sendParams();
  status(`接收条件：${CHANNEL_PROFILES[key].name}。人声音色与通话提示保持不变。`);
}
function txState(){return mode==='file'?playing:!!stream&&(params.vox||$('ptt').classList.contains('transmitting'));}
function receiverActive(){return mode==='file'?(playing||fileDraining)&&!comparison:!!stream&&$('monitor').checked;}
function sendParams(){checkComparison();worklet?.port.postMessage({type:'params',params:{...params,receiverActive:receiverActive(),vox:mode==='mic'&&params.vox,gateDry:mode==='mic',tx:txState()}});}
function updateSignal(value,carrier,instantCnrDb){
  const local=params.perspective==='operator',analog=!local&&params.radio==='analog',moving=analog&&params.fmPropagation==='moving';
  const validInstant=Number.isFinite(instantCnrDb)||instantCnrDb===Infinity;
  const level=moving?(validInstant?(instantCnrDb===Infinity?100:Math.max(0,Math.min(100,(instantCnrDb+8)/.48))):0):value;
  $('quality-screen').textContent=local?'—':moving?(validInstant?(instantCnrDb===Infinity?'无噪声':`${instantCnrDb.toFixed(1)} dB`):'—'):analog?cnrLabel(value):`${Math.round(value)}%`;
  $('rf-meter-label').textContent=moving?'LIVE C/N':analog?'MODEL C/N':'RELATIVE RF';
  $('signal-bars').setAttribute('aria-label',local?'本机侧音不经过远端 RF':moving?'瞬时模型载噪比，非实测 RSSI':analog?'模型载噪比，非实测 RSSI':'模型相对信号质量，非实测');
  [...$('signal-bars').children].forEach((e,i)=>e.classList.toggle('on',!local&&i<level/100*12));
  $('carrier-dot').style.opacity=carrier?'1':'.25';$('carrier-text').textContent=carrier?(local?'侧音':'接收'):'待机';
}

function meter(data){
  if(mode==='mic'){micTransmitting=!!data.transmitting;updateSourceUI();}
  const db=v=>v>1e-5?`${Math.max(-60,20*Math.log10(v)).toFixed(0)}`:'−∞';
  for(const [id,v]of[['in',data.input],['out',data.output]]){$(`${id}-meter`).style.width=`${Math.max(0,Math.min(100,(20*Math.log10(v+1e-7)+60)/60*100))}%`;$(`${id}-db`).textContent=db(v);}
  const transmitting=!!data.transmitting&&txState(),analog=params.perspective==='receiver'&&params.radio==='analog';
  const open=analog?(data.fmRxOpen??data.carrier):data.carrier;
  const pendingPath=(data.activePerspective!==undefined&&data.activePerspective!==params.perspective)||(data.activeRadio!==undefined&&data.activeRadio!==params.radio);
  const listening=analog&&receiverActive()&&!comparison,manualOpen=listening&&open&&(data.fmMonitorActive??params.fmMonitor);
  const deviationLive=analog&&transmitting&&!comparison&&!pendingPath&&Number.isFinite(data.txDeviationPeakHz);
  $('tx-deviation-value').textContent=deviationLive?`${(data.txDeviationPeakHz/1000).toFixed(2)} kHz`:'—';
  $('tx-deviation-meter').style.width=`${deviationLive?Math.max(0,Math.min(100,data.txDeviationPeakHz/2500*100)):0}%`;
  $('tx-deviation-help').textContent=comparison?'匹配快照 · 无实时频偏读数':!analog?'当前路径不使用 FM 发射频偏':deviationLive?'报告窗口内实际峰值 · 模型上限 ±2.50 kHz':'开始试听或发射后显示 · 上限 ±2.50 kHz';
  if(analog&&params.fmPropagation==='moving')$('channel-state').textContent=pendingPath?'接收路径待切换 · 无此路径的实时信道读数':comparison?'匹配快照 · 无实时信道读数':transmitting?(data.fmInstantCnrDb===Infinity?'瞬时模型 C/N：无噪声':Number.isFinite(data.fmInstantCnrDb)?`瞬时模型 C/N：${data.fmInstantCnrDb.toFixed(1)} dB`:'等待瞬时信道读数'):'开始试听或发射后显示瞬时模型 C/N。';
  updateSignal(data.signal,!pendingPath&&transmitting&&(params.perspective==='operator'||open),transmitting&&!comparison&&!pendingPath?data.fmInstantCnrDb:undefined);
  if(comparison){$('carrier-text').textContent='快照';$('receiver-status').textContent='电平匹配快照 · 无实时接收状态';}
  else if(pendingPath){$('carrier-text').textContent='待切换';$('receiver-status').textContent='接收路径待切换 · 当前通话结束后切换；当前仍使用上一通话路径。';}
  else if(analog&&!listening){$('carrier-text').textContent='监听已关闭';$('receiver-status').textContent=mode==='mic'&&stream?'耳机监听关闭 · 接收输出静音':'接收已停止';}
  else if(analog&&transmitting&&!open&&!params.fmMonitor){$('carrier-text').textContent='自动静噪·已静音';$('receiver-status').textContent='发射仍在进行，接收端等待有效信号 / 自动静噪静音。刚按 PTT 就说的开头可能被截去；弱信号也可能持续静音。';}
  else if(manualOpen){$('carrier-text').textContent='静噪关闭·试听';$('carrier-dot').style.opacity='1';$('receiver-status').textContent=transmitting?'通话试听 · 自动静噪关闭，请保持低音量。':'通话收尾 · PTT 已释放，有限收尾后恢复安静。';}
  else if(listening&&params.fmMonitor){$('carrier-text').textContent=transmitting?'通话试听':'待机';$('receiver-status').textContent=transmitting?'通话试听 · 等待缓冲音频':'通话试听待机 · 自动静噪关闭，未发射时保持安静。';}
  else if(transmitting){$('receiver-status').textContent=params.perspective==='operator'?'本机侧音 · 绕过远端 RF':analog?'自动静噪已放行 · 显示模型 C/N，非实测 RSSI':'数字式接收演示 · 无真实声码器';}
  else if(listening){$('receiver-status').textContent=open?'接收收尾 · 自动静噪仍在放行':'接收待机 · 自动静噪，等待发射';}
  else $('receiver-status').textContent=mode==='mic'&&stream?'耳机监听关闭 · 接收输出静音':'接收已停止 · 开始试听后显示状态';
}

async function ensureAudio(){
  if(initPromise)await initPromise;
  if(!context){initPromise=(async()=>{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('浏览器不支持 Web Audio，请使用新版 Chrome、Edge、Firefox 或 Safari。');let c;try{c=new AC({sampleRate:48000,latencyHint:'interactive'});}catch(e){if(e.name!=='NotSupportedError')throw e;c=new AC({latencyHint:'interactive'});}try{if(!c.audioWorklet)throw Error('需要 HTTPS 或 localhost，以及支持 AudioWorklet 的浏览器。');await c.audioWorklet.addModule(new URL('./worklet.js?v=fm-file-ptt-v5',import.meta.url));context=c;$('engine-rate').textContent=`音频引擎 ${(c.sampleRate/1000).toFixed(1)} kHz${c.sampleRate>96000?' · 高采样率可能无法稳定实时处理':''} · 文件解码与导出使用此采样率`;monitorGain=c.createGain();monitorGain.gain.value=mode==='mic'?0:listenVolume;monitorGain.connect(c.destination);}catch(e){await c.close();throw e;}})();try{await initPromise;}finally{initPromise=null;}}
  await context.resume();
}
function createProcessor(destination=monitorGain){worklet?.disconnect();worklet?.port.close();worklet=new AudioWorkletNode(context,'radio-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{seed:mode==='file'?fileSeed:micSeed,params:{...params,vox:mode==='mic'&&params.vox,gateDry:mode==='mic',receiverActive:mode==='file',tx:mode==='file'}}});worklet.connect(destination);const active=worklet;worklet.port.onmessage=({data})=>{if(worklet===active&&data.type==='meter')meter(data);};}
function clearMeters(){meter({input:0,output:0,signal:params.quality,carrier:false});}
function capturePosition(){if(playing&&context){const elapsed=Math.max(0,context.currentTime-startTime),duration=playbackDuration();pausedAt=source?.loop&&duration?elapsed%duration:Math.min(elapsed,duration);}}
// Every file audition owns its output envelope. Old cleanup never touches the shared
// headphone volume or a newer source/processor, even if the main thread is late.
function disposePlayback(session){
  if(!session||session.disposed)return;
  session.disposed=true;clearTimeout(session.timer);
  session.source.onended=null;session.source.disconnect();
  session.processor?.disconnect();session.processor?.port.close();session.gain.disconnect();
}
function afterAudioTime(session,when,done){
  clearTimeout(session.timer);const epoch=session.cleanupEpoch=(session.cleanupEpoch??0)+1;
  const check=()=>{if(session.disposed||session.cleanupEpoch!==epoch)return;if(context.state==='closed'||context.state==='suspended'){done();return;}const remaining=when-context.currentTime;
    if(remaining>0){session.timer=setTimeout(check,Math.max(1,remaining*1000));return;}done();};
  session.timer=setTimeout(check,Math.max(0,(when-context.currentTime)*1000));
}
function playbackGainAt(session,time){
  if(session.fadeEnd!==undefined&&time>=session.fadeStart)
    return (session.fadeStartLevel??1)*Math.max(0,Math.min(1,(session.fadeEnd-time)/Math.max(1/context.sampleRate,session.fadeEnd-session.fadeStart)));
  return session.attackEnd!==undefined&&time<session.attackEnd
    ?(session.attackStartLevel??0)+(1-(session.attackStartLevel??0))*Math.max(0,(time-session.startedAt)/(session.attackEnd-session.startedAt)):(session.heldGain??1);
}
function retirePlayback(session){
  if(!session||session.disposed)return;
  const now=context.currentTime,end=Math.max(now,Math.min(now+OUTPUT_FADE_SECONDS,session.fadeEnd??Infinity)),gain=session.gain.gain;
  const level=playbackGainAt(session,now);
  gain.cancelScheduledValues(now);gain.setValueAtTime(level,now);gain.linearRampToValueAtTime(0,end);
  session.source.onended=null;try{session.source.stop(end);}catch{}
  afterAudioTime(session,end,()=>disposePlayback(session));
}
function schedulePlaybackEnd(session){
  // A completed non-looping BufferSource cannot be revived by toggling loop.
  // Preserve its finite envelope even if the browser has not delivered onended.
  const now=context.currentTime,gain=session.gain.gain;
  if(session.sourceEndAt!==undefined&&now>=session.sourceEndAt)return;
  gain.cancelScheduledValues(now);gain.setValueAtTime(playbackGainAt(session,now),now);
  session.fadeStart=session.fadeEnd=session.endAt=session.sourceEndAt=undefined;session.fadeStartLevel=1;
  if(session.attackEnd>now)gain.linearRampToValueAtTime(1,session.attackEnd);
  if(session.snapshot||session.source.loop)return;
  const duration=session.source.buffer.duration;
  const elapsed=Math.max(0,now-session.startedAt)+session.offset;
  const cycles=Math.floor(elapsed/duration);
  const sourceEnd=session.startedAt+(cycles+1)*duration-session.offset;
  session.sourceEndAt=sourceEnd;
  const rate=context.sampleRate,totalSamples=Math.round((sourceEnd-session.startedAt)*rate)+Math.round(rate*.35);
  const fadeSamples=outputFadeSamples(rate,totalSamples);
  session.endAt=session.startedAt+totalSamples/rate;
  session.fadeStart=session.startedAt+(totalSamples-fadeSamples)/rate;
  session.fadeEnd=session.startedAt+(totalSamples-1)/rate;
  gain.setValueAtTime(1,session.fadeStart);gain.linearRampToValueAtTime(0,session.fadeEnd);
}
function pauseFilePlayback(){
  capturePosition();
  const session=playbackSession;
  if(!playing||!session?.processor||session.snapshot){stopPlayback(false);status(comparison?'匹配快照已暂停；快照不重建 PTT 过程。':'试听已暂停。');return;}
  const now=context.currentTime,rate=context.sampleRate;
  // Release the file's PTT: stop new input, but retain this kernel's queued voice,
  // RF/filter state and normal release. Rekey during this window reuses it.
  session.source.onended=null;try{session.source.stop(now);}catch{}session.source.disconnect();
  const end=Math.min(now+Math.round(rate*.35)/rate,session.endAt??Infinity);
  const gain=session.gain.gain,level=playbackGainAt(session,now);
  gain.cancelScheduledValues(now);gain.setValueAtTime(level,now);
  session.heldGain=level;session.attackEnd=undefined;session.fadeStartLevel=level;session.endAt=Math.max(now,end);session.fadeEnd=Math.max(now,session.endAt-1/rate);
  session.fadeStart=Math.max(now,session.endAt-outputFadeSamples(rate,Math.round(rate*.35))/rate);
  if(session.fadeStart>now)gain.setValueAtTime(level,session.fadeStart);
  gain.linearRampToValueAtTime(0,session.fadeEnd);session.resumeAfterRelease=true;
  stopPlayback(false,true);status('已松开文件 PTT：试听位置保留，语音与接收收尾后暂停。');
}
function stopPlayback(reset=true,drain=false){
  ++playEpoch;
  const ending=playbackSession;
  fileDraining=drain&&!!ending?.processor&&!ending.snapshot;
  playIntent=false;playing=false;
  if(source){source.onended=null;source=null;}comparisonGain=null;
  if(!fileDraining){playbackSession=null;worklet=null;retirePlayback(ending);}
  if(reset)pausedAt=0;sendParams();
  $('play').innerHTML='<span>▶</span> 试听';$('stop').disabled=!fileDraining;
  $('screen-mode').textContent='FILE / STANDBY';$('playhead').style.display='none';updateTime(pausedAt);updateSourceUI();
  if(fileDraining){
    // The output was already faded on the audio clock. This timer only releases
    // nodes/UI, and cannot extend audible postroll when onended arrives late.
    afterAudioTime(ending,ending.endAt??context.currentTime+.35,()=>{
      disposePlayback(ending);
      if(playbackSession!==ending)return;
      playbackSession=null;worklet=null;fileDraining=false;clearMeters();
      $('stop').disabled=true;updateSourceUI();
    });
  }else clearMeters();
}

function seconds(s){const n=Math.max(0,Math.floor(s));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
function playbackDuration(){return comparison?.duration||fileBuffer?.duration||0;}
function updateTime(time){$('timecode').innerHTML=`${seconds(time)} <i>/ ${seconds(playbackDuration())}</i>`;$('seek').value=playbackDuration()?Math.round(time/playbackDuration()*1000):0;$('seek').style.setProperty('--fill',`${Number($('seek').value)/10}%`);}
async function playFile({resume=false}={}){
  if(mode!=='file'||!fileBuffer)return;
  if(!resume&&(playing||playIntent)){pauseFilePlayback();return;}
  playIntent=true;
  if(matchEnabled&&(!comparison||comparisonKey!==matchKey())){
    $('play').innerHTML='<span>Ⅱ</span> 暂停等待';$('stop').disabled=false;updateSourceUI();
    if(!comparisonWorker)prepareMatch();return;
  }
  const epoch=++playEpoch;
  try{
    await ensureAudio();if(epoch!==playEpoch||!playIntent||mode!=='file'||!fileBuffer)return;
    const startedAt=context.currentTime;
    const continuing=!comparison&&fileDraining&&playbackSession?.resumeAfterRelease&&!playbackSession.disposed&&startedAt<playbackSession.endAt;
    const retained=continuing?playbackSession:null,level=retained?playbackGainAt(retained,startedAt):1;
    fileDraining=false;
    if(retained){clearTimeout(retained.timer);++retained.cleanupEpoch;}
    else if(playbackSession){const old=playbackSession;playbackSession=null;worklet=null;retirePlayback(old);}
    const gain=retained?.gain??context.createGain();if(!retained)gain.connect(monitorGain);
    if(!comparison){if(!retained)createProcessor(gain);}else{worklet?.disconnect();worklet?.port.close();worklet=null;clearMeters();}
    const active=context.createBufferSource();source=active;active.buffer=comparison?(params.mix?comparison.wet:comparison.dry):fileBuffer;active.loop=$('loop').checked;
    if(comparison){comparisonGain=gain;gain.gain.setValueAtTime(0,startedAt);gain.gain.linearRampToValueAtTime(1,startedAt+.008);active.connect(gain);}
    else active.connect(worklet);
    playbackSession=Object.assign(retained??{},{source:active,processor:comparison?null:worklet,gain,snapshot:!!comparison,startedAt,offset:Math.min(pausedAt,Math.max(0,playbackDuration()-.001)),attackEnd:comparison?startedAt+.008:level<1?startedAt+OUTPUT_FADE_SECONDS:undefined,attackStartLevel:comparison?0:level,heldGain:1,fadeStart:undefined,fadeEnd:undefined,fadeStartLevel:1,endAt:undefined,sourceEndAt:undefined,resumeAfterRelease:false});
    schedulePlaybackEnd(playbackSession);
    monitorGain.gain.setTargetAtTime(listenVolume,context.currentTime,.01);pausedAt=Math.min(pausedAt,Math.max(0,playbackDuration()-.001));playing=true;sendParams();active.start(startedAt,pausedAt);startTime=startedAt-pausedAt;
    active.onended=()=>{if(source===active&&playing){const snapshot=!!comparison;stopPlayback(true,!snapshot);status(snapshot?'匹配快照播放结束（已含 350 ms 收尾）。':'文件播放结束，接收端保留 350 ms 收尾后关闭。');}};
    $('play').innerHTML='<span>Ⅱ</span> 暂停';$('stop').disabled=false;$('playhead').style.display='block';$('screen-mode').textContent='FILE / RECEIVING';updateSourceUI();status(params.mix?'正在试听电台效果。':'正在试听原声。');
  }catch(e){if(epoch===playEpoch){stopPlayback(false);status(`音频启动失败：${e.message}`,true);}}
}
function setFile(buffer,name){cancelInputCalibration(true);$('calibration-status').textContent=`保留当前输入增益 ${(params.txInputGainDb??0)>0?'+':''}${(params.txInputGainDb??0).toFixed(2)} dB；此文件未校准。原声保持不变。`;finishExport();cancelComparison();if(mode==='file')stopPlayback();fileBuffer=buffer;fileSeed=createTakeSeed();fileName=name;monoSamples=new Float32Array(buffer.length);for(let ch=0;ch<buffer.numberOfChannels;ch++){const data=buffer.getChannelData(ch);for(let i=0;i<data.length;i++)monoSamples[i]+=data[i]/buffer.numberOfChannels;}$('file-source').classList.add('loaded');$('drop-zone').querySelector('strong').textContent='更换文件';$('file-info').hidden=false;$('file-name').textContent=name;$('file-details').textContent=`${seconds(buffer.duration)} · ${(buffer.sampleRate/1000).toFixed(1)} kHz · ${buffer.numberOfChannels} 声道 → 单声道`;$('wave-empty').hidden=true;$('play').disabled=false;updateSourceUI();updateTime(0);drawWave();status(`已载入 ${name}，可以开始试听。`);}
async function loadFile(file){if(!file||mode!=='file')return;cancelInputCalibration(true);cancelDemoLoad();cancelComparison();finishExport();const epoch=++loadEpoch;if(file.size>50*1024*1024){status('文件超过 50 MB。请先裁剪或压缩后再载入。',true);return;}stopPlayback();status('正在本地解码音频…');try{await ensureAudio();const bytes=await file.arrayBuffer();if(epoch!==loadEpoch)return;const buffer=await context.decodeAudioData(bytes);if(epoch!==loadEpoch)return;if(buffer.duration>600)throw Error('音频超过 10 分钟，请先裁剪。');if(!buffer.length)throw Error('音频内容为空。');setFile(buffer,file.name);}catch(e){if(epoch===loadEpoch)status(`无法读取文件：${e.message} 可尝试转换为 WAV 或 MP3。`,true);}finally{$('file-input').value='';}}
function drawWave(){const canvas=$('waveform'),rect=canvas.getBoundingClientRect();if(!rect.width)return;const dpr=window.devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);c.clearRect(0,0,rect.width,rect.height);if(!monoSamples)return;c.strokeStyle='#5272b7';c.lineWidth=1.4;const bins=Math.floor(rect.width/3);for(let b=0;b<bins;b++){const start=Math.floor(b*monoSamples.length/bins),end=Math.max(start+1,Math.floor((b+1)*monoSamples.length/bins));let max=0;for(let i=start;i<Math.min(end,monoSamples.length);i++)max=Math.max(max,Math.abs(monoSamples[i]));const h=Math.max(1,max*rect.height*.43);c.beginPath();c.moveTo(b*3+2,rect.height/2-h);c.lineTo(b*3+2,rect.height/2+h);c.stroke();}}
const HUMAN_DEMOS = Object.freeze({slt:{gainDb:9.64,file:'clean-human-slt-a0001-a0003.wav',name:'真人语音 · CMU ARCTIC SLT.wav'},bdl:{gainDb:12.88,file:'clean-human-bdl-a0001-a0003.wav',name:'真人语音 · CMU ARCTIC BDL.wav'}});
function cancelDemoLoad(){demoController?.abort();demoController=null;$('cancel-demo').hidden=true;}
async function humanDemo(key){
  if(mode!=='file'||!Object.hasOwn(HUMAN_DEMOS,key))return;
  cancelInputCalibration(true);const gainRevision=txGainRevision;
  cancelDemoLoad();cancelComparison();finishExport();stopPlayback();
  const epoch=++loadEpoch,controller=new AbortController();demoController=controller;$('cancel-demo').hidden=false;
  status('正在载入本站真人语音示例…');
  try{
    await ensureAudio();if(epoch!==loadEpoch||mode!=='file')return;
    const response=await fetch(new URL(`../assets/speech/${HUMAN_DEMOS[key].file}`,import.meta.url),{signal:controller.signal});
    if(!response.ok)throw Error(`示例文件不可用（HTTP ${response.status}）`);
    const bytes=await response.arrayBuffer();if(epoch!==loadEpoch||mode!=='file')return;
    const buffer=await context.decodeAudioData(bytes);if(epoch!==loadEpoch||mode!=='file')return;
    if(!buffer.length||!Number.isFinite(buffer.duration)||buffer.duration>600)throw Error('示例音频无效');
    setFile(buffer,HUMAN_DEMOS[key].name);
    if(gainRevision===txGainRevision){const before=params.txInputGainDb??0;params.txInputGainDb=HUMAN_DEMOS[key].gainDb;++txGainRevision;calibrationUndo={seed:fileSeed,gainDb:before};updateControls();sendParams();$('calibration-status').textContent=`示例标称输入：${before.toFixed(2)} → +${params.txInputGainDb.toFixed(2)} dB（近似模型参考）。原声 A 不变；${params.txMicAgc?'AGC 仍开启，标称参考要求关闭 AGC。':'标称参考条件为 AGC 关闭。'}`;}
    else $('calibration-status').textContent='保留载入期间手动设置的发射输入增益。';
    status('已载入真人朗读示例，发射输入增益显示在输入面板。请先降低试听音量，再按试听；示例不是无线电录音。');
  }catch(e){if(epoch===loadEpoch&&e.name!=='AbortError')status(`真人示例载入失败：${e.message}。可以重试或导入自己的音频。`,true);}
  finally{if(epoch===loadEpoch)cancelDemoLoad();}
}
function calibrateInput(){
  if(mode!=='file'||!monoSamples||params.radio!=='analog'||params.perspective!=='receiver')return;
  cancelInputCalibration();if(playing||playIntent){capturePosition();stopPlayback(false);}
  calibrationBusy=true;const seed=fileSeed,gainRevision=txGainRevision,before=params.txInputGainDb??0;
  let current;try{current=new Worker(new URL('./calibration-worker.js?v=fm-file-ptt-v5',import.meta.url),{type:'module'});}catch(error){cancelInputCalibration();$('calibration-status').textContent=`无法启动校准：${error.message}。输入增益未更改。`;return;}calibrationWorker=current;updateCalibrationControls();
  $('calibration-status').textContent='正在估计输入电平…试听已暂停，完成后不会自动播放。';
  current.onmessage=({data})=>{
    if(calibrationWorker!==current||fileSeed!==seed||gainRevision!==txGainRevision||mode!=='file')return;
    if(data.error){cancelInputCalibration();$('calibration-status').textContent=`无法校准：${data.error}。输入增益未更改。`;return;}
    const p=data.proposal;if(!p||!Number.isFinite(p.gainDb)||p.gainDb< -12||p.gainDb>24||!Number.isFinite(p.levelDbov)){cancelInputCalibration();$('calibration-status').textContent='校准结果无效，输入增益未更改。';return;}
    cancelInputCalibration();if(playing||playIntent){capturePosition();stopPlayback(false);}
    params.txInputGainDb=Number(p.gainDb.toFixed(2));++txGainRevision;calibrationUndo={seed,gainDb:before};updateControls();sendParams();
    $('calibration-status').textContent=`估计电平 ${p.levelDbov.toFixed(1)} dBov；输入增益 ${before.toFixed(2)} → ${params.txInputGainDb>0?'+':''}${params.txInputGainDb.toFixed(2)} dB${p.bounded?'（已限制范围）':''}。非 P.56 / 非 SPL；${params.txMicAgc?'AGC 仍开启，参考条件要求 AGC 关闭。':'参考条件为 AGC 关闭。'}请先降低试听音量。`;
    status('模型参考输入已设置，原声与输出音量未改变。请按试听比较；可撤销。');
  };
  current.onerror=event=>{if(calibrationWorker!==current)return;cancelInputCalibration();$('calibration-status').textContent=`校准失败：${event.message}。输入增益未更改。`;};
  const samples=monoSamples.slice();current.postMessage({samples,rate:fileBuffer.sampleRate},[samples.buffer]);
}
function undoInputCalibration(){if(!calibrationUndo||calibrationUndo.seed!==fileSeed)return;const gain=calibrationUndo.gainDb;cancelInputCalibration(true);if(playing||playIntent){capturePosition();stopPlayback(false);}params.txInputGainDb=gain;++txGainRevision;updateControls();sendParams();$('calibration-status').textContent=`已恢复之前的输入增益 ${gain.toFixed(2)} dB。`;}
async function demo(){if(mode!=='file')return;cancelInputCalibration(true);cancelDemoLoad();cancelComparison();finishExport();try{const epoch=++loadEpoch;await ensureAudio();if(epoch!==loadEpoch||mode!=='file')return;const rate=context.sampleRate,b=context.createBuffer(1,rate*8,rate),d=b.getChannelData(0);for(let i=0;i<d.length;i++){const t=i/rate,phrase=t%2.2,envelope=Math.min(1,phrase*20)*Math.min(1,Math.max(0,(1.65-phrase)*12)),syllable=.5+.5*Math.sin(t*2*Math.PI*3.7);d[i]=envelope*syllable*(.19*Math.sin(2*Math.PI*170*t)+.11*Math.sin(2*Math.PI*510*t)+.07*Math.sin(2*Math.PI*1190*t));}setFile(b,'测试信号 · 合成语音节奏.wav');status('已载入合成测试信号（非真人语音）。可改用真人语音示例评估语音处理。');}catch(e){status(e.message,true);}}
function stopMic(message=true){micTransmitting=false;++micEpoch;micPending=false;stream?.getTracks().forEach(track=>track.stop());stream=null;source?.disconnect();source=null;worklet?.disconnect();worklet?.port.close();worklet=null;if(monitorGain&&context)monitorGain.gain.setValueAtTime(0,context.currentTime);$('monitor').checked=false;$('ptt').classList.remove('transmitting');$('ptt').disabled=true;$('start-mic').disabled=false;$('start-mic').textContent='开启麦克风';$('stop-mic').disabled=true;$('mic-status').textContent='麦克风已关闭';$('screen-mode').textContent=mode==='mic'?'MIC / STANDBY':'FILE / STANDBY';clearMeters();updateSourceUI();if(message)status('已停止所有麦克风音轨，并关闭监听。');}
async function startMic(){if(micPending||stream)return;const epoch=++micEpoch;micPending=true;$('start-mic').disabled=true;$('stop-mic').disabled=false;$('start-mic').textContent='等待麦克风权限…';updateSourceUI();try{if(!window.isSecureContext)throw Error('麦克风需要 HTTPS 或 localhost。');if(!navigator.mediaDevices?.getUserMedia)throw Error('此浏览器不支持麦克风访问。');await ensureAudio();if(epoch!==micEpoch||mode!=='mic')return;const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});if(epoch!==micEpoch||mode!=='mic'){s.getTracks().forEach(t=>t.stop());return;}stream=s;micSeed=createTakeSeed();createProcessor();source=context.createMediaStreamSource(stream);source.connect(worklet);monitorGain.gain.setValueAtTime(0,context.currentTime);$('monitor').checked=false;$('ptt').disabled=params.vox;$('stop-mic').disabled=false;$('mic-status').textContent='麦克风已开启 · 监听关闭';$('start-mic').textContent='麦克风正在使用';$('screen-mode').textContent='MIC / READY';sendParams();updateSourceUI();for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(stream){stopMic(false);status('麦克风连接已断开。检查设备后重新开启。',true);}});status('监听关闭：不会听到语音或开关台声。戴耳机后手动开启「耳机监听」，选 B 电台，再按住 / 松开 PTT。');}catch(e){if(epoch===micEpoch){stopMic(false);const hints={NotAllowedError:'未获得麦克风权限。请在地址栏站点设置中允许访问，然后重试。',NotFoundError:'未找到麦克风。连接设备后重试。',NotReadableError:'麦克风被其他应用占用或无法读取，请检查设备。'};status(hints[e.name]||`麦克风启动失败：${e.message}`,true);}}finally{if(epoch===micEpoch)micPending=false;}}
function switchMode(next){if(mode===next)return;cancelInputCalibration();cancelDemoLoad();finishExport();cancelComparison();++loadEpoch;if(mode==='file')stopPlayback();else stopMic(false);mode=next;$('match-prepare').disabled=next!=='file';$('file-source').hidden=next!=='file';$('mic-source').hidden=next!=='mic';for(const m of ['file','mic']){$(`${m}-tab`).classList.toggle('active',m===next);$(`${m}-tab`).setAttribute('aria-selected',m===next);$(`${m}-tab`).tabIndex=m===next?0:-1;}$('screen-mode').textContent=next==='file'?'FILE / STANDBY':'MIC / STANDBY';updateSourceUI();settingsNotice();if(next==='file')drawWave();status(next==='mic'?'戴好耳机后，再开启麦克风。':'文件模式就绪。');}
function ptt(pressed){if(!stream||(params.vox&&pressed))return;$('ptt').classList.toggle('transmitting',pressed);$('screen-mode').textContent=pressed?'MIC / TRANSMITTING':'MIC / READY';sendParams();}
function exportWav(){if(mode!=='file'||!monoSamples||exportBusy)return;exportBusy=true;$('export').disabled=true;$('cancel-export').hidden=false;const samples=monoSamples.slice(),name=fileName.replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*]/g,'_');worker=new Worker(new URL('./render-worker.js?v=fm-file-ptt-v5',import.meta.url),{type:'module'});const current=worker;status('正在本地渲染 0%…');worker.onmessage=({data})=>{if(worker!==current||mode!=='file')return;if(data.error){finishExport();status(`导出失败：${data.error}`,true);}else if(data.buffer){const blob=new Blob([data.buffer],{type:'audio/wav'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${name}-radio.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);finishExport();status('WAV 已生成并交给浏览器下载。使用开始导出时的电台参数，包含 350ms 收尾。');}else status(`正在本地渲染 ${Math.round(data.progress*100)}%…`);};worker.onerror=e=>{if(worker!==current)return;finishExport();status(`导出失败：${e.message}`,true);};worker.postMessage({samples,rate:fileBuffer.sampleRate,seed:fileSeed,params:{...params}},[samples.buffer]);}
function finishExport(){worker?.terminate();worker=null;exportBusy=false;$('export').disabled=mode!=='file'||!monoSamples;$('cancel-export').hidden=true;}
$('file-input').addEventListener('change',e=>loadFile(e.target.files[0]));const zone=$('drop-zone');for(const event of ['dragenter','dragover'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.add('dragging');});for(const event of ['dragleave','drop'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.remove('dragging');});zone.addEventListener('drop',e=>loadFile(e.dataTransfer.files[0]));zone.tabIndex=0;zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file-input').click();}});
$('human-demo-slt').addEventListener('click',()=>humanDemo('slt'));$('human-demo-bdl').addEventListener('click',()=>humanDemo('bdl'));$('cancel-demo').addEventListener('click',()=>{++loadEpoch;cancelDemoLoad();status('已取消示例载入。');});$('demo').addEventListener('click',demo);$('play').addEventListener('click',playFile);$('stop').addEventListener('click',()=>{if(comparisonWorker||matchTimer!==undefined){clearMatchJob();comparison=null;comparisonKey='';$('match-status').textContent='匹配待更新 · 按试听继续';}stopPlayback();status('试听已停止。');});$('loop').addEventListener('change',()=>{if(source&&mode==='file'){source.loop=$('loop').checked;if(playbackSession)schedulePlaybackEnd(playbackSession);}});$('file-tab').addEventListener('click',()=>switchMode('file'));$('mic-tab').addEventListener('click',()=>switchMode('mic'));document.querySelector('.tabbar').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();switchMode(mode==='file'?'mic':'file');$(`${mode}-tab`).focus();}});$('mic-tab').tabIndex=-1;
$('mic-quick-stop').addEventListener('click',()=>stopMic());$('start-mic').addEventListener('click',startMic);$('stop-mic').addEventListener('click',()=>stopMic());$('monitor').addEventListener('change',()=>{if(!stream){$('monitor').checked=false;status('请先开启麦克风。',true);return;}monitorGain.gain.setTargetAtTime($('monitor').checked?listenVolume:0,context.currentTime,.02);$('mic-status').textContent=`麦克风已开启 · 监听${$('monitor').checked?'开启':'关闭'}`;sendParams();clearMeters();updateSourceUI();status($('monitor').checked?'监听已开启。请佩戴耳机并保持低音量。':'监听关闭：语音和开关台声均静音，麦克风仍在使用。');});
$('ptt').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();$('ptt').setPointerCapture(e.pointerId);ptt(true);});for(const e of ['pointerup','pointercancel','lostpointercapture'])$('ptt').addEventListener(e,()=>ptt(false));document.addEventListener('keydown',e=>{if(e.code==='Space'&&mode==='mic'&&stream&&!e.repeat&&!['INPUT','TEXTAREA','BUTTON','SELECT','A','SUMMARY'].includes(e.target.tagName)){e.preventDefault();ptt(true);}else if((e.code==='Space'||e.key==='Enter')&&e.target===$('ptt')){e.preventDefault();ptt(true);}});document.addEventListener('keyup',e=>{if(e.code==='Space'||e.key==='Enter')ptt(false);});window.addEventListener('blur',()=>ptt(false));
$('calibrate-input').addEventListener('click',calibrateInput);$('cancel-calibration').addEventListener('click',()=>{cancelInputCalibration();$('calibration-status').textContent='已取消校准，输入增益未更改。';});$('undo-calibration').addEventListener('click',undoInputCalibration);
$('tx-mic-agc').addEventListener('change',()=>{if(params.perspective!=='receiver'||params.radio!=='analog')return;params.txMicAgc=$('tx-mic-agc').checked;updateControls();sendParams();status(params.txMicAgc?'麦克风自动增益模型已开启。校正范围 −12 / +6 dB，目标与时序尚未设备校准。':'麦克风自动增益模型已关闭。');});
$('fm-propagation').addEventListener('change',()=>{if(params.perspective!=='receiver'||params.radio!=='analog')return;params.fmPropagation=$('fm-propagation').value;updateControls();sendParams();status(params.fmPropagation==='moving'?'已切换到移动衰落示意模型。静噪与监听设置保持不变。':'已切换到固定接收。当前 C/N 与静噪设置保留。');});
$('fm-monitor').addEventListener('change',()=>{if(params.perspective!=='receiver'||params.radio!=='analog')return;params.fmMonitor=$('fm-monitor').value==='open';updateControls();sendParams();status(params.fmMonitor?'已关闭自动静噪，仅用于通话试听与有限收尾；待机保持安静。请保持低音量。不会启动播放、麦克风或耳机监听。':'已恢复自动接收静噪。');});
$('vox').addEventListener('change',()=>{ptt(false);params.vox=$('vox').checked;$('ptt').disabled=!stream||params.vox;updateSourceUI();sendParams();});for(const id of ['perspective','radio','permit'])$(id).addEventListener('change',()=>{cancelInputCalibration();releaseForSettings();params[id]=$(id).value;updateControls();sendParams();restartFileForSettings();settingsNotice();status(mode==='file'?'通话行为已更新，试听位置保留。':'通话行为在当前通话收尾后生效；持续 VOX 请停顿后再说话。');});for(const id of ['output','voxThreshold','cueLevel','tailMs','tailGainDb','txInputGainDb'])$(id).addEventListener('input',()=>{if(id==='txInputGainDb'){cancelInputCalibration(true);++txGainRevision;$('calibration-status').textContent='使用手动输入增益；不会自动覆盖。';}params[id]=Number($(id).value);updateControls();sendParams();});for(const [id,mix] of [['dry',0],['wet',1]])$(id).addEventListener('click',()=>{const resume=(playing||playIntent)&&!!comparison;if(resume){capturePosition();stopPlayback(false);}params.mix=mix;updateControls();sendParams();if(resume)playFile({resume:true});status(mix?'试听已切换到 B 电台效果。':'试听已切换到 A 原声（未经电台处理）。');});$('reset').addEventListener('click',()=>applyPreset(preset));$('export').addEventListener('click',exportWav);$('cancel-export').addEventListener('click',()=>{finishExport();status('已取消导出。');});

function matchKey(){const {mix,vox,gateDry,voxThreshold,tx,...sound}=params;return JSON.stringify({seed:fileSeed,sound});}
function clearMatchJob(){++comparisonEpoch;if(matchTimer!==undefined){clearTimeout(matchTimer);matchTimer=undefined;}comparisonWorker?.terminate();comparisonWorker=null;}
function cancelComparison(message='匹配关闭 · 原始电平'){
  clearMatchJob();matchEnabled=false;
  const wasReady=!!comparison;comparison=null;comparisonKey='';
  if(wasReady&&mode==='file')stopPlayback(false);
  $('match-off').hidden=true;$('match-prepare').hidden=false;$('match-prepare').disabled=mode!=='file'||!monoSamples;updateCalibrationControls();$('match-status').textContent=message;
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
  const current=new Worker(new URL('./comparison-worker.js?v=fm-file-ptt-v5',import.meta.url),{type:'module'});comparisonWorker=current;
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

window.addEventListener('resize',drawWave);document.addEventListener('visibilitychange',()=>{if(document.hidden){ptt(false);if(mode==='file'){capturePosition();stopPlayback(false);}if(stream||micPending)stopMic();}});window.addEventListener('pagehide',()=>{cancelInputCalibration();cancelComparison();if(mode==='file')stopPlayback(false);stopMic(false);finishExport();context?.close();cancelAnimationFrame(raf);});
function animate(){if(playing&&fileBuffer){const time=(context.currentTime-startTime)%playbackDuration();updateTime(time);$('playhead').style.left=`${time/playbackDuration()*100}%`;}raf=requestAnimationFrame(animate);}updateControls();updateSourceUI();animate();

// Keep keyboard-focused controls below the actual sticky audition area.
if(typeof ResizeObserver!=='undefined'){new ResizeObserver(entries=>{document.documentElement.style.setProperty('--audition-height',`${entries[0].target.getBoundingClientRect().height}px`);}).observe(document.querySelector('.audition-bar'));}
