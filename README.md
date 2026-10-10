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

Opening `index.html` directly with `file://` is unsupported. AudioWorklet and microphone access require a secure context (HTTPS or localhost). Use a current Chromium, Firefox, or Safari browser. Actual browser and device capabilities determine accepted input formats and microphone latency. The app requests an interactive 48 kHz AudioContext; if that rate is unsupported it uses the browser default and displays the actual rate. Local/demo files are decoded to that same context rate for playback, comparison and export. Rates above 96 kHz show a realtime-performance warning; numerical offline coverage through 192 kHz is not a realtime guarantee.

## Workflow

1. Import a local WAV, MP3, M4A, OGG, or another format your browser can decode, or load one of two bundled CMU ARCTIC human read-speech demos (SLT/BDL). The explicitly labeled nominal-input demo buttons also set a visible approximate TX input gain (SLT +9.64 dB, BDL +12.88 dB), without changing source PCM or starting playback; lower listening volume first. These licensed clean recordings are fetched from this site and processed locally; your own audio is never uploaded. The separately labeled synthetic signal is only a technical test. See [speech attribution and full license](assets/speech/ATTRIBUTION.txt).
2. Start with the single experimental, device-uncalibrated FM baseline. Choose receiving/listening path (experimental analog FM, digital loss demonstration without a vocoder, or approximate local sidetone), then adjust model C/N and automatic squelch. To hear weak/noisy reception, lower listening volume first and explicitly select “持续开放（有底噪）”; this does not enable microphone headphone monitoring or start playback. Advanced voice parameters are available for analysis; they do not select different devices. “恢复语音基线” restores voice parameters only, preserving source, channel and operating choices. Matched A/B refresh preserves position and play intent; held microphone PTT releases safely and monitoring stays user-controlled. See [baseline behavior](SOUND_PROFILES.md) and the [fidelity ledger](FIDELITY_LEDGER.md).
3. Use the persistent audition bar to compare dry source (A) and processed radio (B), pause/resume, stop, seek, or loop while adjusting the sound. Listening volume is separate from the processing/output parameters.
4. Export the complete input with the parameters captured when you clicked export. Export always uses the wet radio effect, current output volume, mono 16-bit PCM, the AudioContext sample rate, and a finite 350 ms receiver postroll. There is no added listening preroll; a continuously open receiver also ends at this file-window boundary. The final 10 ms fades to zero within that existing window to avoid a hard capture cut; this playback/recording envelope is not radio squelch. Preview loop mode and dry A/B do not change the export. Conversion runs in a dedicated worker and can be cancelled.

Input is limited to 50 MB and ten minutes. Decoded audio can use much more memory than compressed input; very long/multichannel files may be expensive on mobile devices. Unsupported and corrupt files produce a recoverable error without discarding the last valid input. Mono downmix is a channel average; oppositely phased stereo material may cancel.

### Optional level-matched file comparison

Choose **准备电平匹配 A/B（近似）** to prepare fixed-gain dry/wet snapshots. This is approximate shared-mask RMS matching, not a perceptual loudness standard: the louder path is attenuated, dry voice receives the same nominal 24/90 ms delay as wet voice, and both snapshots retain the 350 ms tail. Preparation preserves the current position and play/pause intent; A/B preserves the timeline offset with short fades. Live meters are cleared on this separate audition path.

Preparation is cancellable. Processing/output changes automatically refresh the matched snapshots, preserving position and play/pause intent rather than requiring another prepare/play sequence. Playback resumes after preparation only when playback was requested; preparing while paused stays paused. Changing the source or source mode cancels the old comparison. Microphones and WAV export do not use matching attenuation. Silent, very short, nonfinite or over-full-scale sources are rejected for matching. Ordinary playback remains available. See [reference analysis and limitations](REFERENCE_CALIBRATION.md) for the two recording sources and why their speech spectra were not treated as measured radio hardware responses.

### Microphone

- Explicitly choose the microphone tab and start the microphone. Permission is never requested on page load.
- Wear headphones first. Monitoring is **off by default**, including each microphone restart. There can still be dangerous feedback if you enable monitoring through speakers; bounded digital samples do not guarantee a safe physical volume.
- To hear clear PTT cues, select **B 电台**, wear headphones at low volume, then explicitly enable **耳机监听**. With monitoring off, neither voice nor cues reach the speakers; meters can still move. Choose **实验性模拟 FM + 远端接收** for model-generated carrier/squelch transitions, or **本机操作员** and a permit option for synthesized local talk-permit and operator sidetone. Restoring the voice baseline does not change those choices.
- Hold PTT, or space when focus is not on another interactive control. PTT itself also supports space/Enter. Releasing, cancelling a pointer gesture, or losing focus ends transmission, not the remote receiver session. With headphone monitoring explicitly enabled and “持续开放（有底噪）” selected, finite-C/N carrier-off noise continues before and after PTT. The mathematical noiseless limit remains silent.
- VOX is a separate input-level gate with a 250 ms hold, not RF squelch. It is only used for live microphone input. The dry microphone A/B path also respects PTT/VOX.
- Stop releases every microphone track and closes monitoring. Switching source modes, hiding the page, and leaving the page also release the microphone. Hiding the page pauses file listening too; returning never resumes audio automatically. Returning requires an explicit restart.
- This version does not record microphone sessions. WAV export applies to the loaded local/demo file only and is hidden in microphone mode. The file export identifies its source; changing the source or source mode cancels any pending export.

## Signal model and limitations

The default is now an **experimental generic narrowband FM complex-baseband link** with a line-output listening target. It is not a measured handheld, police-radio model, P25/DMR vocoder or interoperable transmitter. It neither transmits RF nor connects to radio networks. Technical mechanism tests do not establish authentic sound for a particular radio. See [the fidelity ledger](FIDELITY_LEDGER.md) and [FM implementation](ANALOG_FM_MODEL.md).

### Analog receiver (default)

```
clean mono speech → buffered voice → explicit TX input gain (manual default 0 dB)
→ fixed TX bandwidth → optional bounded mic AGC (off by default)
→ 750 µs preemphasis → hard limiter → 4.5 kHz post-limit filter → final ±2.5 kHz deviation guard
→ complex FM modulator → optional Rician complex flat fading → complex additive Gaussian noise
→ 6 kHz complex receive low-pass → phase-difference FM discriminator
→ 750 µs deemphasis / audio low-pass → discriminator-noise squelch
→ optional output EQ (off by default) → output volume / sample ceiling
```

The 300–3000 Hz voice range, 750 µs emphasis and ±2.5 kHz deviation at nominal 12.5 kHz spacing are generic reference anchors from the [Motorola MTR3000 specification](https://www.motorolasolutions.com/content/dam/msi/docs/business/products/two-way_radios_-_public_safety/base_stations/mtr3000/documents/staticfiles/r3-2-2010a_mtr3000_spec_sht_final.pdf), not an MTR3000 transfer-function fit. Combined TX/RX filter response is not a flat measured hardware bandwidth. The optional moving channel has illustrative narrowband flat fading, not a site-specific multipath delay profile. The model still has no adjacent-channel interference, frequency-selective delayed multipath, capture between competing transmitters, oscillator impairment or measured speaker response.

- The relative quality slider maps values below 100 to model C/N = −8 + 0.48 × quality dB; 100 is a mathematical noiseless link. C/N is referenced to noise passing the model's actual receive filter. It is not RSSI, SINAD, distance or a calibrated reception forecast. Shortcuts use a noiseless link, 8.8 dB near-threshold condition, and 6.4 dB weak condition; automatic squelch may silence the latter two. The default fixed-reception mode is stationary for a fixed slider value. The separate optional moving model applies seeded Rician complex gain before AWGN/discrimination; its C/N control is an ensemble-mean reference and its primary live bars/numeric C/N readout follow instantaneous model telemetry, never measured RSSI. The slider remains the mean setting; no fake bar animation is used. Condition shortcuts do not change propagation mode.
- Analog hiss emerges from I/Q noise and FM demodulation. The independent injected-noise, legacy drive/compression/emphasis and bandwidth controls are disabled because they do not participate in this fixed FM chain. The legacy speech leveler is bypassed completely on analog. Dedicated TX input gain/optional mic AGC are separate from output EQ and listening/export volume. See [transmitter input and reference model](TRANSMITTER_INPUT_MODEL.md).
- Propagation remains static by default. “移动衰落（模型）” is an illustrative flat-fading model with Rician K=4 (linear), maximum Doppler 2 Hz and 32 scattered components, blended in complex I/Q over 50 ms. It is not a recording of walking, a route/speed prediction or a voice effect. Strong reception may remain clean; use “临界 C/N” to inspect threshold behavior. Optional open-squelch monitoring can reveal noise, but remains a separate explicit choice with a low-volume warning. See [fading model](FADING_MODEL.md).
- Ordinary file pause/resume or seek creates a fresh processor at the requested audio position. Filter/noise/fading state restarts from the take seed; it does not reconstruct the channel's preceding full-file history. Thus resumed ordinary playback is not sample-identical to the corresponding full-file export segment. Ordinary file playback schedules its final 10 ms output fade on the audio clock at the source end plus 350 ms; main-thread callbacks only release the graph afterward. Source-end TX release still uses the browser’s `onended` callback, so a delayed main thread can change the internal tail timing even though it cannot extend the scheduled audible window. Pause/Stop retires only that audition’s output with a fade of at most 10 ms; it cannot fade a newer audition or the shared headphone volume. A full offline render is deterministic from its seed; prepared A/B snapshots retain their full rendered history and seek within those snapshots. This limit applies even if the same take seed is retained.
- Automatic squelch is on by default. The explicit receiver selector offers “自动静噪” and “持续开放（有底噪）”. Open mode (`fmMonitor`) bypasses only this detector gate while the receiver listening session (`receiverActive`) is active. It reveals actual FM noise without adding artificial hiss; changing this setting never enables microphone headphone monitoring or starts playback. For microphone listening, the separate headphone monitor starts OFF on every restart. When intentionally enabled, the open receiver stays active through idle, PTT, release and re-key, without a per-PTT gate fade or `tailMs` cutoff. The mathematical noiseless link has no idle hiss. Stop, headphone-monitor off, source-mode change and hidden/leaving-page cleanup end listening. The threshold and automatic-tail controls are disabled in open mode.
- Receiver acquisition is not a promise of lossless speech onset. The fixed voice buffer remains 24 ms; RF filters and automatic squelch can take longer to settle after idle, so speaking immediately on PTT may lose the opening speech. No extra adaptive speech queue, artificial leading noise or readiness timer is added. Live status distinguishes receiver muting from transmitter release; it does not claim a measured ready time. Automatic operation does not guarantee audible opening or closing noise on every transmission.
- Squelch detects demodulated high-frequency noise above 4.5 kHz and checks received power. Its model-specific close threshold is 1800 × exp(−squelch/33) Hz RMS, with an 80% opening threshold and 120 ms hold. This is not a calibrated hardware squelch scale.
- Opening/closing noise comes from carrier/filter/discriminator behavior. No synthesized analog start/tail is added. In automatic mode only, tail duration caps the carrier-off noisy gate window after the 24 ms voice buffer and 20 ms filter drain. At the noiseless limit there is no manufactured static. In automatic mode, setting tail to zero suppresses that optional post-carrier window; this does not simulate reverse-burst signaling itself.
- Internal processing runs at an integer multiple of the audio sample rate at or above 48 kHz, with interpolation/decimation filtering. The added filtering contributes latency; nominal A/B onset alignment cannot cancel frequency-dependent phase/group delay.

### Other paths

Digital-style reception remains a qualitative 20 ms burst-loss demonstration, with brief decaying last-good-frame repetition and crossfaded recovery. There is **no IMBE, AMBE, P25 or DMR vocoder** or calibrated BER-to-loss relation. Local operator sidetone is an app audition aid using the earlier audio-domain approximation. It bypasses remote RF and has optional synthetic single/triple permit tones; they are not branded recordings. Local permit controls are disabled for receiver listening. Neither alternate path should be treated as a physical device replica.

Live PTT/VOX gates and source-workflow safeguards remain shared. Natural file completion retains a finite 350 ms receiver postroll; explicit pause/Stop silences playback immediately. Wet voice retains its existing fixed buffer and automatic drain; output samples are bounded, but headphone/speaker volume can still be unsafe. A take keeps one seed across preview, comparison and export; source replacement creates a new seed. Exact equivalence requires identical mono input, rate, seed, parameter history and start state, not arbitrary live sessions.

### Transmitter input and explicit reference setup

Manual input gain starts at 0 dB; optional “麦克风自动增益（模型）” starts off. The gain range is −12 to +24 dB. AGC correction is bounded to −12/+6 dB, but its target, detector, timings and noise-floor policy are original model assumptions, not manufacturer settings. No generic compressor/legacy leveler is stacked into this FM path.

“校准输入（模型参考）” is an explicit file-only action. A worker estimates above-threshold windowed RMS, excludes DC from that estimate, measures the current numerical TX response at 1 kHz, and proposes a bounded source gain. The estimate is not ITU-T P.56, speech recognition or microphone SPL calibration; clean speech is required because noise/music can count as activity. It pauses audition and does not resume automatically. The displayed gain can be undone or manually overridden. The action does not rewrite PCM, change dry A, enable AGC, alter output/listening volume, change the take seed or request microphone permission. Uploaded files are never silently normalized. Existing manual gain persists across file replacements and remains visible.

Bundled nominal demo selection explicitly applies the verified approximate coefficients shown above. If the user manually changes gain while a demo is still loading, the newer manual choice wins. AGC remains as selected; all reference gains are defined with AGC off. Live microphones use manual guided gain adjustment, with no automatic reference-calibration action.

The transmitter meter reports the actual maximum absolute post-filter/final-guard deviation across internal samples in the latest approximately 50 ms worklet reporting window. It is labeled model kHz, not RF signal strength. Paused, alternate-path and precomputed matched-snapshot playback have no live deviation readout. Higher input drive can engage limiting, but a louder or more distorted result is not evidence of improved realism; use level-matched listening.

### Clean speech demos

The bundled CMU ARCTIC SLT/BDL samples are independent human studio/read-speech fixtures. Original a0001–a0003 PCM samples are concatenated without EQ, gain changes or resampling. Complete notices, original author credits and modification disclosure ship in [assets/speech/ATTRIBUTION.txt](assets/speech/ATTRIBUTION.txt). These are not paired clean/real-radio recordings, and no police-event audio is bundled. Loading can be cancelled; failed/obsolete requests cannot replace the current file. Playback never starts automatically.

## Radio behavior references

US public-safety radio sound depends on system, programming and listening position; there is no single universal police start/end sound. Sources checked for this revision:

- [Motorola APX 3000 user guide](https://www.motorolasolutions.com/content/dam/msi/docs/products/apx/apx3000-userguide.pdf), alert-tone table: Talk Permit is local system acceptance feedback on PTT, distinct from incoming dispatch audio.
- [L3Harris XG-25M manual](https://www.l3harris.com/sites/default/files/2020-09/cs-pspc-xg-25m-two-way-mobile-p25-phase-2-radio-manual.pdf), alert tones: Call Originate uses a short mid-pitched local tone and can be disabled. Manufacturer behaviors differ.
- [Motorola PM1200 guide](https://www.motorolasolutions.com/content/dam/msi/docs/business/_documents/user_guides/static_files/pm1200_mobile_radio_user_guide.pdf): reverse-burst operation eliminates squelch tails, so tails are optional rather than mandatory realism.
- [Codan P25 training guide via APCO](https://www.apcointl.org/~documents/docs/codan-tg-001-4-0-0-p25-training-guide/?layout=file): digital transmissions use protocol termination; this app does not turn that into an analog noise crash.
- [W2SJW reference sound collection](https://w2sjw.com/radio_sounds.html): useful comparison material distinguishing local alerts, signaling and received audio. No recordings from this collection are bundled or copied.

These documents support behavior distinctions, not our exact synthesis frequencies, durations, DSP fidelity or perceptual sound quality. No subjective realism certification is claimed. The baseline speaker resonances and advanced body EQ remain static, uncalibrated approximations. A measured microphone/speaker impulse response and level-dependent loudspeaker model are deferred pending usable transfer data; no extra hardware model or speaker-volume control was added.

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
