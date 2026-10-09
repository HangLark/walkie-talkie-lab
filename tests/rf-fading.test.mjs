import test from 'node:test';
import assert from 'node:assert/strict';
import {FlatFading} from '../src/rf-fading.js';

test('static propagation is exactly unity for every sample and valid parameter choice',()=>{
 for(const rate of [8000,44100,48000,96000,192000]){const k=new FlatFading(rate);for(let n=0;n<rate*.1;n++){k.tick();assert.equal(k.i,1);assert.equal(k.q,0);assert.equal(k.power,1);}}
});
test('fading sequence is seeded, partition invariant, finite and bounded without clipping',()=>{
 for(const mode of ['rician','rayleigh']){const a=new FlatFading(48000,{mode,seed:78}),b=new FlatFading(48000,{mode,seed:78}),c=new FlatFading(48000,{mode,seed:79});let different=false;for(let block=0;block<71;block++)for(let n=0;n<127;n++){a.tick();b.tick();c.tick();assert.equal(a.i,b.i);assert.equal(a.q,b.q);different||=a.i!==c.i;assert.ok(Number.isFinite(a.power));assert.ok(a.power<=(Math.sqrt(a.kFactor)+Math.sqrt(a.sinusoids))**2/(a.kFactor+1)+1e-10);}assert.ok(different);}
});
test('zero Doppler gives a constant seeded channel, and physical rates agree in elapsed time',()=>{
 const still=new FlatFading(48000,{mode:'rician',maxDopplerHz:0}),i=still.i,q=still.q;for(let n=0;n<100000;n++){still.tick();assert.equal(still.i,i);assert.equal(still.q,q);}
 const waves=[];for(const rate of [8000,44100,48000,96000,192000]){const k=new FlatFading(rate,{mode:'rayleigh',seed:902,maxDopplerHz:2}),values=[];for(let n=0;n<=rate;n++){k.tick();if(n%Math.round(rate*.1)===0)values.push(k.i,k.q);}waves.push(values);}for(const w of waves)for(let n=0;n<w.length;n++)assert.ok(Math.abs(w[n]-waves[0][n])<.0001);
});
test('long-run Rayleigh and Rician gains have unit mean power and appropriate envelope statistics',()=>{
 for(const seed of [17,38,101])for(const mode of ['rayleigh','rician']){const k=new FlatFading(8000,{mode,seed,maxDopplerHz:20});let p=0,p2=0,low=0,count=0,real=0,imag=0,ri=0,r2=0,i2=0;
  for(let n=0;n<8000*120;n++){k.tick();if(n%8===0){p+=k.power;p2+=k.power*k.power;low+=k.power<.1;real+=k.i;imag+=k.q;ri+=k.i*k.q;r2+=k.i*k.i;i2+=k.q*k.q;count++;}}
  const mean=p/count,variance=p2/count-mean*mean;assert.ok(Math.abs(mean-1)<.07,`${mode}/${seed} power ${mean}`);
  if(mode==='rayleigh'){assert.ok(Math.abs(variance-1)<.15);assert.ok(Math.abs(low/count-(1-Math.exp(-.1)))<.025);assert.ok(Math.abs(real/count)<.025&&Math.abs(imag/count)<.025);assert.ok(Math.abs(ri/count)<.04);assert.ok(Math.abs(r2/count-i2/count)<.08);}
  else {assert.ok(Math.abs(variance-.36)<.08);assert.ok(low/count<.04);assert.ok(Math.abs(real/count-Math.sqrt(.8))<.025);}
 }
});
test('scattered gain energy is concentrated inside the declared maximum Doppler',()=>{
 const k=new FlatFading(8000,{mode:'rayleigh',seed:15,maxDopplerHz:20}),a=new Float64Array(16000),b=new Float64Array(16000);
 for(let n=0;n<a.length*8;n++){k.tick();if(n%8===0){a[n/8]=k.i;b[n/8]=k.q;}}
 function power(hz){let real=0,imag=0;for(let n=0;n<a.length;n++){const w=.5-.5*Math.cos(2*Math.PI*n/(a.length-1)),p=2*Math.PI*hz*n/1000;real+=(a[n]*Math.cos(p)+b[n]*Math.sin(p))*w;imag+=(b[n]*Math.cos(p)-a[n]*Math.sin(p))*w;}return real*real+imag*imag;}
 let inside=0,outside=0;for(let f=-40;f<=40;f++){if(Math.abs(f)<=20)inside+=power(f);else if(Math.abs(f)>=25)outside+=power(f);}assert.ok(outside<inside*1e-5);
 assert.ok(k.frequencyHz.every(f=>Math.abs(f)<=20));
});
test('invalid physical parameters are rejected instead of silently inventing a channel',()=>{
 for(const args of [{mode:'mobile'},{maxDopplerHz:-1},{maxDopplerHz:41},{kFactor:-1},{kFactor:Infinity},{sinusoids:7},{sinusoids:129}])assert.throws(()=>new FlatFading(48000,args),RangeError);
 assert.throws(()=>new FlatFading(7999),RangeError);
});
