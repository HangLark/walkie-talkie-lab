# Fidelity ledger: current audio approximation

## Scope and evidence threshold

The current application has one conservative baseline (`DEFAULTS`, historically keyed `patrol`), not five modeled devices. The initial cleanup preserved its samples; the following integration replaces analog reception with an experimental physical-mechanism FM model. Neither UI cleanup nor mechanism tests establish that it matches a particular real radio.

“Analog” now uses fixed TX bandlimiting/emphasis, deviation limiting, a complex FM modulator, additive I/Q noise, receive filtering, a phase-difference discriminator, deemphasis and noise-driven squelch. It models a generic line output, not a measured speaker. “Digital” is a loss demonstration without a vocoder. Neither path is a hardware replica.

The screen identifies the selected receiving/listening path, rather than a fictitious device/channel. Local sidetone bypasses remote RF; its RF readout is therefore suppressed. Relative quality maps to model C/N (−8 + 0.48 × quality dB, with 100 the noiseless limit). This is filter-integrated C/N, not dBm, SINAD, distance or measured signal strength; squelch remains a model-specific threshold.

## Mechanisms, implementation, and missing validation

| Mechanism and evidence | Current implementation | Missing validation / limit |
| --- | --- | --- |
| Speech bandwidth/emphasis: [Motorola MTR3000 specification](https://www.motorolasolutions.com/content/dam/msi/docs/business/products/two-way_radios_-_public_safety/base_stations/mtr3000/documents/staticfiles/r3-2-2010a_mtr3000_spec_sht_final.pdf). | Fixed nominal 300–3000 Hz TX/audio filtering, 750 µs emphasis pair, ±2.5 kHz deviation limit, nominal 12.5 kHz channel with a 6 kHz complex low-pass. | Generic parameter anchors only. Cascaded model filters do not reproduce a measured receiver response; there is no device conformance evidence. |
| FM demodulation: [GNU Radio conference implementation reference](https://pubs.gnuradio.org/index.php/grcon/article/download/15/13/82). | Complex FM modulation, I/Q Gaussian noise, receive filter and phase-difference discriminator; noise power is referenced to the actual receive filter. | No competing-carrier capture, multipath, adjacent-channel interference or oscillator impairments. No paired hardware data or human realism validation. |
| Noise squelch: [GNU Radio standard squelch implementation](https://github.com/gnuradio/gnuradio/blob/main/gr-analog/python/analog/standard_squelch.py). | High-frequency discriminator-noise detector plus received-power check, hysteresis and hold. An explicit receiver-monitor option bypasses this detector gate while preserving transmission/source-stop boundaries. Automatic squelch remains the default. | Model-specific detector threshold, not hardware SINAD/squelch calibration. Mechanism comparison does not imply identical circuit behavior. |
| Optional analog tail elimination: [Motorola PM1200 guide](https://www.motorolasolutions.com/content/dam/msi/docs/business/_documents/user_guides/static_files/pm1200_mobile_radio_user_guide.pdf#page=29). | Carrier-off FM noise can pass within a capped release window; zero duration suppresses it. No synthetic analog opening/tail is added. | Reverse-burst signaling itself is absent. Historical seeded envelope formulas in CUE_SIGNAL_MODEL.md no longer drive analog reception. |
| Local transmit-readiness alerts: [Motorola APX 3000 user guide](https://www.motorolasolutions.com/content/dam/msi/docs/products/apx/apx3000-userguide.pdf#page=44). | Single/triple synthesized local permit options; receiver has no local permit tone. Operator sidetone bypasses the remote channel. | Frequencies/timing are not branded recordings. The app's sidetone is an audition aid; real radios need not supply it. |
| Speech dynamics and small-speaker response. | Analog defaults to line output with no input leveler or speaker EQ. Optional leveler/EQ are explicit aids. Legacy audio-domain controls remain only for digital-style/local paths and are disabled when unused. | Default values and EQ are heuristic, not measured microphone/loudspeaker transfer functions, nonlinear distortion curves or hardware AGC. No five-device/preset identity is claimed. |
| Digital voice and weak-signal loss. | 20 ms two-state loss demonstration with brief decaying last-frame repetition and crossfaded recovery. | No IMBE/AMBE/P25/DMR vocoder, protocol, codec-frame mapping, BER calibration or recorded concealment behavior. A 20 ms interval does not establish protocol fidelity. |
| Fair listening comparison: [ITU-T P.56](https://www.itu.int/rec/T-REC-P.56-201112-S/en) describes active speech level; [FFmpeg ebur128](https://ffmpeg.org/ffmpeg-filters.html#ebur128) supports the previous recording analysis. | Same-source A/B with optional shared-mask RMS matching, fixed attenuation and nominal voice-delay alignment. | This implementation is not P.56, LUFS certification, a blinded preference test or a perceptual realism metric. Unpaired online speech cannot identify a device response. See [reference limits](REFERENCE_CALIBRATION.md). |

## What this revision verifies

- Initial cleanup was sample-exact against the old baseline. Subsequent analog FM integration intentionally changes the processing path and sets default leveler/speaker to zero; its mechanism tests are separate from that historical compatibility check.
- Baseline restoration changes voice parameters only and preserves channel, listening, cues, output, A/B, VOX and source/session seed.
- Restoring while holding microphone PTT releases PTT in the same atomic parameter update; monitoring does not turn on.
- File position, pause/play intent, matched-A/B refresh and export identity remain covered by regressions.
- DSP, cue variation, rapid retuning, block partitioning and output bounds remain covered at browser sample rates.

Passing these tests establishes deterministic and bounded behavior, not real-device fidelity. The experimental FM chain may replace the heuristic default after mechanism tests and workflow/safety checks. It must remain labeled experimental and uncalibrated; paired clean-input/recorded-output validation is still required before claiming hardware authenticity. Strong/weak reception and tail configuration should be compared separately, with fixed input and controlled levels; a louder or more distorted result must not be counted as more realistic.

## Weak-signal listening and receiver monitoring

A stationary high-C/N Gaussian-noise FM link can sound like fairly clean speech with steady hiss; this alone does not imply that the noise was added after speech processing. At low C/N, automatic noise squelch can close completely, including the noise. The UI now distinguishes this from stopping transmission. To inspect the channel before squelch, the user can explicitly open the receiver gate after lowering listening volume. This is separate from enabling microphone headphone monitoring and is never activated automatically by a condition shortcut.

The manual-open path is bounded by the app's PTT/source/finite-release controls. It does not implement a continuously powered receiver's idle noise, a device-specific monitor button or a claim that bypassed noise improves realism. Near-threshold C/N labels are model settings, not laboratory hardware calibrations.
