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
