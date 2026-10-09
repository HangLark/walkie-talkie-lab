import { prepareComparison } from './comparison.js';
self.onmessage=({data})=>{
  try { const result=prepareComparison(data.samples,data.rate,data.params);self.postMessage(result,[result.dry.buffer,result.wet.buffer]); }
  catch(error){ self.postMessage({error:error.message}); }
};
