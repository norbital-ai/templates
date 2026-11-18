/**
 * Local IndexedDB store for unfinished audio recordings so users can pause, reload, or resume without losing captured audio.
 */

import { Option, Schema } from 'effect';

const DB_NAME = 'norbital_hq_recordings';
const STORE_NAME = 'drafts';

const PersistedRecordingSchema = Schema.Struct({
	key: Schema.String,
	startedAt: Schema.String,
	elapsedSeconds: Schema.Number,
	mimeType: Schema.String,
	/** Each element is one contiguous MediaRecorder segment (one per browser session). */
	segments: Schema.Array(Schema.Array(Schema.instanceOf(Blob))),
	subject: Schema.optional(Schema.String),
	updatedAt: Schema.String
});
export type PersistedRecording = typeof PersistedRecordingSchema.Type;
const decodeDraft = Schema.decodeUnknownOption(PersistedRecordingSchema);

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE_NAME)) {
				req.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
	});
}

export async function loadRecordingDraft(key: string): Promise<PersistedRecording | null> {
	try {
		const db = await openDb();
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const req = tx.objectStore(STORE_NAME).get(key);
			req.onsuccess = () => resolve(Option.getOrNull(decodeDraft(req.result)));
			req.onerror = () => reject(req.error);
		});
	} catch {
		return null;
	}
}

export async function saveRecordingDraft(draft: PersistedRecording): Promise<void> {
	try {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).put(draft);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		// IndexedDB unavailable in private/test environments: in-memory capture still runs.
	}
}

export async function clearRecordingDraft(key: string): Promise<void> {
	try {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).delete(key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		// Ignore cleanup failure when IndexedDB is unavailable.
	}
}

function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
	const length = channels[0]?.length ?? 0;
	const buffer = new ArrayBuffer(44 + length * 2);
	const view = new DataView(buffer);
	const writeStr = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
	};
	writeStr(0, 'RIFF');
	view.setUint32(4, 36 + length * 2, true);
	writeStr(8, 'WAVE');
	writeStr(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeStr(36, 'data');
	view.setUint32(40, length * 2, true);
	const mono = channels[0] ?? new Float32Array(0);
	let pos = 44;
	for (let i = 0; i < length; i++) {
		const sample = Math.max(-1, Math.min(1, mono[i] ?? 0));
		view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
		pos += 2;
	}
	return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Turns one or more recorded segments into one uploadable File. A single segment keeps its native compressed container;
 * multiple segments (when resumed across page reloads) are decoded and joined into a single mono WAV.
 */
export async function buildRecordingFile(
	draft: Pick<PersistedRecording, 'segments' | 'mimeType'>,
	baseName: string
): Promise<File> {
	const nonEmpty = draft.segments.filter((seg) => seg.length > 0);
	const [only, ...later] = nonEmpty;
	if (only === undefined) throw new Error('No recorded audio available');
	if (later.length === 0) {
		const type = draft.mimeType.split(';')[0] || 'audio/webm';
		const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
		return new File([...only], `${baseName}.${ext}`, { type });
	}
	const AudioCtx = window.AudioContext;
	const audioCtx = new AudioCtx();
	try {
		const decoded = await Promise.all(
			nonEmpty.map(async (parts) => {
				const blob = new Blob([...parts], { type: draft.mimeType || 'audio/webm' });
				return audioCtx.decodeAudioData(await blob.arrayBuffer());
			})
		);
		const targetRate = 16_000;
		const totalSamples = decoded.reduce(
			(sum, buf) => sum + Math.ceil((buf.length * targetRate) / buf.sampleRate),
			0
		);
		const offline = new OfflineAudioContext(1, totalSamples, targetRate);
		let offset = 0;
		for (const buf of decoded) {
			const src = offline.createBufferSource();
			src.buffer = buf;
			src.connect(offline.destination);
			src.start(offset / targetRate);
			offset += Math.ceil((buf.length * targetRate) / buf.sampleRate);
		}
		const rendered = await offline.startRendering();
		const wav = encodeWav([rendered.getChannelData(0)], targetRate);
		return new File([wav], `${baseName}.wav`, { type: 'audio/wav' });
	} catch {
		const last = later.at(-1) ?? only;
		const type = draft.mimeType.split(';')[0] || 'audio/webm';
		const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
		return new File([...last], `${baseName}.${ext}`, { type });
	} finally {
		await audioCtx.close();
	}
}
