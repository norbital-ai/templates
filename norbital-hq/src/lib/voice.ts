import type { InferenceSession } from 'onnxruntime-web/wasm';
import { Effect, Schema } from 'effect';

/**
 * Speaker identification in the browser: the meeting recording is decoded here, each diarized speaker's audio becomes
 * one CAM++ voice embedding (`loadVoiceModel`), and that vector is compared with the voice profiles of the
 * customer's contacts. The server stores only the vector and the contact assignment.
 */

/**
 * Cosine at or above which a profile is offered as "Tag as …?", clear of the next profile by the margin. CAM++ puts
 * unrelated voices as high as ~0.7, so a lone profile near that is no suggestion. Validate on real meetings.
 */
export const VOICE_MATCH_THRESHOLD = 0.75;
const VOICE_MATCH_MARGIN = 0.05;
/** Automatic assignment requires a stronger match and clear separation from the next profile. */
const VOICE_AUTO_MATCH_THRESHOLD = 0.8;
const VOICE_AUTO_MATCH_MARGIN = 0.1;
const VOICE_RATE = 16_000;
/** Segments shorter than this carry too little voice to embed. */
const VOICE_MIN_SEGMENT_SECONDS = 1;
/** Audio embedded per speaker; more costs browser time without a better voiceprint. */
const VOICE_MAX_SECONDS = 60;
const MEL_BINS = 80;
const FRAME = 400; // 25 ms at 16 kHz
const SHIFT = 160; // 10 ms
const FFT = 512;

export type Segment = { readonly speaker: string; readonly start: number; readonly end: number };
type VoiceProfile = {
	readonly id: string;
	readonly name: string;
	readonly embedding: readonly number[];
};

const unit = (vector: readonly number[]): number[] => {
	const norm = Math.hypot(...vector);
	return norm === 0 ? [...vector] : vector.map((value) => value / norm);
};

export const cosine = (a: readonly number[], b: readonly number[]): number => {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i += 1) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
};

/** A profile after one more enrolled meeting: the running mean of `samples` unit vectors, re-normalized. */
export const enrol = (
	profile: readonly number[] | null | undefined,
	samples: number,
	next: readonly number[]
): number[] => {
	const added = unit(next);
	if (profile == null || samples <= 0) return added;
	return unit(profile.map((value, i) => (value * samples + (added[i] ?? 0)) / (samples + 1)));
};

/** The best profile at or above `threshold` and `margin` clear of the runner-up (or of 0 alone), else null. */
const separated = <P extends VoiceProfile>(
	embedding: readonly number[],
	profiles: readonly P[],
	threshold: number,
	margin: number
): (P & { readonly score: number }) | null => {
	const [best, next] = profiles
		.map((profile) => ({ ...profile, score: cosine(embedding, profile.embedding) }))
		.sort((a, b) => b.score - a.score);
	return best !== undefined && best.score >= threshold && best.score - (next?.score ?? 0) >= margin
		? best
		: null;
};

/** A suggestion only; a person accepts it. */
export const suggest = <P extends VoiceProfile>(
	embedding: readonly number[],
	profiles: readonly P[],
	threshold = VOICE_MATCH_THRESHOLD
) => separated(embedding, profiles, threshold, VOICE_MATCH_MARGIN);

/** Automatic assignment; ambiguous matches always stay available for a person to tag. */
export const recognise = <P extends VoiceProfile>(
	embedding: readonly number[],
	profiles: readonly P[]
) => separated(embedding, profiles, VOICE_AUTO_MATCH_THRESHOLD, VOICE_AUTO_MATCH_MARGIN);

/** One speaker's segments as sample ranges: short ones skipped, the total capped at `VOICE_MAX_SECONDS`. */
export const speakerRanges = (
	segments: readonly Segment[],
	speaker: string
): Array<readonly [number, number]> => {
	const ranges: Array<readonly [number, number]> = [];
	let left = VOICE_MAX_SECONDS;
	for (const s of segments) {
		const length = Math.min(s.end - s.start, left);
		if (s.speaker !== speaker || s.end - s.start < VOICE_MIN_SEGMENT_SECONDS || length <= 0)
			continue;
		ranges.push([Math.round(s.start * VOICE_RATE), Math.round((s.start + length) * VOICE_RATE)]);
		left -= length;
	}
	return ranges;
};

/** Channels averaged into one. */
export const mono = (channels: readonly Float32Array[]): Float32Array => {
	const out = new Float32Array(channels[0]?.length ?? 0);
	for (const channel of channels)
		for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + (channel[i] ?? 0);
	return channels.length > 1 ? out.map((value) => value / channels.length) : out;
};

const mel = (hz: number) => 1127 * Math.log(1 + hz / 700);
/** Kaldi's triangular mel weights over the 256 non-Nyquist bins, 20 Hz to Nyquist (torchaudio defaults). */
const MEL_WEIGHTS = (() => {
	const low = mel(20);
	const delta = (mel(VOICE_RATE / 2) - low) / (MEL_BINS + 1);
	return Array.from({ length: MEL_BINS }, (_, b) => {
		const [left, center, right] = [low + b * delta, low + (b + 1) * delta, low + (b + 2) * delta];
		return Float32Array.from({ length: FFT / 2 }, (_, i) => {
			const m = mel((i * VOICE_RATE) / FFT);
			return Math.max(0, Math.min((m - left) / (center - left), (right - m) / (right - center)));
		});
	});
})();
const POVEY = Float32Array.from(
	{ length: FRAME },
	(_, i) => (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1))) ** 0.85
);

/** In-place radix-2 FFT. */
const fft = (re: Float64Array, im: Float64Array) => {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i += 1) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
			[im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
		}
	}
	for (let size = 2; size <= n; size <<= 1) {
		const step = (-2 * Math.PI) / size;
		for (let start = 0; start < n; start += size)
			for (let k = 0; k < size / 2; k += 1) {
				const [wr, wi] = [Math.cos(step * k), Math.sin(step * k)];
				const [a, b] = [start + k, start + k + size / 2];
				const xr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi;
				const xi = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr;
				re[b] = (re[a] ?? 0) - xr;
				im[b] = (im[a] ?? 0) - xi;
				re[a] = (re[a] ?? 0) + xr;
				im[a] = (im[a] ?? 0) + xi;
			}
	}
};

/**
 * 80-bin Kaldi log-mel fbank of 16 kHz samples in [-1, 1] — what the model was trained on (torchaudio
 * `kaldi.fbank` defaults, dither 0) — with the per-bin mean over time removed. Row-major `frames × 80`.
 */
export const fbank = (samples: Float32Array): Float32Array => {
	const frames = samples.length < FRAME ? 0 : 1 + Math.floor((samples.length - FRAME) / SHIFT);
	const out = new Float32Array(frames * MEL_BINS);
	const re = new Float64Array(FFT);
	const im = new Float64Array(FFT);
	for (let f = 0; f < frames; f += 1) {
		const frame = samples.subarray(f * SHIFT, f * SHIFT + FRAME);
		const dc = frame.reduce((sum, value) => sum + value, 0) / FRAME;
		re.fill(0);
		im.fill(0);
		for (let i = FRAME - 1; i >= 0; i -= 1) {
			const x = (frame[i] ?? 0) - dc;
			const previous = (frame[Math.max(0, i - 1)] ?? 0) - dc;
			re[i] = (x - 0.97 * previous) * (POVEY[i] ?? 0);
		}
		fft(re, im);
		for (let b = 0; b < MEL_BINS; b += 1) {
			const weights = MEL_WEIGHTS[b] ?? new Float32Array();
			let energy = 0;
			for (let i = 0; i < FFT / 2; i += 1)
				energy += (weights[i] ?? 0) * ((re[i] ?? 0) ** 2 + (im[i] ?? 0) ** 2);
			out[f * MEL_BINS + b] = Math.log(Math.max(energy, 1.1920929e-7));
		}
	}
	for (let b = 0; b < MEL_BINS; b += 1) {
		let mean = 0;
		for (let f = 0; f < frames; f += 1) mean += out[f * MEL_BINS + b] ?? 0;
		mean /= frames || 1;
		for (let f = 0; f < frames; f += 1) out[f * MEL_BINS + b] = (out[f * MEL_BINS + b] ?? 0) - mean;
	}
	return out;
};

// ── browser only: model, decoding, inference ──

const VOICE_MODEL =
	'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/0743f301363dec56491a490f6d6cbc9d67f9a3bf/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx';

class VoiceUnavailable extends Schema.TaggedError<VoiceUnavailable>()('VoiceUnavailable', {
	message: Schema.String
}) {}
const failed = (cause: unknown) => new VoiceUnavailable({ message: String(cause) });

/**
 * Loaded on first use only, by the browser straight from the model's public hosts: large models never ship in the
 * release or pass through the host. Meeting audio stays in the browser. The model is 3D-Speaker's CAM++ (VoxCeleb,
 * Apache-2.0) as sherpa-onnx exports it, pinned by commit (SHA-256 357a834f…4129b, 29,596,978 bytes); onnxruntime's
 * wasm comes from the CDN at the installed package's own version.
 */
export const loadVoiceModel = Effect.fnUntraced(function* () {
	const { env, InferenceSession } = yield* Effect.tryPromise({
		try: () => import('onnxruntime-web/wasm'),
		catch: failed
	});
	const runtime = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${env.versions.web}/dist/`;
	env.wasm.numThreads = 1;
	env.wasm.wasmPaths = {
		wasm: `${runtime}ort-wasm-simd-threaded.wasm`,
		mjs: `${runtime}ort-wasm-simd-threaded.mjs`
	};
	return yield* Effect.acquireRelease(
		Effect.tryPromise({
			try: () =>
				InferenceSession.create(VOICE_MODEL, {
					executionProviders: ['wasm']
				}),
			catch: failed
		}),
		(session) =>
			Effect.tryPromise({ try: () => session.release(), catch: failed }).pipe(Effect.ignore)
	);
});

/** The recording as 16 kHz mono; the decoder resamples to the context's rate. */
export const decodeRecording = (url: string) =>
	Effect.tryPromise({
		try: async (signal) => {
			const bytes = await (await fetch(url, { signal })).arrayBuffer();
			const audio = await new OfflineAudioContext(1, 1, VOICE_RATE).decodeAudioData(bytes);
			return mono(
				Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
			);
		},
		catch: failed
	});

/** One embedding per speaker with enough audio; speakers without any are left out. */
export const embedSpeakers = Effect.fnUntraced(function* (
	session: InferenceSession,
	audio: Float32Array,
	segments: readonly Segment[]
) {
	const { Tensor } = yield* Effect.tryPromise({
		try: () => import('onnxruntime-web/wasm'),
		catch: failed
	});
	const embeddings: Record<string, number[]> = {};
	for (const speaker of new Set(segments.map((s) => s.speaker))) {
		const ranges = speakerRanges(segments, speaker);
		if (ranges.length === 0) continue;
		const voice = new Float32Array(ranges.reduce((sum, [a, b]) => sum + b - a, 0));
		let at = 0;
		for (const [a, b] of ranges) {
			voice.set(audio.subarray(a, b), at);
			at += b - a;
		}
		const features = fbank(voice);
		if (features.length === 0) continue;
		const result = yield* Effect.tryPromise({
			try: () =>
				session.run({
					x: new Tensor('float32', features, [1, features.length / MEL_BINS, MEL_BINS])
				}),
			catch: failed
		});
		const output = result['embedding'];
		if (output === undefined) return yield* Effect.fail(failed('Voice model returned nothing.'));
		// repository-health:allow COERCE1 -- tensor elements, floats from a float32 output.
		embeddings[speaker] = unit(Array.from(output.data, Number));
		output.dispose();
	}
	return embeddings;
});
