import { performance } from 'node:perf_hooks';
import { AnalogFM } from '../src/analog-fm.js';
// Throughput evidence for this Node process only, not a browser/device guarantee.
for (const rate of [8000,22050,44100,48000,96000,192000]) {
 const k = new AnalogFM(rate,{cnrDb:15,seed:44});
 for(let i=0;i<rate;i++)k.processSample(.15*Math.sin(i*.14));
 const start=performance.now();let checksum=0;
 for(let i=0;i<rate*3;i++)checksum+=k.processSample(.15*Math.sin(i*.14));
 const elapsed=performance.now()-start;
 console.log(JSON.stringify({audioRate:rate,basebandRate:k.basebandRate,millisecondsPerAudioSecond:+(elapsed/3).toFixed(2),realtimeFraction:+(elapsed/3000).toFixed(4),checksum:+checksum.toFixed(5)}));
}
