import { decode as decodePng } from 'fast-png';
import { decode as decodeJpeg } from 'jpeg-js';
import { deepDiff } from '@norbital-ai/std/json';
import { Effect, Option, Schema } from 'effect';
import { hashPdq, pdqHashToHex } from './pdq.js';
import { currentDate } from '../../lib/clock.js';
import { parse as parseExif } from '../../lib/exif-parser.mjs';
import { exceedsSiteTolerance, SITE_LOCATION_TOLERANCE_M } from '../../lib/geo.js';

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

/** Keep in sync with `photo_evidence` model `flags` enum. */
export const photoIntegrityFlags = [
	'visual_duplicate',
	'metadata_anomaly',
	'edited_metadata',
	'low_quality',
	'missing_geolocation',
	'location_mismatch'
] as const;

type PhotoIntegrityFlag = (typeof photoIntegrityFlags)[number];

const photoIntegrityFlagNames = new Set<string>(photoIntegrityFlags);

const hexDigest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const positiveInt = Schema.Int.check(Schema.isGreaterThan(0));

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
	}).pipe(
		Effect.map((digest) =>
			[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
		)
	);
}

const photoInspectionSchema = Schema.Struct({
	sha256: hexDigest,
	/** Meta PDQ hash as 64-char hex (256-bit). */
	perceptualHash: hexDigest,
	/** PDQ quality score 0–100; Meta recommends discarding ≤49. */
	pdqQuality: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
	width: positiveInt,
	height: positiveInt,
	captureLocation: Schema.NullOr(Schema.Struct({ lat: Schema.Number, lon: Schema.Number })),
	flags: Schema.Array(Schema.Literals(photoIntegrityFlags))
});

/** Throws on any fact shape the host inspection cache was not supposed to be able to produce. */
export const decodePhotoInspection = Schema.decodeUnknownSync(photoInspectionSchema);

/**
 * Meta PDQ near-duplicate threshold as Hamming distance (ThreatExchange default ≤31).
 * Stored as a 256-dim 0/1 `vector`; L2 distance equals √Hamming, so the DB threshold is √31.
 */
const VISUAL_DUPLICATE_MAX_HAMMING = 31;
export const VISUAL_DUPLICATE_MAX_L2 = Math.sqrt(VISUAL_DUPLICATE_MAX_HAMMING);

/** Below this PDQ quality, the hash is too featureless to trust for similarity. */
const PDQ_MIN_QUALITY = 50;

const decodedImageSchema = Schema.Struct({
	data: Schema.Uint8Array,
	width: Schema.Int,
	height: Schema.Int,
	channels: Schema.Literals([3, 4]),
	format: Schema.Literals(['jpeg', 'png'])
});

type DecodedImage = Schema.Schema.Type<typeof decodedImageSchema>;

function toIsoDate(value: Date | string | undefined): string | null {
	if (value == null) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function expectedMimeType(format: 'jpeg' | 'png'): string {
	switch (format) {
		case 'jpeg':
			return 'image/jpeg';
		case 'png':
			return 'image/png';
		default: {
			const _exhaustive: never = format;
			return _exhaustive;
		}
	}
}

function captureLocationFromExif(exif: Exif): { lat: number; lon: number } | null {
	const lat = exif.latitude;
	const lon = exif.longitude;
	if (lat == null || lon == null) return null;
	return { lat, lon };
}

function decodeImage(bytes: Uint8Array): DecodedImage {
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
	throw new Error('Photo evidence currently supports JPEG and PNG images.');
}

/**
 * Inspect a JPEG/PNG evidence file.
 *
 * PDQ hashes are computed in hex here; hooks persist them as a 256-dim 0/1 `vector` via
 * `hexToBinaryEmbedding`. Near-duplicate search uses the same `findNearest` path as omni
 * embeddings (HNSW + L2). Exact duplicates
 * still use SHA-256. EXIF/GPS stays on `exifr`.
 */
export const inspectPhoto = (input: { bytes: Uint8Array; mimeType: string; now?: Date }) =>
	Effect.gen(function* () {
		const image = yield* Effect.try(() => decodeImage(input.bytes));
		// PNG decodes as RGBA; JPEG already returns RGB so the common photo path holds one raster.
		const rgb =
			image.channels === 3
				? image.data
				: (() => {
						const output = new Uint8Array(image.width * image.height * 3);
						for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
							output[j] = image.data[i];
							output[j + 1] = image.data[i + 1];
							output[j + 2] = image.data[i + 2];
						}
						return output;
					})();
		const pdq = yield* hashPdq({
			data: rgb,
			width: image.width,
			height: image.height,
			channels: 3
		});
		const perceptualHash = pdqHashToHex(pdq.hash);

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
		const expectedMime = expectedMimeType(image.format);
		if (input.mimeType.toLowerCase() !== expectedMime || capturedAheadOf(capturedAt, now)) {
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
	site: { lat: number; lon: number } | null,
	maxDistanceM = SITE_LOCATION_TOLERANCE_M
): PhotoIntegrityFlag[] {
	if (capture == null) return ['missing_geolocation'];
	if (site == null) return [];
	if (exceedsSiteTolerance(capture, site, maxDistanceM)) return ['location_mismatch'];
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
		throw new Error(
			'Photo evidence must reference exactly one job assignment or variation request.'
		);
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
	if (photo === null || photo === undefined) return null;
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
		throw new Error(
			'Photo evidence provenance is immutable; create new evidence to change its photo or parent.'
		);
	}
	const scalarFields = ['job_assignment_id', 'variation_request_id', 'source_key'] as const;
	for (const field of scalarFields) {
		if (input[field] !== undefined && input[field] !== existing[field]) {
			throw new Error(
				'Photo evidence provenance is immutable; create new evidence to change its photo or parent.'
			);
		}
	}
	if (input.source !== undefined) {
		if (deepDiff(input.source, existing.source).length > 0) {
			throw new Error(
				'Photo evidence provenance is immutable; create new evidence to change its source.'
			);
		}
	}
}
