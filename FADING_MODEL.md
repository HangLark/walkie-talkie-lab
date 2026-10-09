# Optional complex flat-fading model

Status: integrated as an optional second candidate after the monitor/RX-high-pass release. The default remains static. `fmPropagation: moving` selects Rician K=4, maximum Doppler 2 Hz and 32 rays. Rayleigh exists only in the standalone model/tests and is not a UI option. Publication and browser acceptance are separate from implementation; this document does not certify hardware equivalence.

## Why this model

A stationary single-carrier AWGN FM channel above threshold can legitimately sound like speech plus steady hiss after de-emphasis. It does not describe propagation changes while a radio or surrounding scatterers move. To model that additional mechanism, multiply the **complex RF-baseband carrier** by a time-varying complex gain before adding receiver noise. Do not multiply the final audio by random gain, generate decorative crackle, fade the receiver's thermal noise with the carrier, or describe a random process as a measured location.

Primary references describe complex Rayleigh/Rician path gains and sum-of-sinusoids simulation:
- [GNU Radio Fading Model](https://wiki.gnuradio.org/index.php/Fading_Model): scattered sinusoids, maximum normalized Doppler, line-of-sight versus non-line-of-sight, K-factor, seed.
- [MathWorks Fading Channels](https://www.mathworks.com/help/comm/ug/fading-channels.html): complex gain generation, Doppler spectrum, unit mean path-power normalization, and `fD = v*fc/c`.
- [MathWorks Rician channel](https://www.mathworks.com/help/comm/ref/comm.ricianchannel-system-object.html): K is a linear specular-to-diffuse power ratio; normalized gains represent unit total mean power.

This JavaScript module is an original small implementation of the general model. No GNU Radio/MATLAB source code or libraries are copied or bundled. Its finite-ray approximation is not claimed to reproduce a named paper's complete simulator or an exact measured propagation trace.

## Equations and parameter meanings

Scattered gain is `g(t) = sum(exp(j*(2*pi*f_n*t + phase_n))) / sqrt(N)` with `f_n = fD*cos(angle_n)`. Angles are stratified around a full circle with seeded jitter; phases are independently seeded. Avoiding exact duplicate or opposite Doppler pairs prevents persistent improper I/Q covariance in an individual finite-sinusoid realization. Expected scattered power over phase ensembles is 1.

Rician gain is `h(t) = sqrt(K/(K+1)) + g(t)/sqrt(K+1)`. The line-of-sight component is constant in this relative-frequency model; common carrier offset is outside scope. Rayleigh uses K=0. Total expected power is 1. A finite-duration realization is not rescaled to force its sample mean to exactly 1, because doing so would depend on duration and break streaming equivalence. Deep fades and occasional gains above unity are genuine outcomes, not clamped envelopes.

The FM integration computes `received = h(t)*carrier + receiverNoise`, then uses the existing receive filter/discriminator. Keep AWGN power fixed against the original unit **mean** carrier power. The user C/N therefore means average C/N; instantaneous C/N differs by `10*log10(|h(t)|²)`. The receiver limiter/discriminator suppresses ordinary carrier-amplitude variation at strong C/N. Only changes in channel phase or deteriorating instantaneous C/N should affect recovered speech.

Constructor options:
- `mode`: `static`, `rician`, or `rayleigh`. Default `static` returns exactly 1+j0 at every tick. A host should bypass the new stage entirely in static mode to preserve the existing waveform and noise sequence exactly.
- `maxDopplerHz`: 0–40 Hz, default 2 Hz. This is a rate in physical time, independent of host sample rate. Zero freezes a seeded channel realization, whereas `static` is exact unity.
- `kFactor`: 0–1000, linear power ratio, default 4. Rayleigh forces K=0. These bounds are implementation constraints, not radio specifications.
- `sinusoids`: 8–128, default 32, balancing approximation quality and CPU.
- `seed`: separate from receiver noise. Identical settings and elapsed time reproduce channel evolution regardless of render partition.

An illustrative 2 Hz maximum Doppler corresponds to about 1.3 m/s at 450 MHz. Neither frequency nor speed is inferred from the user or the device. K=4 is a moderate direct-path assumption. These parameters are examples to inspect, not a claim that every walkie-talkie walk or vehicle trip has these values.

This is **frequency-flat** fading from unresolved scattered paths. It does not add delayed echoes, delay-spread filtering, co-channel interference or FM capture. Those require additional evidence and separate models. A 12.5 kHz narrowband channel can often be approximated as flat when relevant delay spread is small relative to inverse signal bandwidth, but this assumption is not universal.

## Streaming implementation

The module maintains double-precision unit phasors and advances them by precomputed complex rotations. It sums at a gain-update rate of at least 1 kHz and linearly interpolates I/Q at the actual RF-baseband sample rate (8–192 kHz supported by this module). It never interpolates envelope or final audio. At the allowed 40 Hz maximum Doppler, interpolation is an explicit finite-bandwidth approximation. Phasors are normalized every 4096 gain updates solely to prevent numerical amplitude drift. No arrays or objects are allocated per `tick()`.

`tick()` updates scalar `i`, `q`, and `power` fields. There is no implicit audio output, network access, hardware access, or live control change. The host preconstructs a separately seeded Rician generator and advances it in physical sample time. The receiver-noise PRNG is untouched. Static mode bypasses carrier multiplication entirely. A mode change interpolates the complex gain between unity and the moving channel with a 50 ms smoothstep weight; this is a UI transition, not a measured physical propagation event. There is no post-demodulation audio fade.

## Verification and remaining acceptance

`tests/rf-fading.test.mjs` currently checks:
- Exact unity static mode at five browser rates.
- Seed repeatability, block partition invariance, finite bounds implied by the finite-ray model.
- Constant zero-Doppler realization and elapsed-time agreement across 8/44.1/48/96/192 kHz.
- Three seeded 120-second Rayleigh/Rician simulations: mean power, Rayleigh exponential-power CDF, I/Q mean/covariance/properness, and Rician mean/variance.
- Complex Doppler power concentrated inside the declared maximum, allowing finite-window leakage.
- Rejection of invalid physical parameters.

For seed 38, 120 seconds at 20 Hz maximum Doppler gave Rayleigh mean power 0.9956, power variance 0.9502 and P(power<0.1)=0.0925 (ideal exponential 0.0952). Rician K=4 gave mean power 0.9990 and variance 0.3555 (ideal 0.36). These are model sanity checks, not proof of exact Doppler autocorrelation or handset realism.

Independent statistical review passed three seeds: Rayleigh mean power 0.996–1.003 and Rician mean 0.999–1.001. Centered complex improperness was 0.002–0.017. Short-lag autocorrelation followed J0 closely; at 50 ms finite-ray results ranged 0.187–0.259 versus ideal 0.220. At 40 Hz the cross-rate gain interpolation EVM was about 0.0033 for nonmatching update grids. Standalone Node throughput was approximately 0.4–1 ms per audio-second. These are finite-approximation checks, not browser performance guarantees.

Integration verification includes:
1. Twenty SHA-256 renders frozen from published b9a10ad (five rates and four quality values, including speech/noise/tails) remain bit-exact in default static mode. Moving/static processing also leaves the underlying noise PRNG identical sample by sample.
2. Mean C/N/noise standard deviation remain constant; reported instantaneous C/N follows the pre-noise complex gain power.
3. At the same 8.8 dB mean C/N, actual BDL human speech with seed 71 remained 99.84% open under static automatic squelch, versus 74.28% with 21 state changes under moving automatic squelch. Instantaneous C/N ranged −0.59 to 12.94 dB. Open monitoring kept 100% of the moving link audible. These changes arose from the IQ channel and existing detector.
4. Tested 50 ms coherent transition smoothing and bounded output, with preserved PTT/drain/re-key and monitor behavior. Perceptual click assessment is still pending.
5. Node CPU diagnostics were performed; browser AudioWorklet deadline profiling and high-host-rate headroom have not been verified. Browser functional acceptance follows deployment.
6. Same-source listening evaluation with actual user feedback remains ongoing. Technical validation alone cannot establish perceptual realism.

## Seek, pause and export contract

A new playback processor restarts its seeded receiver-noise, filter and propagation states. Resuming or seeking to a file offset therefore starts the same deterministic channel timeline against that new input segment; it is **not** a sample-exact continuation of the full-file render. This existing fresh-processor behavior is now disclosed explicitly because moving fades make it especially noticeable. No wall-clock or random-at-playback seed is used. Full offline renders and same-input/sample-rate/seed/control-timeline replays remain deterministic and partition invariant. An uninterrupted comparison/export is the appropriate reference for whole-file waveform checks.

The moving-mode slider sets mean C/N. The primary screen bars and numeric readout use actual instantaneous model C/N telemetry (20 Hz worklet reporting), without fabricated motion; the readout is blank when no live telemetry is available. Static at strong C/N can remain clear; adding motion is not a blanket speech distortion preset. The model does not assert that fd=2 Hz and K=4 reproduce the user's walking speed, frequency, scenery or physical radio.
