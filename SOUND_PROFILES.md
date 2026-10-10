# One baseline, independent listening and channel controls

The previous five uncalibrated voice cards have been removed from the active interface and profile catalog. They did not represent measured devices. The application now starts from one experimental generic narrowband FM line-output chain, with a fixed nominal 300–3000 Hz voice range. Its historical internal key `patrol` is retained for reset compatibility only; it is not a police-radio claim.

## User-facing behavior

- Choose receiver or local operator sidetone. The monitor names that actual path.
- Choose experimental analog FM, or the explicitly labeled digital loss demonstration without a vocoder.
- Adjust relative quality (with its explicit model C/N mapping) and discriminator-noise squelch. The analog injected-noise control is disabled; noise comes from the I/Q channel. Condition shortcuts are static model settings, not calibrated RF measurements or motion scenarios.
- The independent propagation selector defaults to fixed reception with AWGN. Optional “移动衰落（模型）” is seeded Rician complex flat fading, not a timbre preset or site-calibrated scenario. Its C/N display denotes mean model C/N; strong signals may stay clean.
- Automatic squelch is the default. “持续开放（有底噪）” explicitly bypasses the receiver noise gate to inspect weak/noisy reception; lower listening volume first. It does not enable headphone monitoring or playback. During an explicitly active headphone receiver session it stays open before and after PTT, except the mathematical noiseless limit has no hiss. Stop ends the session; file playback/export have only their finite source-plus-350 ms window. Automatic squelch can clip speech spoken immediately after PTT while the receiver settles; the 24 ms voice buffer is unchanged, with no artificial startup noise. The near-threshold shortcut is 8.8 dB model C/N; it does not silently open squelch.
- Expand advanced parameters for output EQ; the dedicated input-source group exposes manual TX gain and optional microphone AGC. Fixed analog bandwidth/emphasis and unused legacy parameters are visibly disabled; alternate audio-domain paths expose their own active controls. The “未校准” marker remains visible even at defaults.
- “恢复语音基线” restores only voice-chain parameters. Listening perspective, channel conditions, mode, cues, output, A/B, VOX, session seed and current source remain unchanged.

Ordinary file playback retains its active processor on baseline restoration. Matched comparison regenerates snapshots only when audio parameters actually changed, retaining position and play intent. A held microphone PTT is released atomically. Monitoring stays user-controlled.

## Implementation and evidence

`TIMBRE_PROFILES` contains one baseline. `TIMBRE_KEYS` defines the scope of reset. `CHANNEL_PROFILES` changes only quality/noise/squelch. The separate legacy `PRESETS` catalog remains a DSP stress-test corpus, not active UI choices or evidence of real devices.

The cleanup originally preserved the default output; subsequent integration replaces analog reception with experimental complex-baseband FM. Technical FM mechanism validation is distinct from device calibration. Low-level resonance/body controls remain in the DSP parameter schema for future calibration; adding them does not prove a loudspeaker model. `render-timbre-fixtures.mjs` now renders the sole baseline diagnostic, with synthetic voiced/fricative material. Its RMS and bounds are engineering diagnostics, not human speech listening or hardware validation.

See [the fidelity ledger](FIDELITY_LEDGER.md) for mechanisms, primary-source distinctions, missing measurements and the conditions for future improvements. See [reference calibration limits](REFERENCE_CALIBRATION.md) for why published unpaired recordings were not used to infer a device EQ.
