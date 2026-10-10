import { prepareComparison } from './comparison.js?v=fm-output-boundary-v3';
self.onmessage=({data})=>{
  try { const result=prepareComparison(data.samples,data.rate,data.params,data.seed);self.postMessage(result,[result.dry.buffer,result.wet.buffer]); }
  catch(error){ self.postMessage({error:error.message}); }
};
