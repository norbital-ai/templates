import { decode as decodePng } from 'fast-png';
import { decode as decodeJpeg } from 'jpeg-js';
import createLibheif from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
import { deepDiff } from '@norbital-ai/std/json';
import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect, Option, Schema } from 'effect';
import type { Row as PhotoEvidenceRow } from './$types.js';
import { digestToHex, hashPdq } from './pdq.js';
import { currentDate } from '../../lib/clock.js';
import { parse as parseExif } from '../../lib/exif-parser.mjs';
import { exceedsSiteTolerance } from '../../lib/geo.js';

const exifSchema = Schema.Struct({
	DateTimeOriginal: Schema.optional(Schema.Union([Schema.Date, Schema.String])),
	CreateDate: Schema.optional(Schema.Union([Schema.Date, Schema.String])),
	Software: Schema.optional(Schema.String),
	latitude: Schema.optional(Schema.Number),
	longitude: Schema.optional(Schema.Number)
});

type Exif = Schema.Schema.Type<typeof exifSchema>;

/** EXIF blocks are third-party and frequently malformed; a rejected block is simply absent. */
const decodeExif = Schema.decodeUnknownOption(exifSchema);

type PhotoIntegrityFlag = PhotoEvidenceRow['flags'][number];

/**
 * Whether a claimed capture time sits more than a day ahead of the moment being inspected.
 *
 * Parsing an EXIF timestamp is arithmetic on a value the file supplied, not a reading of the
 * ambient clock, so it stays out of the workflow: the workflow only reads `currentDate`.
 */
function capturedAheadOf(capturedAt: string | null, now: Date): boolean {
	if (capturedAt == null) return false;
	return new Date(capturedAt).getTime() > now.getTime() + 24 * 60 * 60 * 1000;
}

function sha256Hex(bytes: Uint8Array) {
	return Effect.tryPromise(() => {
		const copy = Uint8Array.from(bytes);
		return crypto.subtle.digest('SHA-256', copy.buffer);
	}).pipe(Effect.map((digest) => digestToHex(new Uint8Array(digest))));
}

/**
 * Meta PDQ near-duplicate threshold as Hamming distance (ThreatExchange default ≤31).
 * Stored as a 256-dim 0/1 `vector`; L2 distance equals √Hamming, so the DB threshold is √31.
 */
const VISUAL_DUPLICATE_MAX_HAMMING = 31;
export const VISUAL_DUPLICATE_MAX_L2 = Math.sqrt(VISUAL_DUPLICATE_MAX_HAMMING);

/** Keep in sync with the `photo_evidence` model's `perceptual_embedding` dimensions. */
const PDQ_DIMENSIONS = 256;

/**
 * The integrity facts every photo is born with, however it is filed: an empty hash and a zero
 * vector until the suspicion review reads the bytes, which no write path can.
 */
export const uninspectedPhotoFacts = () => ({
	sha256: '',
	perceptual_embedding: new Array<number>(PDQ_DIMENSIONS).fill(0),
	flags: [],
	matched_evidence_ids: []
});

/**
 * The stable identity of one photo's provenance, unique-indexed on the model: a channel attachment
 * is the same photo however often the provider redelivers it, and a workspace upload is its object.
 */
export const photoSourceKey = (
	source:
		| { readonly kind: 'workspace_upload' }
		| {
				readonly kind: 'channel';
				readonly provider: string;
				readonly conversation_id: string;
				readonly attachment_id: string;
		  },
	storageKey: string
): string =>
	source.kind === 'channel'
		? `${source.provider}:${source.conversation_id}:${source.attachment_id}`
		: `workspace:${storageKey}`;

/** Below this PDQ quality, the hash is too featureless to trust for similarity. */
const PDQ_MIN_QUALITY = 50;

type DecodedImage = {
	readonly data: Uint8Array;
	readonly width: number;
	readonly height: number;
	readonly channels: 3 | 4;
	readonly format: 'jpeg' | 'png' | 'heic';
};

function toIsoDate(value: Date | string | undefined): string | null {
	if (value == null) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The first entry is the canonical type; iPhones write `image/heic`, a HEIF brand `image/heif`. */
const FORMAT_MIME_TYPES: Readonly<Record<DecodedImage['format'], readonly string[]>> = {
	jpeg: ['image/jpeg'],
	png: ['image/png'],
	heic: ['image/heic', 'image/heif']
};

/**
 * A declared type that says nothing about the format: a WhatsApp document arrives as
 * `application/octet-stream`. Only a declared type that names a different format is an anomaly.
 */
const UNDECLARED_MIME_TYPES = new Set(['', 'application/octet-stream']);

function captureLocationFromExif(exif: Exif): { lat: number; lon: number } | null {
	const lat = exif.latitude;
	const lon = exif.longitude;
	if (lat == null || lon == null) return null;
	return { lat, lon };
}

/** JPEG and PNG arrive as a decoded raster directly; anything else is not a still image. */
function decodeStillImage(bytes: Uint8Array): DecodedImage | null {
	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		const decoded = decodeJpeg(bytes, {
			useTArray: true,
			// PDQ consumes RGB directly. Asking jpeg-js for RGBA would materialise a 48.8 MiB
			// 12 MP raster only for us to copy it into a second 36.6 MiB RGB allocation.
			formatAsRGBA: false,
			maxResolutionInMP: 40,
			// Canonical 3024x4032 phone photos need 134–210 MiB of jpeg-js-accounted memory,
			// depending on their sampling tables, before the RGB raster used by PDQ. The serving
			// guest separately provides native headroom; this remains a per-decode safety guard.
			maxMemoryUsageInMB: 256
		});
		return {
			data: decoded.data instanceof Uint8Array ? decoded.data : new Uint8Array(decoded.data),
			width: decoded.width,
			height: decoded.height,
			channels: 3,
			format: 'jpeg'
		};
	}
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		const decoded = decodePng(bytes);
		const channels = decoded.channels;
		if (channels !== 3 && channels !== 4) {
			throw new Error('Photo evidence PNG must be RGB or RGBA.');
		}
		return {
			data: decoded.data instanceof Uint8Array ? decoded.data : new Uint8Array(decoded.data),
			width: decoded.width,
			height: decoded.height,
			channels,
			format: 'png'
		};
	}
	return null;
}

/**
 * The HEIF container brands this pipeline accepts.
 *
 * `mif1`/`msf1` are the generic HEIF brands Apple and Samsung also write for still HEIC; `avif`
 * is deliberately absent because the decoder was bundled for HEVC-coded HEIF, not AV1.
 */
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx']);

function isHeif(bytes: Uint8Array): boolean {
	if (bytes.length < 12) return false;
	const kind = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
	const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
	return kind === 'ftyp' && HEIF_BRANDS.has(brand);
}

/**
 * Compile the bundled libheif once per isolate / Node process.
 *
 * The wasm-bundle build carries its WASM as base64 and touches no Node builtin, so it survives the
 * tenant isolate's missing `fs`/`require`. Decoding belongs in the guest for a second reason: the
 * deterministic facts are computed from the uploaded bytes themselves, not from a host-side
 * derivative that could re-encode, strip metadata or normalise dimensions.
 */
const loadLibheif = Effect.runSync(
	Effect.cached(Effect.tryPromise(() => Promise.resolve(createLibheif())))
);

const decodeHeif = (bytes: Uint8Array) =>
	Effect.gen(function* () {
		const libheif = yield* loadLibheif;
		return yield* Effect.tryPromise({
			try: async () => {
				await libheif.ready;
				const decoder = new libheif.HeifDecoder();
				const images = decoder.decode(bytes);
				if (images.length === 0) throw new Error('no HEIF image in the container');
				const image = images[0]!;
				try {
					const width = image.get_width();
					const height = image.get_height();
					const rgba = await new Promise<Uint8ClampedArray>((resolve, reject) =>
						image.display(
							{ data: new Uint8ClampedArray(width * height * 4), width, height },
							(result) =>
								result == null ? reject(new Error('HEIF display failed')) : resolve(result.data)
						)
					);
					return {
						data: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
						width,
						height,
						channels: 4,
						format: 'heic'
					} satisfies DecodedImage;
				} finally {
					for (const one of images) one.free();
					decoder.decoder.delete();
				}
			},
			catch: (cause) =>
				new Error(
					`Photo evidence could not decode this HEIF image: ${
						cause instanceof Error ? cause.message : String(cause)
					}`
				)
		});
	});

const decodeImage = (bytes: Uint8Array) =>
	Effect.gen(function* () {
		const still = yield* Effect.try(() => decodeStillImage(bytes));
		if (still !== null) return still;
		if (isHeif(bytes)) return yield* decodeHeif(bytes);
		return yield* Effect.fail(new Error('Photo evidence supports JPEG, PNG and HEIC images.'));
	});

/**
 * Inspect a JPEG, PNG or HEIC evidence file. The format is read from the bytes, never from the
 * declared mime type, and `mimeType` answers with the type the bytes actually are.
 *
 * PDQ hashes are computed in hex here; the inspection automation persists them as a 256-dim 0/1
 * `vector` via `hexToBinaryEmbedding`. Near-duplicate search uses the same `findNearest` path as omni
 * embeddings (HNSW + L2). Exact duplicates
 * still use SHA-256. EXIF/GPS stays on `exifr`.
 */
export const inspectPhoto = (input: { bytes: Uint8Array; mimeType: string | null; now?: Date }) =>
	Effect.gen(function* () {
		const image = yield* decodeImage(input.bytes);
		const pdq = yield* hashPdq(image);
		const perceptualHash = digestToHex(pdq.hash);

		let exif: Exif = {};
		const parsedExif = yield* Effect.tryPromise(() =>
			parseExif(input.bytes, image.format, {
				ifd0: { pick: ['Software'] },
				exif: { pick: ['DateTimeOriginal', 'CreateDate'] },
				// The reference tags are required for Exifr's derived signed decimal coordinates.
				gps: {
					pick: ['GPSLatitudeRef', 'GPSLatitude', 'GPSLongitudeRef', 'GPSLongitude']
				}
			})
		).pipe(
			Effect.map(decodeExif),
			Effect.catch((error: unknown) =>
				Effect.logWarning('[field-ops-photo-evidence] EXIF parsing failed', error).pipe(
					Effect.as(Option.none<Exif>())
				)
			)
		);
		if (Option.isSome(parsedExif)) exif = parsedExif.value;

		const sha256 = yield* sha256Hex(input.bytes);
		const flags = new Set<PhotoIntegrityFlag>();
		const capturedAt = toIsoDate(exif.DateTimeOriginal ?? exif.CreateDate);
		const now = input.now ?? (yield* currentDate);
		const declared = (input.mimeType ?? '').toLowerCase();
		const expected = FORMAT_MIME_TYPES[image.format];
		if (
			(!expected.includes(declared) && !UNDECLARED_MIME_TYPES.has(declared)) ||
			capturedAheadOf(capturedAt, now)
		) {
			flags.add('metadata_anomaly');
		}
		if (
			exif.Software != null &&
			/photoshop|lightroom|gimp|snapseed|pixelmator/i.test(exif.Software)
		) {
			flags.add('edited_metadata');
		}
		if (image.width < 640 || image.height < 480 || pdq.quality < PDQ_MIN_QUALITY) {
			flags.add('low_quality');
		}

		return {
			sha256,
			mimeType: expected.includes(declared) ? declared : expected[0]!,
			perceptualHash,
			pdqQuality: pdq.quality,
			width: image.width,
			height: image.height,
			captureLocation: captureLocationFromExif(exif),
			flags: [...flags]
		};
	});

/**
 * Compare the photo's GPS capture point against the job site's map location. Missing capture
 * coordinates remain an evidence attribute — messaging services commonly strip EXIF — while a
 * captured point beyond the site tolerance records a concrete contradiction for later judgement.
 */
export function evaluateCaptureGeolocation(
	capture: { lat: number; lon: number } | null,
	site: { lat: number; lon: number } | null
): PhotoIntegrityFlag[] {
	if (capture == null) return ['missing_geolocation'];
	if (site == null) return [];
	if (exceedsSiteTolerance(capture, site)) return ['location_mismatch'];
	return [];
}

/** Photo evidence must be attached to exactly one of a job assignment or a variation request. */
export function assertExactlyOnePhotoParent(
	jobAssignmentId: string | null | undefined,
	variationRequestId: string | null | undefined
): void {
	const hasJobAssignment = jobAssignmentId != null && jobAssignmentId !== '';
	const hasVariation = variationRequestId != null && variationRequestId !== '';
	if (hasJobAssignment === hasVariation) {
		refuse('Photo evidence must reference exactly one job assignment or variation request.');
	}
}

const photoEvidenceProvenanceSchema = Schema.Struct({
	job_assignment_id: Schema.optional(Schema.NullOr(Schema.String)),
	variation_request_id: Schema.optional(Schema.NullOr(Schema.String)),
	photo: Schema.optional(
		Schema.NullOr(Schema.Struct({ storage_key: Schema.optional(Schema.Unknown) }))
	),
	source_key: Schema.optional(Schema.NullOr(Schema.String)),
	source: Schema.optional(Schema.Unknown)
});

type PhotoEvidenceProvenance = Schema.Schema.Type<typeof photoEvidenceProvenanceSchema>;

/**
 * Which bytes a `photo` value names, or nothing.
 *
 * `photo` is an object, so `input.photo !== existing.photo` compares references and is true for two
 * decodes of the same file — an update that resent an unchanged photo would be refused as a
 * re-parenting attempt. The storage key is what identifies the file, so that is what is compared.
 */
const photoKey = (photo: PhotoEvidenceProvenance['photo']): string | null => {
	if (photo == null) return null;
	return typeof photo.storage_key === 'string' ? photo.storage_key : null;
};

/**
 * A settled evidence row is an audit record, not a movable file reference.
 *
 * Re-parenting a photo or replacing its asset after creation would preserve fingerprints,
 * geolocation attributes, duplicate matches, and a site-identity verdict calculated for the old
 * photo/assignment pair. Provenance is therefore immutable; correcting a filing means deleting it
 * and creating new evidence so the complete create pipeline runs again.
 */
export function assertPhotoEvidenceProvenanceUnchanged(
	input: PhotoEvidenceProvenance,
	existing: Required<PhotoEvidenceProvenance>
): void {
	if (input.photo !== undefined && photoKey(input.photo) !== photoKey(existing.photo)) {
		refuse(
			'Photo evidence provenance is immutable; create new evidence to change its photo or parent.'
		);
	}
	const scalarFields = ['job_assignment_id', 'variation_request_id', 'source_key'] as const;
	for (const field of scalarFields) {
		if (input[field] !== undefined && input[field] !== existing[field]) {
			refuse(
				'Photo evidence provenance is immutable; create new evidence to change its photo or parent.'
			);
		}
	}
	if (input.source !== undefined) {
		if (deepDiff(input.source, existing.source).length > 0) {
			refuse('Photo evidence provenance is immutable; create new evidence to change its source.');
		}
	}
}
