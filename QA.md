# Verification report

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
