# 频段 · Radio Lab

A private-by-design, Chinese-language walkie-talkie audio workbench. Runs entirely in the browser with no runtime dependencies, external fonts, analytics, account, audio uploads, or backend.

## Run and build

Requires Node.js 20+ for the included development/build/test scripts. No package installation is needed.

```sh
npm run dev       # http://localhost:4173
npm test          # DSP and integration tests
npm run build     # generates dist/
npm run check     # tests + static build
node scripts/serve.mjs --dist  # test the production build
```

Opening `index.html` directly with `file://` is unsupported. AudioWorklet and microphone access require a secure context (HTTPS or localhost). Use a current Chromium, Firefox, or Safari browser. Actual browser and device capabilities determine accepted input formats and microphone latency.

## Workflow

1. Import a local WAV, MP3, M4A, OGG, or another format your browser can decode, or try the built-in synthetic test signal. The signal is deliberately not presented as a recording of a real person.
2. Select one of four sound-design presets. Adjust bandwidth, compression, preemphasis, saturation, RF quality, noise, squelch, and speaker coloration during playback.
3. Compare dry source (A) and processed radio (B), pause/resume, stop, or loop.
4. Export the complete input with the parameters captured when you clicked export. Export always uses the wet radio effect, current output volume, mono 16-bit PCM, the AudioContext sample rate, and a 350 ms release tail. Preview loop mode and dry A/B do not change the export. Conversion runs in a dedicated worker and can be cancelled.

Input is limited to 50 MB and ten minutes. Decoded audio can use much more memory than compressed input; very long/multichannel files may be expensive on mobile devices. Unsupported and corrupt files produce a recoverable error without discarding the last valid input. Mono downmix is a channel average; oppositely phased stereo material may cancel.

### Microphone

- Explicitly choose the microphone tab and start the microphone. Permission is never requested on page load.
- Wear headphones first. Monitoring is **off by default**, including each microphone restart. There can still be dangerous feedback if you enable monitoring through speakers; bounded digital samples do not guarantee a safe physical volume.
- Hold PTT, or space when focus is not on another interactive control. PTT itself also supports space/Enter. Releasing, cancelling a pointer gesture, or losing focus ends transmission.
- VOX is a separate input-level gate with a 250 ms hold, not RF squelch. It is only used for live microphone input. The dry microphone A/B path also respects PTT/VOX.
- Stop releases every microphone track and closes monitoring. Switching source modes, hiding the page, and leaving the page also release the microphone. Returning requires an explicit restart.
- This version does not record microphone sessions. WAV export applies to the imported/synthetic file only.

## Signal model and limitations

This is an artistic analog-radio effect, **not** an exact model of a particular police, military, or commercial radio, nor a P25/DMR vocoder or interoperable radio transmitter. It does not transmit RF, tune frequencies, connect to radio networks, or intercept communications. Channel names are sound presets, not actual channels.

The shared DSP chain is:

```
mono average → high-pass → envelope compressor → preemphasis
→ modest soft saturation → low-pass → noisy/fading channel
→ matched deemphasis → carrier squelch → speaker peak → bounded output
```

- Default bandwidth: 300–3000 Hz. Field preset: 450–2400 Hz with a broad +3 dB 1.3 kHz speaker peak.
- Compressor: −24 dBFS envelope threshold, default 4:1 ratio, 4 ms attack, 90 ms release. These are tunable sound-design defaults, not hardware measurements.
- Preemphasis and deemphasis use a matched one-pole/inverse pair. Saturation and channel damage between them introduce the intended coloration.
- RF quality creates seeded, irregular fades and band-limited noise. Carrier squelch has a 4-point hysteresis and 120 ms hold driven by simulated RF quality, independently of speech pauses.
- PTT/VOX release includes a 65 ms filtered-noise tail. Time constants are derived from the audio sample rate; parameters are smoothed over ~20 ms.
- Output uses soft saturation plus a defensive ±0.98 sample clamp. This is sample-peak protection, not a certified true-peak limiter; listening levels still require care.
- All filter state, timing, and the seeded PRNG run on the sample clock. File preview and offline export use the same `RadioKernel`. Live microphones and file preview run through `AudioWorklet`; offline export runs in a worker.
- Dry file A/B bypasses radio processing but retains the output-volume control and defensive clamp. It is not a bit-perfect export mode.
- The initial seed is fixed for reproducible offline exports. Pausing/restarting preview resets DSP state; changing parameters in real time, looping, stereo downmix, and resumed offsets can produce a different history than a fresh full-file export. Exact equivalence is guaranteed for the same mono input, sample rate, seed, parameter schedule, and start state, not across arbitrary UI sessions.

Engineering background: [TI reference guide (SLWU002)](https://www.ti.com/lit/ug/slwu002/slwu002.pdf) and the [Web Audio API specification](https://www.w3.org/TR/webaudio-1.0/). Neither is a claim of conformance to a specific radio.

## Project structure

```
index.html             Accessible workbench structure
src/style.css          Responsive radio-workbench interface
src/app.js             Browser UI, safe source lifecycle and transport
src/dsp.js             Shared pure JavaScript DSP kernel and presets
src/worklet.js         Real-time multichannel-to-mono adapter
src/render-worker.js   Cancellable offline conversion worker
src/wav.js             16-bit PCM WAV encoder
scripts/               Dependency-free build and local server
tests/                Node tests for DSP, adapters and static app contracts
.github/workflows/     Test/build/deploy GitHub Pages workflow
```

## GitHub Pages deployment

1. Create the desired public repository and push these source files to its `main` branch.
2. In GitHub **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. The included `pages.yml` runs tests, builds `dist/`, uploads the Pages artifact, and deploys it. Run it manually if necessary.
4. Wait for the deployment job to succeed, then open the exact URL in that job’s environment output. Verify file preview, export and microphone permissions on the HTTPS production page.

All asset, worklet, and worker URLs are relative, so both a repository subpath such as `/walkie-talkie-lab/` and a custom-domain root work without editing a base URL. The workflow has read-only repository content permission plus the minimum Pages deployment permissions. No third-party runtime/CDN assets or secrets are needed. Repository creation and publication are separate from the local build and must be confirmed by the deployment operator.

## Verification

Run `npm run check`. Automated checks cover finite/bounded samples, edge parameters and invalid input, reproducible seeded output, worklet-block/offline equivalence including the release tail, rate-consistent gate timing, squelch independence from word gaps, VOX hold, microphone dry gating, PCM WAV structure, and app/static module contracts.

Browser QA must still verify audible quality on headphones, file-format support, UI layout at desktop/mobile sizes, microphone permission denial/retry and device loss, repeated pause/stop/source switches, PTT pointer cancellation/keyboard release, hidden-page release, and actual downloads. No personal microphone input was used during development. See `QA.md` for exact executed checks and limitations.
