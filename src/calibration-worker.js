import { proposeInputCalibration } from './input-calibration.js?v=fm-file-ptt-v5';
import { AnalogFM } from './analog-fm.js?v=fm-file-ptt-v5';
// Measure the current numerical TX response, never play this probe or touch user PCM.
function measureResponseAt1k(rate){
  const fm=new AnalogFM(rate,{txInputGainDb:0,txMicAgc:false,cnrDb:Infinity});
  const end=Math.round(rate*.4),start=Math.round(rate*.2),amplitude=.05;let power=0,count=0;
  for(let i=0;i<end;i++){fm.processSample(amplitude*Math.sin(2*Math.PI*1000*i/rate),true);if(i>=start){power+=fm.instantaneousDeviationHz**2;count++;}}
  return Math.sqrt(power/count)/(2500*amplitude/Math.SQRT2);
}
self.onmessage=({data})=>{
  try{const responseAt1k=measureResponseAt1k(data.rate);self.postMessage({proposal:{...proposeInputCalibration(data.samples,data.rate,{responseAt1k}),responseAt1k}});}
  catch(error){self.postMessage({error:error.message});}
};
