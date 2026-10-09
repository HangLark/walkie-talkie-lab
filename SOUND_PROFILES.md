# Sound profiles: independent voice, transport and operating perspective

## Design goal

The former “police handheld” / “digital police” choices mostly selected the operator versus receiver path. They were not two independently modeled radios. The visible sound library now describes audible acoustic characteristics, not occupations, brands, or actual network channels.

Five voice profiles change only `TIMBRE_KEYS`. Analog/digital-style transport, operator/receiver perspective, RF quality/noise/squelch, operating cues, output level, A/B, PTT and VOX are independent. Selecting or resetting a voice does not silently change any of those. RF shortcuts only change quality, noise and squelch. Applying those two kinds of selection in either order gives the same parameter state.

`PRESETS` remains a legacy internal set of full-path fixtures so tests retain operator/digital/weak-signal coverage. It is not the visible voice-profile catalogue. `TIMBRE_PROFILES` is the UI catalogue.

## Voice catalogue

These are designed combinations, not measured transfer functions or claims about particular equipment. Frequency numbers are filter control settings, not certified usable passbands.

| Voice | High/low cutoff Hz | Leveler % / ratio | Drive / emphasis | Speaker dB / Hz / Q | Body dB at 650 Hz | Intended contrast |
|---|---:|---:|---:|---:|---:|---|
| 清晰直通 | 220 / 3800 | 20 / 1.5 | 1 / .3 | 0 / 1450 / 1.1 | 0 | Wider, less nasal, more level variation |
| 经典手台 | 300 / 3000 | 65 / 3.5 | 1.4 / 1.2 | 3 / 1450 / 1.1 | 0 | Familiar forward midband, moderate compression |
| 迷你喇叭 | 650 / 2450 | 60 / 4.5 | 1.7 / 1.6 | 5.5 / 1850 / 1.8 | −6 | Thin body and concentrated small-speaker presence |
| 温厚台站 | 180 / 3200 | 35 / 2 | 1.1 / .5 | 1.8 / 950 / .7 | +3.5 | More low-mid body, broad gentle resonance |
| 紧实通话 | 350 / 2950 | 90 / 6.5 | 1.15 / .4 | 4.5 / 2200 / .65 | −4 | Leveled speech, reduced low-mid body, forward consonant region |

The last profile is deliberately not called a digital codec. Strong-signal analog and digital-style transport may sound similar with the same voice. The digital-style path only approximates burst loss, short-frame concealment and clean receiver closure; it contains no vocoder, P25/DMR implementation or measured digital speech model.

## DSP changes and bounds

Existing band limiting, bounded speech leveling, compression, pre/de-emphasis and soft saturation remain unchanged. The existing 1450 Hz speaker resonator becomes adjustable from 800–2400 Hz, Q .5–3. Its gain stays in the original 0–6 dB range. A broad 650 Hz body EQ (Q .8, −9 to +6 dB) follows the two speaker peaks. The secondary 2350 Hz peak still uses .45 × speaker gain. New numeric controls use the same 20 ms parameter smoothing and 64-sample coefficient refresh as existing filters.

A body gain of exactly zero bypasses the added filter. Default resonance is still 1450 Hz / Q1.1. Consequently all six legacy fixture presets retain sample-exact audio. No source-dependent randomness, extra delay, new dynamics trigger or cue behavior was added. Live, matched audition and WAV rendering still share one kernel.

Parameter ranges are artistic design bounds. They do not represent RSSI, SINAD, device age, fabric absorption, cabinet dimensions or a physical acoustic model. There is no room impulse response, measured speaker distortion, microphone polar pattern, actual noise suppression, encryption sound, or bitcrusher masquerading as a digital radio.

## Realistic basis and its limits

- Motorola documents adaptive microphone gain and noise suppression separately from volume-dependent speaker EQ for the APX 6000. That supports treating voice conditioning and output coloration as separate operations; it does not supply the curves used here. [Official APX 6000 page](https://www.motorolasolutions.com/en_us/products/two-way-radios/project-25-radios/portable-radios/apx6000.html)
- Tait's TB8100 specification gives examples of pre-emphasized speech-band operation and 6 dB/octave pre-emphasis. This supports restricted-band speech and pre/de-emphasis as plausible building blocks, not one universal radio passband. The wider/warmer profiles are creative acoustic combinations. [Official TB8100 manual](https://partnerinfo.taitradio.com/__data/assets/pdf_file/0019/141049/MBA-00001-16.pdf)
- Tait's DMR introduction describes the broad difference between progressive analog degradation and digital reception near its coverage edge. The existing channel follows that qualitative distinction only. [Official DMR guide](https://www.taitradioacademy.com/wp-content/uploads/2014/11/Introduction_to_DMR_Study_Guide-Tait_Radio_Academy.pdf)
- DVSI lists actual speech vocoders and rates used by digital radio systems. This app does not implement or license those codecs. [DVSI USB-3000](https://www.dvsinc.com/products/usb_3k.shtml)

## Reproducible verification

Run `node scripts/render-timbre-fixtures.mjs /tmp/radio-timbre-fixtures` for a four-second harmonic-vowel/fricative surrogate, five matched WAVs and JSON metrics. All use the same source, seed, strong analog channel, zero noise and zero cues. Each output receives one fixed gain to reach .055 RMS over the same window. These are synthetic diagnostics, not human listening results, perceptual loudness, intelligibility scores or hardware calibration.

Initial measurements at 24 kHz:

- All five matched RMS values agree within 1e−7; maximum peak is below .377.
- Pairwise waveform difference RMS divided by matched RMS is .390–1.341. This confirms the profiles do not collapse to a gain-only change, but phase differences also contribute and this is not a perceptual distance.
- The surrogate's quiet/loud contrast is 6.07 dB for clear direct versus 2.54 dB for compact speech, demonstrating a dynamics distinction in addition to filtering.
- Independent QA used a separate speech surrogate and multitone bank. All ten profile pairs differed; the closest clear/dispatch pair had normalized waveform distance .290 and RMS-normalized spectral-shape distance 2.10 dB.
- Independent QA compared all six legacy presets across six sample rates: all 36 were sample-exact against the cue-variation baseline.
- Independent transition probes covered all 25 profile pairs at five sample rates: first-sample deviation from continuing the old profile was at most .000109; within the first millisecond at most .00542. These are transient diagnostics, not a guarantee of inaudibility.

Automated tests also cover immutable dimension isolation, malformed/bounded new controls, all profiles and rapid changes across 8–192 kHz, deterministic paths and bounded finite output. Device/browser listening with ordinary speech remains necessary for a subjective realism judgment. Start quietly with headphones; bounded samples do not guarantee safe physical loudness.
