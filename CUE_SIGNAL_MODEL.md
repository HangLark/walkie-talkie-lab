# Receiver transients and fixed operator signals

This is a bounded sound-design approximation, not a measured Motorola, P25, or other radio implementation. The numeric ranges below are engineering choices. They are not taken from manufacturer measurements. RF quality is an artistic control, not RSSI or SINAD.

## What stays fixed

- Operator single permit: 960 Hz, 65 ms. Triple permit: 910/1210/1510 Hz, 19 ms each with starts 28 ms apart. Pitch, rhythm, envelope and gain calculation are unchanged; these are synthesized local UI signals, not a claim to reproduce a particular vendor's recording.
- Configured receiver squelch threshold, hysteresis and 120 ms hold are unchanged. They are not randomly retuned.
- Speech buffering stays at 24 ms for receiver mode and 90 ms for an enabled operator permit. Changing a transient cannot shorten the speech queue. Fast re-key preserves pending speech.
- Digital receiver termination remains clean. The former artificial 620 Hz receiver opening beep has been removed: this model has no configured receiver courtesy tone, and a local talk-permit is not evidence that a remote receiver should beep on every opening. Silent digital receiver input now produces no opening or closing cue.
- An operator release still uses the existing 12 ms noise transient. Its timing is fixed; noise samples naturally differ. There is no new random roger tone.

## What varies, and why

Analog receiver noise is generated continuously rather than replayed as a sound sample. At each analog receiver key-down, a separate seeded event stream chooses a slightly different opening noise envelope. At release, it chooses a slightly different residual noise envelope. Both use the instantaneous correlated RF quality; weak reception has stronger noise and greater envelope uncertainty. A fixed seed and identical parameter/event timeline reproduce the whole result.

Let `w = 1 - signalQuality / 100`, bounded to 0–1, and `u` be an independent uniform event draw:

| Property | Model | Global range |
| --- | --- | --- |
| Opening noise duration | 22.5 − 1.5w + u(0.5 + 2w) ms | 21–23.5 ms |
| Opening noise gain | .38 + .10w + (u − .5)(.04 + .06w) | .36–.53 |
| Opening sin-envelope exponent | 2.2 − .5w + (u − .5).3 | 1.55–2.35 |
| Tail residual duration | tailMs × [1 − u(.01 + .04w)] | 95–100% of tailMs |
| Tail attack | 2 + u(1 + 2w) ms | 2–5 ms |
| Tail noise gain | .46 + .13w + (u − .5)(.05 + .07w) | .435–.65 |
| Tail decay exponent | 1.75 − .4w + (u − .5).3 | 1.2–1.9 |

`tailMs` remains the configured upper limit. The slight shortening models residual noise becoming inaudible before that limit, not random variation of a programmed squelch delay. At the strongest signal, the shortening is at most 1%; at the weakest, at most 5%. This is deliberately conservative. The model retains audible noise cues at strong signal when requested by cue level; it does not infer a real receiver's reverse-burst configuration from signal quality. Set tail duration to zero for no analog tail, or cue level to zero for no synthetic cues.

No pitch or melody is randomized. Noise bandwidth stays fixed at 650–3600 Hz; changing the whole receiver's filter on every PTT would imply an unsupported configuration change. Natural noise samples, envelope shape, amplitude and weak-signal conditions supply the variation.

## Determinism and safety of timing

The event PRNG is derived from the render seed with a distinct salt. It is independent of per-sample noise, RF and digital frame PRNGs. Audio block sizes cannot change event draws. Extra idle samples cannot consume event draws, though on non-perfect signals elapsed time legitimately changes the RF state sampled by the event.

Only actual analog-receiver key-down/release transitions consume event draws; repeated parameter messages do not. Cues remain captured to the current transmission's receiver/operator and analog/digital identity. No cue length exceeds the existing buffers or export budget: the maximum receiver drain is 24 + 200 = 224 ms, below the fixed 350 ms export tail. Zero tail remains exactly zero, and rapid re-key cancels stale release noise while retaining queued speech.

## Source distinction

- [Motorola APX 3000 user guide, printed p.28 / PDF p.44](https://www.motorolasolutions.com/content/dam/msi/docs/products/apx/apx3000-userguide.pdf#page=44) identifies talk permit as an operator indication associated with transmit readiness. It does not justify adding the same beep to every remote receiver opening.
- [Motorola PM1200 user guide, printed pp.17–18 / PDF pp.29–30](https://www.motorolasolutions.com/content/dam/msi/docs/business/_documents/user_guides/static_files/pm1200_mobile_radio_user_guide.pdf#page=29) describes TPL reverse burst muting a receiver before carrier loss to eliminate squelch tail. Thus even analog reception need not always end with a noise tail.

These sources support distinguishing configured signaling from receiver noise and permitting clean termination. They do not establish the envelope values above.

## Verification

`tests/cue-variation.test.mjs` checks repeatable seeds, cross-seed and per-PTT envelope differences, independent event/sample streams, bounded quality conditioning, exact original permit formulas, silent digital receiver cues, block partition invariance, finite values across 8–192 kHz, zero controls, export drain, and queued speech on fast re-key. Existing cue, DSP, RF, workflow and integration tests remain applicable.
