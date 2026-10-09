# Verification report

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
