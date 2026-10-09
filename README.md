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
2. Select one of six sound-design presets. Choose receiver vs operator perspective, analog vs digital-inspired behavior, local permit tone, cue level, and analog tail duration. Bandwidth, speech leveling, compression, preemphasis, saturation, RF quality, noise, squelch, speaker coloration and cue level update during playback. Perspective/style/permit identity is captured at the next transmission; stop and replay a file to apply those changes.
3. Compare dry source (A) and processed radio (B), pause/resume, stop, or loop.
4. Export the complete input with the parameters captured when you clicked export. Export always uses the wet radio effect, current output volume, mono 16-bit PCM, the AudioContext sample rate, and a 350 ms release tail. Preview loop mode and dry A/B do not change the export. Conversion runs in a dedicated worker and can be cancelled.

Input is limited to 50 MB and ten minutes. Decoded audio can use much more memory than compressed input; very long/multichannel files may be expensive on mobile devices. Unsupported and corrupt files produce a recoverable error without discarding the last valid input. Mono downmix is a channel average; oppositely phased stereo material may cancel.

### Optional level-matched file comparison

Choose **准备电平匹配 A/B（近似）** to prepare fixed-gain dry/wet snapshots. This is approximate shared-mask RMS matching, not a perceptual loudness standard: the louder path is attenuated, dry voice receives the same nominal 24/90 ms delay as wet voice, and both snapshots retain the 350 ms tail. Press play after preparation; A/B preserves the timeline offset with short fades. Live meters are cleared on this separate audition path.

Preparation is cancellable and never starts playback automatically. Changing the source or processing/output controls invalidates the snapshot. Microphones and WAV export do not use matching attenuation. Silent, very short, nonfinite or over-full-scale sources are rejected for matching. Ordinary playback remains available. See [reference analysis and limitations](REFERENCE_CALIBRATION.md) for the two recording sources and why their speech spectra were not treated as measured radio hardware responses.

### Microphone

- Explicitly choose the microphone tab and start the microphone. Permission is never requested on page load.
- Wear headphones first. Monitoring is **off by default**, including each microphone restart. There can still be dangerous feedback if you enable monitoring through speakers; bounded digital samples do not guarantee a safe physical volume.
- To hear clear PTT cues, select **B 电台**, wear headphones at low volume, then explicitly enable **耳机监听**. With monitoring off, neither voice nor cues reach the speakers; meters can still move. **巡逻频道** gives analog receive opening/noise-tail cues; **警务手台** gives a synthesized local triple talk-permit and operator sidetone.
- Hold PTT, or space when focus is not on another interactive control. PTT itself also supports space/Enter. Releasing, cancelling a pointer gesture, or losing focus ends transmission.
- VOX is a separate input-level gate with a 250 ms hold, not RF squelch. It is only used for live microphone input. The dry microphone A/B path also respects PTT/VOX.
- Stop releases every microphone track and closes monitoring. Switching source modes, hiding the page, and leaving the page also release the microphone. Returning requires an explicit restart.
- This version does not record microphone sessions. WAV export applies to the imported/synthetic file only.

## Signal model and limitations

This is an artistic radio effect, **not** an exact model of a particular police, military, or commercial radio, nor a P25/DMR vocoder or interoperable radio transmitter. It does not transmit RF, tune frequencies, connect to radio networks, or intercept communications. Channel names are sound presets, not actual channels.

The shared DSP chain is:

```
mono average → wet-voice cue buffer → cascaded high-pass → bounded speech leveler → envelope compressor
→ preemphasis → modest soft saturation → cascaded low-pass → channel
→ matched deemphasis → burst-frame channel (digital only) → carrier squelch
→ two speaker resonances → independent sample-clock cues → bounded output
```

- Default bandwidth: 300–3000 Hz. Cascaded biquads provide stronger out-of-band rejection. Field preset: 450–2400 Hz. Two restrained speaker peaks at 1.45 and 2.35 kHz add small-loudspeaker coloration.
- Speech leveler: one **语音稳幅** control (0–100%, default 65%; close-range preset 35%). A 12 ms power detector targets 0.075 RMS only above a conservative noise/activity floor. Internal gain is bounded to 0.65–3×; gain reduction takes 12 ms and gain increase 220 ms. Below the activity floor, gain cannot rise above unity and returns toward unity after speech. Low-level background is tracked conservatively, not removed. This is not a voice classifier; loud background can still trigger gain management. Zero bypasses level adjustment.
- Compressor: −20 dBFS envelope threshold, default 3.5:1 ratio, 4 ms attack, 90 ms release. These are tunable sound-design defaults, not hardware measurements.
- Preemphasis and deemphasis use a matched one-pole/inverse pair. Saturation and channel damage between them introduce the intended coloration.
- RF quality creates seeded, correlated slow fades (160 ms smoothing), faster flutter (18 ms smoothing and a modest 3–7 Hz component), and band-limited analog noise. Full quality is perfectly steady; analog voice remains near constant above the modeled receiver threshold, rather than amplitude-modulating every strong FM signal. These are qualitative channel approximations, not measured propagation/RSSI/SINAD or distance predictions. Carrier squelch has a 4-point hysteresis and 120 ms hold driven by simulated RF quality, independently of speech pauses.
- **Receiver / analog:** a 24 ms shaped opening burst and adjustable 0–200 ms filtered-noise release (110 ms default). Setting tail to zero approximates tail elimination rather than implying every analog system has a long crash. Noise gain is sample-rate normalized. Cue level is independent of channel-noise level and speech compression/deemphasis; output volume and dry/wet selection still apply.
- **Operator:** optional synthesized single/triple local talk-permit, plus a subtle mechanical-style release click. These are deliberately approximate cues, not Motorola/Harris recordings, exact specified frequencies, or a universal transmitted roger beep. The operator monitor includes processed sidetone as a useful app audition aid; actual radios need not provide that sidetone. Local voice and permit cues bypass remote RF fading, noise, digital loss and receiver squelch. Their controls are disabled in operator perspective.
- **Digital-inspired receiver:** a brief opening transient and clean gated release, with no analog static tail or end beep. Strong reception preserves the bandwidth-limited speech without mandatory quantization or sample-hold aliasing. Weak reception uses a seeded two-state burst-loss approximation at 20 ms frame intervals, with increasing entry/persistence probabilities below quality 62. The last good frame is repeated only briefly, decaying to zero within 35 ms; 2 ms crossfades soften loss, repeated-frame seams and recovery. Loss history resets for a fresh transmission so stale words do not return. There is no packet network or codec hidden behind this model. This is not IMBE, AMBE, P25, DMR, or a reconstruction of any codec.
- Wet voice is buffered 24 ms (90 ms with operator permit enabled), then drains before the closing cue so the first and final transmitted samples survive. This adds latency to browser/device latency. Rapid re-key preserves queued voice and the previous buffer delay, replacing any pending end cue. VOX's 250 ms hang prevents cue retrigger between normal word gaps; a new phrase after hang gets a new cue.
- Cue identity and release duration are captured at their respective transmission boundaries; numeric controls are smoothed over ~20 ms. Timing, filters and cue envelopes use the sample clock, not JavaScript timers.
- Output uses soft saturation plus a defensive ±0.98 sample clamp. This is sample-peak protection, not a certified true-peak limiter; listening levels still require care.
- All filter state, timing, and the seeded PRNG run on the sample clock. File preview and offline export use the same `RadioKernel`. Live microphones and file preview run through `AudioWorklet`; offline export runs in a worker.
- Dry file A/B bypasses radio processing but retains the output-volume control and defensive clamp. It is not a bit-perfect export mode.
- The initial seed is fixed for reproducible offline exports. Pausing/restarting preview resets DSP state; changing parameters in real time, looping, stereo downmix, and resumed offsets can produce a different history than a fresh full-file export. Exact equivalence is guaranteed for the same mono input, sample rate, seed, parameter schedule, and start state, not across arbitrary UI sessions.

Engineering background: [TI reference guide (SLWU002)](https://www.ti.com/lit/ug/slwu002/slwu002.pdf) and the [Web Audio API specification](https://www.w3.org/TR/webaudio-1.0/). Neither is a claim of conformance to a specific radio.

## Radio behavior references

US public-safety radio sound depends on system, programming and listening position; there is no single universal police start/end sound. Sources checked for this revision:

- [Motorola APX 3000 user guide](https://www.motorolasolutions.com/content/dam/msi/docs/products/apx/apx3000-userguide.pdf), alert-tone table: Talk Permit is local system acceptance feedback on PTT, distinct from incoming dispatch audio.
- [L3Harris XG-25M manual](https://www.l3harris.com/sites/default/files/2020-09/cs-pspc-xg-25m-two-way-mobile-p25-phase-2-radio-manual.pdf), alert tones: Call Originate uses a short mid-pitched local tone and can be disabled. Manufacturer behaviors differ.
- [Motorola PM1200 guide](https://www.motorolasolutions.com/content/dam/msi/docs/business/_documents/user_guides/static_files/pm1200_mobile_radio_user_guide.pdf): reverse-burst operation eliminates squelch tails, so tails are optional rather than mandatory realism.
- [Codan P25 training guide via APCO](https://www.apcointl.org/~documents/docs/codan-tg-001-4-0-0-p25-training-guide/?layout=file): digital transmissions use protocol termination; this app does not turn that into an analog noise crash.
- [W2SJW reference sound collection](https://w2sjw.com/radio_sounds.html): useful comparison material distinguishing local alerts, signaling and received audio. No recordings from this collection are bundled or copied.

These documents support behavior distinctions, not our exact synthesis frequencies, durations, DSP fidelity or perceptual sound quality. No subjective realism certification is claimed. The existing two gentle speaker resonances remain a static sound-design approximation. A measured microphone/speaker impulse response and level-dependent loudspeaker model are deferred pending usable transfer data; no extra hardware model or speaker-volume control was added.

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

Run `npm run check`. Generate reproducible synthetic-only comparison WAVs with `node scripts/render-fixtures.mjs` (optional output directory and baseline DSP module path arguments). These are not human speech or real radio recordings. Automated checks cover finite/bounded samples, edge parameters and invalid input, reproducible seeded output, worklet-block/offline equivalence including the release tail, rate-consistent gate timing, squelch independence from word gaps, VOX hold, microphone dry gating, PCM WAV structure, and app/static module contracts.

Browser QA must still verify audible quality on headphones, file-format support, UI layout at desktop/mobile sizes, microphone permission denial/retry and device loss, repeated pause/stop/source switches, PTT pointer cancellation/keyboard release, hidden-page release, and actual downloads. No personal microphone input was used during development. See `QA.md` for exact executed checks and limitations.
