export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const str = (at, s) => [...s].forEach((c,i) => view.setUint8(at+i,c.charCodeAt(0)));
  str(0,'RIFF'); view.setUint32(4,36+samples.length*2,true); str(8,'WAVE'); str(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); str(36,'data'); view.setUint32(40,samples.length*2,true);
  for (let i=0; i<samples.length; i++) { const x = Number.isFinite(samples[i]) ? Math.max(-1,Math.min(1,samples[i])) : 0; view.setInt16(44+i*2,Math.round(x*(x<0?32768:32767)),true); }
  return buffer;
}
