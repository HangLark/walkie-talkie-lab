# Reference recordings and fair comparison

Two public PoliceActivity references were inspected through their Wikimedia Commons copies, using bounded dispatch-only excerpts. Source audio is **not bundled** in this app.

- [Turlock police recording](https://commons.wikimedia.org/wiki/File:Turlock_Police_Officer_Shoots_Suspect_Holding_a_Black_Piece_of_Plastic.webm), original timeline 1:40–1:51: integrated −26.5 LUFS, true peak −6.1 dBTP. The decoded excerpt contains exact-zero spans; these cannot establish the radio noise floor.
- [Fresno police recording](https://commons.wikimedia.org/wiki/File:Fresno_Officer_Shoots_Masked_15-year-old_Boy_Pulling_Replica_Gun_From_Waistband.webm), original timeline 0:35–0:54: integrated −25.8 LUFS, true peak −5.7 dBTP.

These are recording-level measurements from mono 48 kHz PCM derived from the published Opus tracks, measured with FFmpeg ebur128. Both have little spectral energy above 3.4 kHz, but energy below 300 Hz differs substantially (about 22% versus 1%, Welch estimate). Different voices, recording chains and edits confound any attempt to infer a radio filter, compressor or speaker response. No exact device, codec, impulse response or subjective realism claim follows. Commons public-domain labels do not automatically clear all edited material.

Consequently, this revision preserves radio synthesis settings and adds a more useful comparison tool rather than fitting a supposed police-device EQ to unpaired speech.

## Optional approximate RMS-matched A/B

The ordinary A/B switch keeps identical master volume, which is not identical audio level after compression and leveling. “准备电平匹配 A/B（近似）” prepares a fixed, file-only comparison:

- The same source and parameter snapshot generate dry and wet buffers. Dry voice is delayed 24 ms, or 90 ms with local permit enabled, to align its nominal onset with wet voice. This does not remove frequency-dependent filter phase/group delay.
- A shared 20 ms source-energy mask excludes the first 120 ms and the release tail when calculating RMS. It is an energy heuristic, not speech recognition or ITU-T P.56 active speech level. At least 300 ms of retained signal is required.
- Only the louder path is attenuated to match; a shared additional attenuation maintains a 0.95 sample-peak ceiling. This is not a true-peak limiter or perceptual loudness certification. Playback volume still requires care.
- Gains remain fixed. A/B resumes the same timeline offset with short fades; both prepared buffers include the 350 ms tail. Synthetic opening/closing cues remain audible but do not set the speech-level match.
- Preparing is cancellable. Loading a different file, changing processing/output parameters or entering microphone mode invalidates the snapshot. A/B selection and loop do not. Preparation never starts playback automatically.
- Live microphones, ordinary audition and WAV exports retain their existing behavior. Matched-mode realtime meters are cleared because this separate buffer path has no live worklet meter. Export always uses original effect/output settings, never matching attenuation.

Use clean speech to judge the effect; processing an already radio-colored reference again does not establish a valid hardware match. Longer, comparable speech spans and listening at matched level are more useful than maximizing similarity to a single waveform. References: [FFmpeg ebur128 documentation](https://ffmpeg.org/ffmpeg-filters.html#ebur128), [ITU-T P.56](https://www.itu.int/rec/T-REC-P.56-201112-S/en).
