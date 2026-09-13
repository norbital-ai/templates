/**
 * On-device transcription worker.
 *
 * Runs Whisper ASR and pyannote speaker diarization entirely in-browser via Transformers.js
 * (WASM execution, no local model files). Model weights are fetched once from the official
 * Hugging Face CDN on first use and then cached by the browser and by this worker's in-memory
 * promises for the remainder of this worker's lifetime. No audio, transcript, or any other
 * payload is ever sent to a remote transcription API or a model provider: the only network
 * traffic this worker makes is fetching the pinned model artifacts themselves.
 *
 * Protocol:
 *   in  -> { type: 'transcribe', audio: Float32Array, language: string }
 *   out -> { type: 'progress', message: string }
 *          { type: 'complete', markdown: string }
 *          { type: 'error', message: string }
 *
 * `audio` must already be a mono Float32Array sampled at 16000 Hz; resampling/downmixing is
 * done on the main thread before the buffer is transferred here.
 */

import { formatDuration } from './transcriber-format';

const MODULE_URL =
	'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

const ASR_MODEL = 'onnx-community/whisper-base_timestamped';
const ASR_REVISION = '608c49e61301901684bc36cac8f74b95ff6b5a8e';
const DIARIZATION_MODEL = 'onnx-community/pyannote-segmentation-3.0';
const DIARIZATION_REVISION = '733a93b6473d019a773298e08cefa686894b1854';
const SAMPLE_RATE = 16000;

// Ids from processor.post_process_speaker_diarization: 0 is silence/no voiced speech; 1-3 are
// anonymous speakers; 4-6 are overlapping pairs of speakers talking at once. There is no identity
// recognition, and no support for more than three anonymous speakers in a clip; automatic labels
// always need human review before they are trusted.
const SPEAKER_LABELS = {
	1: 'Speaker 1',
	2: 'Speaker 2',
	3: 'Speaker 3',
	4: 'Speaker 1 + Speaker 2 (overlap)',
	5: 'Speaker 1 + Speaker 3 (overlap)',
	6: 'Speaker 2 + Speaker 3 (overlap)'
};

let transformersModule = null;
let asrPipelinePromise = null;
let diarizationPromise = null;

async function loadTransformers() {
	if (!transformersModule) {
		transformersModule = await import(/* @vite-ignore */ MODULE_URL);
		transformersModule.env.allowLocalModels = false;
	}
	return transformersModule;
}

function reportProgress(message) {
	self.postMessage({ type: 'progress', message });
}

function modelProgressCallback(label) {
	return (info) => {
		if (!info) return;
		if (info.status === 'progress' && typeof info.progress === 'number') {
			const file = info.file ? ` (${info.file})` : '';
			reportProgress(`${label}${file}: ${Math.round(info.progress)}%`);
		} else if (info.status === 'ready' || info.status === 'done') {
			reportProgress(`${label}: ready`);
		} else if (typeof info.status === 'string') {
			reportProgress(`${label}: ${info.status}`);
		}
	};
}

// Cached across clips: once loaded for this worker's lifetime, later transcribe messages reuse
// the same pipeline/processor/model instead of re-downloading or re-initializing them.
async function getAsrPipeline() {
	if (!asrPipelinePromise) {
		asrPipelinePromise = (async () => {
			const { pipeline } = await loadTransformers();
			reportProgress('Loading speech recognition model\u2026');
			return pipeline('automatic-speech-recognition', ASR_MODEL, {
				device: 'wasm',
				dtype: 'q8',
				revision: ASR_REVISION,
				progress_callback: modelProgressCallback('Speech recognition model')
			});
		})();
	}
	return asrPipelinePromise;
}

async function getDiarization() {
	if (!diarizationPromise) {
		diarizationPromise = (async () => {
			const { AutoProcessor, AutoModelForAudioFrameClassification } = await loadTransformers();
			reportProgress('Loading speaker diarization model\u2026');
			const processor = await AutoProcessor.from_pretrained(DIARIZATION_MODEL, {
				revision: DIARIZATION_REVISION,
				progress_callback: modelProgressCallback('Speaker diarization model')
			});
			const model = await AutoModelForAudioFrameClassification.from_pretrained(DIARIZATION_MODEL, {
				device: 'wasm',
				dtype: 'fp32',
				revision: DIARIZATION_REVISION,
				progress_callback: modelProgressCallback('Speaker diarization model')
			});
			return { processor, model };
		})();
	}
	return diarizationPromise;
}

/**
 * A word chunk's [start, end] timestamp can have a null endpoint (most often the final word of
 * a clip). Fall back to the running clip position and the clip's total duration so a null
 * endpoint never turns into NaN downstream.
 */
function resolveWordSpan(chunk, previousEnd, clipDuration) {
	const raw = Array.isArray(chunk.timestamp) ? chunk.timestamp : [null, null];
	let [start, end] = raw;
	start = typeof start === 'number' && Number.isFinite(start) ? start : previousEnd;
	end = typeof end === 'number' && Number.isFinite(end) ? end : Math.max(start, clipDuration);
	if (end < start) end = start;
	return { start, end };
}

// Associate a word with the voiced diarization segment it overlaps the most. Segment id 0 (no
// speech) is never a candidate. Ties and near-misses favor whichever segment covers the word
// best; a word with no overlapping voiced segment is left unlabeled rather than guessed at.
function bestSpeakerLabel(start, end, segments) {
	let bestId = null;
	let bestOverlap = 0;
	for (const segment of segments) {
		if (!segment || segment.id === 0) continue;
		const overlap = Math.min(end, segment.end) - Math.max(start, segment.start);
		if (overlap > bestOverlap) {
			bestOverlap = overlap;
			bestId = segment.id;
		}
	}
	return bestId !== null ? (SPEAKER_LABELS[bestId] ?? 'Unknown speaker') : null;
}

function groupWords(words) {
	const lines = [];
	for (const word of words) {
		const last = lines[lines.length - 1];
		if (last && last.label === word.label) {
			// Concatenate raw chunk text as-is: inserting a separator here would wrongly space
			// out every CJK token, which carries no inter-character space of its own.
			last.text += word.text;
			last.end = word.end;
		} else {
			lines.push({ label: word.label, text: word.text, start: word.start, end: word.end });
		}
	}
	return lines;
}

function toMarkdown(lines) {
	if (lines.length === 0) return '';
	return lines
		.map(
			(line) =>
				`**[${formatDuration(line.start)}] ${line.label ?? 'Unknown speaker'}:** ${line.text.trim()}`
		)
		.join('\n\n');
}

self.onmessage = async (event) => {
	const data = event.data;
	if (!data || data.type !== 'transcribe') return;

	const { audio, language } = data;

	try {
		if (!(audio instanceof Float32Array) || audio.length === 0) {
			throw new Error('The recording has no audio to transcribe.');
		}
		const clipDuration = audio.length / SAMPLE_RATE;

		const asr = await getAsrPipeline();
		reportProgress('Transcribing speech\u2026');
		const asrResult = await asr(audio, {
			language,
			return_timestamps: 'word',
			chunk_length_s: 30
		});

		const chunks = Array.isArray(asrResult?.chunks) ? asrResult.chunks : [];
		const transcriptText = typeof asrResult?.text === 'string' ? asrResult.text.trim() : '';
		if (chunks.length === 0 || !transcriptText) {
			self.postMessage({ type: 'complete', markdown: '' });
			return;
		}

		const { processor, model } = await getDiarization();
		reportProgress('Identifying speakers\u2026');
		const inputs = await processor(audio);
		const { logits } = await model(inputs);
		const diarizationResult = processor.post_process_speaker_diarization(logits, audio.length);
		const segments = Array.isArray(diarizationResult?.[0]) ? diarizationResult[0] : [];

		let previousEnd = 0;
		const words = [];
		for (const chunk of chunks) {
			// Keep the chunk's original text as Whisper produced it: space-delimited languages
			// already carry their own separating space, and CJK output has none between
			// characters. Only the emptiness check needs a trimmed copy.
			const rawText = typeof chunk.text === 'string' ? chunk.text : '';
			if (!rawText.trim()) continue;
			const { start, end } = resolveWordSpan(chunk, previousEnd, clipDuration);
			previousEnd = end;
			const label = bestSpeakerLabel(start, end, segments);
			words.push({ text: rawText, start, end, label });
		}

		const lines = groupWords(words);
		reportProgress('Preparing transcript\u2026');
		self.postMessage({ type: 'complete', markdown: toMarkdown(lines) });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		self.postMessage({ type: 'error', message });
	}
};
