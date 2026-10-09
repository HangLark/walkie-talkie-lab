import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DEFAULTS,TIMBRE_PROFILES,TIMBRE_KEYS,CHANNEL_PROFILES,applyTimbre,applyChannel} from '../src/dsp.js';
async function harness(){
 const elements=new Map(),messages=[];
 function element(id=''){
  const classes=new Set(),handlers=new Map();return {id,tagName:'DIV',children:[],style:{setProperty(){}},dataset:{},checked:false,disabled:false,value:0,
   classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,v){if(v??!classes.has(x))classes.add(x);else classes.delete(x);}},
   addEventListener(n,f){if(!handlers.has(n))handlers.set(n,[]);handlers.get(n).push(f);},fire(n,e={}){for(const f of handlers.get(n)||[])f({target:this,preventDefault(){},...e});},
   setAttribute(){},append(e){this.children.push(e);},querySelector(){return element();},setPointerCapture(){},getBoundingClientRect(){return {width:0};}};
 }
 const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
 const document={...element(),getElementById:get,createElement:()=>element(),querySelectorAll:()=>[],querySelector:()=>element(),hidden:false};
 const window={...element()};
 const code=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'').replaceAll('import.meta.url',"'https://example.test/src/app.js'");
 const scope={document,window,DEFAULTS,TIMBRE_PROFILES,TIMBRE_KEYS,CHANNEL_PROFILES,applyTimbre,applyChannel,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout(){},URL,Float32Array,Math};
 vm.runInNewContext(code+`\nglobalThis.api={ptt,applyPreset,startMic,stopMic,setup(){mode='mic';stream={getTracks:()=>[]};worklet={port:{postMessage:m=>messages.push(m),close(){}},disconnect(){}};},get params(){return params;}};`,Object.assign(scope,{messages}));
 scope.api.setup();return {...scope,get,messages};
}
test('pointer cancellation, keyboard release and blur cannot leave TX latched',async()=>{
 const {get,document,window,messages}=await harness();
 const button=get('ptt');
 for(const release of ['pointerup','pointercancel','lostpointercapture']){button.fire('pointerdown',{button:0,pointerId:1});assert.equal(messages.at(-1).params.tx,true);button.fire(release);assert.equal(messages.at(-1).params.tx,false);}
 for(const release of ['keyup','blur']){document.fire('keydown',{code:'Space',repeat:false});assert.equal(messages.at(-1).params.tx,true);(release==='blur'?window:document).fire(release,{code:'Space'});assert.equal(messages.at(-1).params.tx,false);}
});
test('changing preset or VOX while keyed releases PTT and enabling VOX never enables monitor',async()=>{
 const {api,get,messages}=await harness();api.ptt(true);api.applyPreset('patrol');assert.equal(messages.at(-1).params.tx,false);assert.equal(get('monitor').checked,false);
 api.ptt(true);get('vox').checked=true;get('vox').fire('change');assert.equal(get('ptt').classList.contains('transmitting'),false);assert.equal(get('monitor').checked,false);
 get('vox').checked=false;get('vox').fire('change');assert.equal(messages.at(-1).params.tx,false);assert.equal(get('ptt').disabled,false);
});
test('space on interactive controls is not global PTT; hiding page closes microphone',async()=>{
 const {get,document,messages}=await harness();
 for(const tagName of ['INPUT','TEXTAREA','BUTTON','SELECT','A','SUMMARY']){document.fire('keydown',{code:'Space',repeat:false,target:{tagName}});assert.ok(!messages.at(-1)?.params.tx);}
 get('ptt').fire('pointerdown',{button:0,pointerId:1});document.hidden=true;document.fire('visibilitychange');assert.equal(get('ptt').disabled,true);assert.equal(get('monitor').checked,false);
});

test('profile selection releases held PTT with one atomic new-tone snapshot and preserves VOX settings',async()=>{
 const {api,get,messages}=await harness();api.params.radio='digital';api.params.permit='single';api.params.cueLevel=17;api.ptt(true);const before=messages.length;
 api.applyPreset('patrol');assert.equal(messages.length,before+1);const snapshot=messages.at(-1).params;assert.equal(snapshot.tx,false);assert.equal(snapshot.compression,TIMBRE_PROFILES.patrol.params.compression);assert.equal(snapshot.radio,'digital');assert.equal(snapshot.permit,'single');assert.equal(snapshot.cueLevel,17);assert.equal(get('monitor').checked,false);
 api.params.vox=true;api.params.voxThreshold=-33;api.applyPreset('patrol');assert.equal(api.params.vox,true);assert.equal(api.params.voxThreshold,-33);
});
