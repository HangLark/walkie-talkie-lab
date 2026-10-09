# Transmitter input, optional AGC and model-reference setup

## What is supported and what is assumed

The [NTIA TR-13-495 report](https://its.ntia.gov/publications/download/tr-13-495.pdf), sections 2.2.3 and 3.2, describes a 1 kHz reference tone at −28 dBov producing 1500 Hz peak deviation, and speech setup using ITU-T P.56 active speech level. Those are distinct operations. Our file estimator is **not P.56** and cannot claim the report's calibration procedure or measured-radio equivalence.

The [Motorola CPS 2.0 help, section 2.4.8.3](https://docs-be.motorolasolutions.com/bundle/58612/raw/resource/enus/MN006055A01-AR_enus_MOTOTRBO_Customer_Programming_Software_CPS_2_0_Online_Help_User_Guide.pdf) describes analog microphone AGC with up to +6 dB boost and −12 dB attenuation, with product applicability limits and front-microphone-gain override. The official indexed excerpt was verified during this review; direct PDF retrieval was unavailable at the review date. It does not specify our detector, target, timings or post-limiter filter. Our input-gain control maps arbitrary digital source audio into model units; it is not a replica of the manufacturer's front-mic-gain register. No R7 or other specific device behavior is claimed.

## Actual implemented chain

Buffered source → explicit input gain → existing 300–3000 Hz TX bandpass → optional microphone AGC → 750 µs preemphasis → hard ±1 clip → sixth-order 4.5 kHz Butterworth low-pass → final ±1 guard → ±2500 Hz FM deviation.

The post-limit filter and final guard are declared design choices, not an NTIA FIR clone or recovered hardware circuit. The final guard prevents filter overshoot from exceeding the modeled deviation limit. The legacy SpeechLeveler is completely bypassed in the analog path; there is no stacked generic compressor/tanh treatment. Alternate digital/operator audio approximations remain unchanged by these TX controls.

- `txInputGainDb`: −12 to +24 dB, initial manual default 0 dB, smoothed over 20 ms. This is digital amplitude gain, not dB SPL or RF signal strength.
- `txMicAgc`: optional, initially false. Correction is bounded to −12/+6 dB.
- AGC assumptions: 20 ms exponential power detector, target RMS 0.25 in model units, 10 ms gain-reduction attack and 250 ms gain-increase recovery. Activity thresholds are RMS 0.01 and 10^(−42/20); after 100 ms low-energy hold, positive gain returns toward 0 dB over 300 ms. Negative gain is retained. The enable/bypass mix is smoothed over 10 ms. These numbers are not manufacturer data or P.56 settings.
- AGC processes only transmitter speech and freezes after carrier-off buffered speech drains; receiver hiss/tails do not enter its detector. Above-threshold noise can still trigger it. It is not speech recognition or noise suppression.

## Explicit file reference action

“校准输入（模型参考）” runs in a separate worker and changes only `txInputGainDb` after explicit user action. The current audio source is not rewritten. A remains original PCM, output/listening gain are unchanged, AGC retains the user's selection, and the take seed stays unchanged. Audition pauses and does not resume automatically. Cancellation, source/mode replacement, newer manual gain or worker failure cannot apply a stale proposal. A successful action can be undone until a newer gain/source choice supersedes it.

The estimator removes DC only from the level estimate (never from source PCM), uses 20 ms window energy and a relative activity threshold, and requires adequate above-threshold material. It estimates useful-window RMS, not ITU active speech level. Noise and music can be counted as activity, so use clean speech. Silent, DC-only, too-short or invalid normalized PCM is rejected.

Level convention is 20 log10(RMS / 1): a full-scale sine is −3.0103 dBov. The proposal separates:

1. Source normalization toward the −28 dBov model reference.
2. Numerical TX sensitivity needed for that 1 kHz reference to produce 1500 Hz peak deviation.

The worker measures the current TX's small-signal 1 kHz response with AGC off and 0 dB input gain, using a 0.05-peak tone for 400 ms and discarding the first 200 ms. It uses deviation RMS for response measurement. The probe is never connected to audio output. The equivalent gain is bounded to the UI's −12/+24 dB range and shown to two decimals; range clipping is reported. This is approximate model setup, not microphone acoustic calibration.

The final 48 kHz TX response at 1 kHz was approximately 0.995926 of ideal. Explicit nominal demo buttons apply verified rounded source coefficients: BDL +12.88 dB, SLT +9.64 dB. Labels announce nominal input and the applied gain remains visible. If a user adjusts gain while a demo is loading, that newer choice wins. Demo selection never starts playback or modifies dry A. Browser resampling can cause small differences from the measured reference coefficients.

Uploaded files never receive automatic analysis/normalization: they retain the visible current gain and explicitly say the new file is uncalibrated. Global startup gain remains 0 dB. Live microphone input uses guided manual gain, not whole-recording analysis. Reference coefficients assume AGC off; enabling AGC is an independent user choice, and the UI discloses that distinction.

## Meter and validation boundary

The displayed peak deviation is the maximum absolute post-filter/final-guard deviation across every internal sample in the approximately 50 ms reporting window, including internal samples between host-rate samples. It is a modulation measurement in model kHz, **not signal strength**. Idle, alternate-path and precomputed comparison playback show no live value. Reading/resetting meter counters does not change audio or AGC state.

Tests cover gain/AGC bounds and time behavior, low-energy limitations, hard limiter/post-filter/guard operation, all-rate internal peaks, block/render parity, alternate-path isolation, calibration worker response measurement, unchanged PCM, cancellation and stale results, undo, nominal-demo/manual-override behavior, and source/monitor/A/B safeguards. Strong low-level signals can remain nearly linear. Occasional limiting or changed level-matched spectra establish that processing occurs, not that a real radio has been reproduced.

Input calibration can substantially raise voice level. Lower listening volume first, then use the existing RMS-matched A/B tool; its matching is itself approximate and is not a perceptual certification. Paired hardware recordings and controlled listening are still needed for fidelity claims.
