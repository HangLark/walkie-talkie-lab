import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../assets/speech/',import.meta.url);
test('bundled human speech matches recorded provenance and preserves complete licenses',async()=>{
 const provenance=JSON.parse(await readFile(new URL('provenance.json',root),'utf8'));
 for(const voice of ['slt','bdl']){
  const file=`clean-human-${voice}-a0001-a0003.wav`,bytes=await readFile(new URL(file,root)),entry=provenance.files.find(x=>x.filename===file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');assert.ok(bytes.length>300000&&bytes.length<400000);
  const license=await readFile(new URL(`COPYING-${voice}.txt`,root),'utf8'),attribution=await readFile(new URL('ATTRIBUTION.txt',root),'utf8');
  assert.ok(attribution.includes(license));assert.match(attribution,/John Kominek and Alan W. Black/);assert.match(attribution,/unchanged PCM/);assert.match(attribution,/not paired recordings/);
 }
 const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');assert.match(build,/'assets'/);
});
