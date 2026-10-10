// Recording/playback boundary only, never a receiver squelch or RF/PTT event.
// Keep the existing total length; the last emitted sample is exactly zero.
export const OUTPUT_FADE_SECONDS = .01;
export function outputFadeSamples(rate, totalSamples) {
  return Math.min(totalSamples, Math.max(2, Math.round(rate * OUTPUT_FADE_SECONDS)));
}
export function outputWindowGain(index, totalSamples, rate) {
  if (index >= totalSamples - 1) return 0;
  const fade = outputFadeSamples(rate, totalSamples);
  return Math.min(1, (totalSamples - 1 - index) / (fade - 1));
}
export function applyOutputWindowFade(samples, rate) {
  const start = samples.length - outputFadeSamples(rate, samples.length);
  for (let i = start; i < samples.length; i++) samples[i] = i === samples.length - 1 ? 0 : samples[i] * outputWindowGain(i, samples.length, rate);
  return samples;
}
