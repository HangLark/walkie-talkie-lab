/** Original windowed level estimate for explicit file setup. NOT ITU P.56,
 * not a speech recognizer, microphone SPL calibration, or hardware match.
 * Level convention: 20*log10(RMS/1); a full-scale sine is -3.0103 dB.
 * NTIA TR-13-495 uses P.56 active speech -28 dBov and a 1 kHz reference
 * tone at that level producing 1500 Hz peak deviation. This estimator is
 * deliberately labeled approximate and must not claim that conformance.
 */
export const INPUT_REFERENCE = Object.freeze({ levelDbov: -28, toneHz: 1000, tonePeakDeviationHz: 1500, maximumDeviationHz: 2500 });
export function estimateInputLevel(samples, rate) {
  if (!Number.isFinite(rate) || rate < 8000 || rate > 192000) throw new RangeError('Unsupported sample rate');
  if (!samples || samples.length < rate * .5) throw new RangeError('At least 0.5 seconds required');
  const frame = Math.round(rate * .02), frames = [];
  let peak = 0, totalPower = 0, totalSum = 0;
  for (let start = 0; start < samples.length; start += frame) {
    let power = 0, sum = 0; const end = Math.min(start + frame, samples.length);
    for (let i = start; i < end; i++) {
      const x = samples[i];
      if (!Number.isFinite(x) || Math.abs(x) > 1) throw new RangeError('Input must be finite normalized PCM');
      peak = Math.max(peak, Math.abs(x)); power += x*x; sum += x;
    }
    totalPower += power; totalSum += sum; frames.push({ power, sum, count: end-start });
  }
  // DC is not microphone speech and is removed by the TX high-pass. Exclude
  // its energy here too, without modifying the original PCM or dry A.
  const dcOffset = totalSum/samples.length;
  for (const f of frames) { f.power = Math.max(0, f.power-2*dcOffset*f.sum+dcOffset*dcOffset*f.count); f.mean = f.power/f.count; }
  const acPower = Math.max(0,totalPower-totalSum*dcOffset);
  // Ignore below -70 dBov before selecting a relative threshold. This keeps
  // added exact silence from changing the threshold, without calling it VAD.
  const audible = frames.map(f => f.mean).filter(p => p >= 1e-7).sort((a,b) => a-b);
  if (!audible.length) throw new RangeError('Input is too quiet to estimate');
  const referencePower = audible[Math.floor((audible.length-1)*.9)];
  const thresholdPower = Math.max(1e-7, referencePower * .01);
  let activePower = 0, activeSamples = 0;
  for (const f of frames) if (f.mean >= thresholdPower) { activePower += f.power; activeSamples += f.count; }
  if (activeSamples < rate * .3) throw new RangeError('At least 0.3 seconds of above-threshold audio required');
  const rms = Math.sqrt(activePower/activeSamples);
  return { method: 'windowed-rms-estimate-v1', p56Conformant: false, rms, levelDbov: 20*Math.log10(rms), peak,
    fullFileRms: Math.sqrt(acPower/samples.length), dcOffset, activeSeconds: activeSamples/rate,
    activeFraction: activeSamples/samples.length, thresholdDbov: 10*Math.log10(thresholdPower),
    crestDb: 20*Math.log10(peak/rms) };
}
/** Pure proposal, never mutates input or playback. responseAt1k is the measured
 * linear TX amplitude response from unity input to deviation/2500 Hz.
 * Independent source-normalization and transmitter sensitivity are returned.
 * A UI may apply the bounded equivalent gain only after explicit user action.
 */
export function proposeInputCalibration(samples, rate, { responseAt1k = 1, minGainDb = -12, maxGainDb = 24 } = {}) {
  if (!(responseAt1k > 0) || !Number.isFinite(responseAt1k) || !Number.isFinite(minGainDb) || !Number.isFinite(maxGainDb) || minGainDb > maxGainDb) throw new RangeError('Invalid calibration options');
  const estimate = estimateInputLevel(samples, rate);
  const referenceRms = 10**(INPUT_REFERENCE.levelDbov/20);
  const sourceNormalizationDb = INPUT_REFERENCE.levelDbov-estimate.levelDbov;
  const sensitivity = INPUT_REFERENCE.tonePeakDeviationHz / (INPUT_REFERENCE.maximumDeviationHz*Math.SQRT2*referenceRms*responseAt1k);
  const transmitterSensitivityDb = 20*Math.log10(sensitivity);
  const requestedGainDb = sourceNormalizationDb+transmitterSensitivityDb;
  const gainDb = Math.max(minGainDb, Math.min(maxGainDb, requestedGainDb));
  return { ...estimate, referenceRms, sourceNormalizationDb, transmitterSensitivityDb, requestedGainDb, gainDb,
    bounded: gainDb !== requestedGainDb, predictedPreTxPeak: estimate.peak*10**(gainDb/20),
    warning: 'Approximate file level only; background noise can count as activity. Speech peaks may engage deviation limiting. Not P.56 or microphone SPL calibration.' };
}
