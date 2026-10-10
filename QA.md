# File PTT and optional tail gain · 2026-10-10

- Frozen runtime module graph uses `fm-file-ptt-v5`; the independent combined suite passed 229/229 before this cache-only update.

- Ordinary file Play/Pause now drives the same DSP TX state: Pause stops new file input immediately, keeps receiver output enabled for the existing voice/RF/squelch drain, and freezes the source position. The existing bounded 350 ms window ends with its 10 ms safety envelope.
- Rekey within that window retains one processor and its RF/filter history. Cleanup epochs reject stale timers even when that same session is reused; previous source endings cannot stop its replacement. Partial envelope recovery remains continuous through another Pause or Stop.
- Loops stay one transmission. Natural EOF releases PTT within the existing capture window. Explicit Stop, seek, source/mode changes and hidden-page cleanup remain short-fade cancellation. Pre-rendered level-matched A/B explicitly remains snapshot playback, without regenerated PTT transitions.
- Optional `tailGainDb` is labeled “尾噪衰减（额外音量处理）”, defaults to 0 dB, and ranges from −24 to 0 dB. It reaches live preview, matched wet rendering and export without changing detector controls, tail length or the unprocessed source. DSP coverage is in `tests/tail-gain.test.mjs`.
- Focused UI/real-kernel tests cover pause release, offset retention, uninterrupted-RF rekey, late callbacks, loops, EOF, lifecycle cancellation, partial-fade retoggles, snapshot semantics and parameter propagation. This does not claim microphone hardware, physical headphone or sample-identical realtime/offline validation.

---

# Automatic squelch release freeze · 2026-10-10

- Removed the transmitter-informed 6 ms release shortcut; the existing receiver detector hold and selected tail cap remain in force. No detector, FM or RF-noise coefficients changed.
- Rapid re-key during uninterrupted RF drain preserves acquisition; a genuine RF interruption or receiver-path change still reacquires. Ordinary first-key onset is unchanged, including possible immediate-speech clipping. No synthetic opening noise or extra voice delay was introduced.
- The bypass rollback and previous finite-window/per-playback shutdown safeguards remain in place. Runtime module graph uses `fm-auto-squelch-v4`.
- Final aggregate verification is recorded in the release manifest; physical headphone listening and hardware comparison remain unperformed.

---

# Scoped detector-bypass rollback · 2026-10-10

- Removed the unsolicited continuous-idle receiver semantics. Detector bypass is a bounded call-audition option, labeled “关闭自动静噪（仅通话试听）”; automatic squelch remains the default.
- The UI distinguishes active audition, finite release and silent idle. Bypass disables the detector threshold only; its release-tail cap remains available. Merely enabling headphones does not request idle noise.
- Existing per-session playback gains, 10 ms finite-window endpoint protection, 350 ms file postroll, late-callback guards and Stop/source/page lifecycle safeguards are retained.
- Focused fake-DOM/UI checks: 54 tests passed. These verify labels, controls and lifecycle parameter messages. An actual-kernel test driven by the microphone handlers verifies silent idle with headphones enabled, two calls with bounded release, and monitor-off silence; automatic-squelch repair has separate DSP checks. No physical microphone/headphone or hardware-radio validation is implied.

---

# Shutdown boundary regression checks · 2026-10-10

- Reproduced before editing: 16 session/mode-close tests showed a one-sample gate collapse before the first PTT or after a zero-tail PTT; four finite-recording tests ended at a nonzero sample. The new tests inspect every closing gate step, not just a late silence sample.
- Automatic zero-tail completion now clamps only a genuine preclose already below 1e-4 gain. Open-session and mode closures retain the existing 3 ms exponential speaker release; receiver/PTT/detector timing and the fixed 24 ms voice buffer are unchanged.
- `src/output-boundary.js` defines a separate 10 ms linear capture/playback endpoint envelope. It leaves source-plus-350 ms recording length unchanged and makes the final stored sample exactly zero. Samples before the envelope are unchanged. This is application-boundary protection, not modeled RF squelch, a forced PTT hiss, an FFT guarantee or a hardware claim.
- Shared render and WAV-worker paths apply the same envelope; matched snapshots inherit it once through `renderRadio`. Kernel-only partition tests remain exact, and complete recording comparisons explicitly apply the boundary envelope. Live playback uses the same envelope contract; browser callback timing is not claimed to be full-waveform/sample-exact with offline rendering.
- Direct old/new automatic-kernel comparison: 1,840,230 samples identical over 8/44.1/48/192 kHz, quality 30/90/100 and tail 0/110/200 ms, including idle, key-down and release. Independent review additionally compared 1,305,600 samples including re-key without differences.
- Reproduced 48 kHz open recording (48,000 zero input samples, quality 90, tail 0, seed 24): endpoint changed from +0.64498055 to exactly 0; length remains 64,800 samples. Noiseless quality-100 zero input remains exactly zero. Regression envelope checks include 8/44.1/48/192 kHz and empty/short buffers.
- These are synthetic cloud-workspace checks. Physical microphone/headphone listening, real-browser audio scheduling and a hardware-radio comparison remain separate, unperformed verification.

---

# Historical receiver-session change · 2026-10-10 (continuous-idle behavior superseded)

Work remained in the cloud workspace, restored from public source commit c3bf59fc7a194794a8d6de2f070600445937b1cd. No personal microphone or user computer was accessed; no publication is implied by this report.

- This earlier change introduced continuous open-session idle noise. That unrequested behavior is superseded by the scoped rollback above. Headphone monitoring remains a separate opt-in, OFF on every microphone restart.
- Fake DOM/audio tests exercise actual app handlers for keyboard PTT, release, blur, re-key, RF/path changes, monitor off, microphone Stop/restart, source switch, hidden/pagehide, 350 ms natural-file drain, explicit Stop and stale cleanup callbacks. They require no device permissions.
- The fixed 24 ms voice buffer is unchanged. Automatic acquisition can suppress immediate speech onset; no adaptive queue, mandatory start noise or hardware acquisition-time guarantee was added.
- File/export/matched playback remains a finite source-plus-350 ms receiver window with no extra preroll. Explicit pause/Stop and hidden-page cleanup stop listening immediately. Matched snapshots are not live receiver telemetry.
- Integrated `npm run check`: 179 tests passed, zero failures, build succeeded. App/build/server module syntax checks also passed. The publishing coordinator must repeat the final frozen-source check after any cache-version update.
- Browser rendering, physical headphone listening, real microphone permissions and device latency are separate checks. Automated waveform/lifecycle tests do not certify a physical radio match.

---

# Verification report

## 2026-10-09 Speech dynamics / channel revision

All edits, synthetic rendering and tests ran in the cloud workspace. No user computer, microphone, account/deployment configuration or runtime external dependency was used.

### Executed

- `npm run check`: **35 tests passed**, zero failures, static production build succeeded. All application and script `node --check` syntax checks also passed.
- Ten new deterministic tests cover leveler gain bounds, quiet/loud contrast, silence and low-hiss behavior, transient attack, 8–192 kHz timing, transparent strong digital channel, seeded nonperiodic clustered loss, decaying concealment, continuous loss/recovery transitions, correlated analog RF, local sidetone independence from RF controls, and weak-digital block/offline parity.
- `node scripts/render-fixtures.mjs test-results/dynamics /tmp/radio-dynamics-baseline.mjs` compares this revision to the immediately preceding DSP. Generated WAVs and measurements are synthetic only and remain ignored local test artifacts.
- Synthetic 20 dB quiet/loud input contrast becomes **6.73 dB** through the standalone leveler at full strength; low-level hiss gain is **0 dB**. In the complete close-range preset, quiet/loud output contrast changes from **13.71 dB before → 8.84 dB now**, with its deliberately gentler 35% leveler.
- At fixed quality and seed 99 over 1,000 frames, quality 96 loses **0 frames**, 48 loses **36**, and 20 loses **381** (longest weak burst 17 frames). These are model diagnostics, not real RF error rates. Concealment becomes silence after 35 ms, even during a longer burst.
- Matched strong-channel analog/digital body difference changes from **0.02652 RMS before → 0 now** with identical timbre/noise/cue controls: mandatory sample-hold damage was removed. This demonstrates clean-channel transparency, not vocoder fidelity.
- Existing monitoring-off defaults, PTT interruption/VOX safety, cue timing, dry A/B, worker adapters and source lifecycle tests remain passing.

### Limits / next listening checks

- No subjective headphone listening, real speech intelligibility or hardware-transfer measurement has been performed. Browser/device and microphone QA limitations below still apply.
- Check quiet/loud phrases with leveler at 0, 65 and 100%; check soft consonants and pauses with a noisy recording. The simple activity detector is not noise suppression and can react to loud background sound.
- Compare digital quality 96, 48 and 20 with squelch low enough to expose loss/concealment, then restore squelch. Long bad runs should decay to silence, not repeat a word indefinitely.
- Operator RF/noise/squelch controls are disabled; local sidetone should remain unchanged by their retained values. Strong digital keeps radio bandlimiting, compression and speaker EQ but has no mandatory synthetic bit-crush.
- Speaker coloration remains two static resonances. A measured or level-dependent loudspeaker model was deferred, not implemented or validated.
- Publication of this revision was authorized by the user on 2026-10-09 after reviewing the assessment/design plan. Production deployment status is recorded in the repository’s GitHub Actions runs; the executed checks above are cloud-workspace tests.

## 2026-10-09 PTT / radio-behavior revision

All work remained in the cloud workspace. No user computer, personal microphone, radio recording or RF service was accessed.

### Executed and passed

- `npm run check`: **25 tests passed**, zero failures, successful production build. `node --check` passed for all application/build/server/fixture modules.
- Silent-input PTT independently verifies audible-energy opening and closing cues at 8, 22.05, 44.1, 48, 96 and 192 kHz, even with channel noise at zero. Cue gain zero and analog tail zero disable their respective effects.
- Tests verify receiver/local-operator separation, single/triple/off permit choices, clean digital receive termination, 24/90 ms sample-rate-scaled voice buffering, repeated PTT parameter messages, VOX hang without extra bursts, rapid re-key with queued speech preserved, no stuck TX and bounded output.
- Real app event-handler code executed in a Node VM DOM harness verifies pointer up/cancel/lost capture, keyboard release, blur, preset changes while keyed, VOX switching, interactive-control keyboard exclusion and hidden-page microphone cleanup. This harness is **not** browser event/device validation.
- Prior file/WAV, Worklet adapter, dry/wet, seeded determinism and offline/live kernel equivalence tests continue passing.
- `node scripts/render-fixtures.mjs test-results/audio /tmp/radio-baseline.mjs` produced dry synthetic input, four processed preset fixtures, isolated silent-input cue fixtures and original-source-ZIP baseline comparisons. Files and measurements are in ignored `test-results/audio/`; no real speech is represented.
- At 48 kHz, default analog silent-input opening window RMS is 0.03057 (baseline 0); post-release comparison window RMS is 0.03147 (baseline 0.00121). This is measurable cue energy, **not proof of perceptual quality**. Digital receiver silent-input end RMS is exactly 0. Output fixtures remain bounded.
- A read-only code review separately checked first/last impulse preservation through 5 ms bursts. The first wet sample is delayed 1152/4320 frames at 48 kHz (24/90 ms).

### Current limits / listening checklist

- This revision has not been subjectively auditioned through headphones. Synthetic fixtures do not establish intelligibility or authenticity on real speech.
- Browser rendering, actual AudioWorklet scheduling/device latency, permission denial/retry, physical feedback safety, downloads and mobile/touch behavior require independent HTTPS browser QA. Previous cloud-browser failures below are historical, not a fresh claim that browser testing is unavailable.
- Test microphone with headphones at low volume, manually enable monitoring and select B 电台. The app never enables monitoring on its own. Verify start/end in 巡逻频道, local permit in 警务手台 and clean release in 数字警务.
- Perspective / style / permit identity applies on next transmission; for files stop/replay. Numeric timbre and cue-gain controls update live. Rapid re-key retains the previous voice-buffer delay until it drains.
- The police-inspired sound is a sound-design approximation; source references and limitations are in README.md. No manufacturer-exact tone or codec claims.
- Publishing, remote commit identity and deployment verification are separate from this local test/build report.

## Historical initial-build verification

Date: 2026-10-08. All development and checks were performed in the assigned cloud workspace. No local Mac or personal microphone was accessed.

## Passed

- `npm run check`: **14 tests passed**, zero failures, followed by a successful static production build.
- `node --check` on all application modules and build/server scripts: passed.
- DSP covers multiple audio rates (8, 22.05, 44.1, 48 and 96 kHz); gate timing includes 192 kHz.
- Actual AudioWorklet adapter executed in an isolated Node VM with simulated inputs: stereo average, output sample equality and meter reporting passed. This is adapter logic verification, not a real browser AudioWorklet execution.
- Actual export worker executed in an isolated Node VM: final WAV equals independently encoded shared-kernel output; wet export overrides dry/VOX state correctly.
- Static app contracts: unique element IDs, referenced controls, relative module endpoints, no remote assets, live status and tab accessibility markup.
- Reviewer findings addressed: rate-dependent coefficients replaced with sample-rate-derived time constants; cached parameter keys avoid per-sample array allocation; microphone dry A/B obeys PTT/VOX; file processing never inherits microphone VOX settings.

## Not verified / blocked

- Real browser rendering, mobile screenshots, real AudioWorklet scheduling, audio-device output, microphone permission flows and actual browser downloads have **not** been verified.
- The available cloud browser returned `net::ERR_CONNECTION_REFUSED` for the cloud preview at `http://localhost:4173`.
- The installed shell Chromium could not start: `socket() failed: Operation not permitted`. A permitted escalation attempt returned the same error. No access restrictions were bypassed and no local-computer fallback was used.
- GitHub repository creation, pushed commit and GitHub Pages deployment are handled separately. A successful local build does not establish publication.

## Recommended HTTPS production smoke test

1. Desktop and 390 px mobile layouts: no horizontal overflow; controls readable and keyboard reachable.
2. Load a short WAV/MP3, test signal, corrupt file, unsupported format and oversized file. Confirm useful errors and recovery.
3. Select each preset during playback; adjust controls; A/B; pause/resume; stop/restart; loop; repeatedly switch source tabs.
4. Export and cancel; verify browser download, file duration (+350 ms), mono format and audible wet effect. Dry audition should not change export.
5. With headphones at low volume, explicitly start microphone. Confirm monitoring remains OFF. Deny permission and retry; test missing/busy/disconnected devices.
6. PTT using pointer and keyboard; pointer cancellation and focus loss. Enable VOX and test hold. Check both dry and wet audition respect transmission state.
7. Switch source tab, hide page, and leave page. Confirm microphone tracks and recording indicator stop. Returning must require explicit restart.
8. Use long files and mobile hardware to evaluate memory usage and realtime performance. Listen for clipping, unexpected clicks, or harsh noise; subjective sound quality has not been certified by automated tests.


## 2026-10-09: approximate RMS-matched file A/B

- Restored exact b4f2c43 source via read-only GitHub connector; all 20 original source blobs checked against GitHub SHA-1 before changes.
- Added file-only fixed snapshot matching, cancellable worker, shared source mask, 24/90 ms nominal alignment and attenuation-only gains. Core radio DSP/presets, microphone path and export worker unchanged.
- `npm run check`: 42 tests pass, followed by static build. Seven added tests cover RMS match/attenuation, peak bounds, delay/rate behavior, invalid/silent/anti-phase/short input, actual comparison worker, stale/cancelled generation, output changes, exact A/B offset, old-worklet detachment, microphone isolation and rapid toggle/stop races.
- The app's actual JavaScript UI logic is exercised in a simulated DOM/audio context. This does not verify real browser audio-device output, perceptual loudness, audible switching quality or browser memory behavior.
- Two dispatch excerpts were measured with FFmpeg and Python locally; recordings are not included in app assets. No hardware transfer function or subjective fidelity claim was derived.
- Recommended browser check: prepare/cancel repeatedly, change output/source mid-preparation, start matched playback, toggle A/B rapidly, pause/resume/loop, switch to microphone, confirm matched audition does not change export volume; check Chinese labels at mobile width and listen for switching artifacts at low headphone volume.
