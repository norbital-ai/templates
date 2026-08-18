import { createHash } from 'node:crypto';
import exifr from 'exifr';
import { decode as decodePng } from 'fast-png';
import { decode as decodeJpeg } from 'jpeg-js';
import { Option, Schema } from 'effect';
import { hashPdq, pdqHashToHex } from './pdq.js';

const SITE_LOCATION_TOLERANCE_M = 500;

function haversineMeters(
	lat1: number | null | undefined,
	lon1: number | null | undefined,
	lat2: number | null | undefined,
	lon2: number | null | undefined
): number | null {
	if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
	const R = 6371000;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function exceedsSiteTolerance(
	left: { lat: number; lon: number } | null | undefined,
	right: { lat: number; lon: number } | null | undefined,
	maxDistanceM = SITE_LOCATION_TOLERANCE_M
): boolean {
	const distanceM = haversineMeters(left?.lat, left?.lon, right?.lat, right?.lon);
	return distanceM != null && distanceM > maxDistanceM;
}

const exifSchema = Schema.Struct({
	DateTimeOriginal: Schema.optional(Schema.Union([Schema.Date, Schema.String])),
	CreateDate: Schema.optional(Schema.Union([Schema.Date, Schema.String])),
	Software: Schema.optional(Schema.String),
	GPSLatitude: Schema.optional(Schema.Number),
	GPSLongitude: Schema.optional(Schema.Number)
});

type Exif = Schema.Schema.Type<typeof exifSchema>;

/** EXIF blocks are third-party and frequently malformed; a rejected block is simply absent. */
const decodeExif = Schema.decodeUnknownOption(exifSchema);

/** Keep in sync with `photo_evidence` model `flags` enum. */
export const photoIntegrityFlags = [
	'exact_duplicate',
	'visual_duplicate',
	'metadata_anomaly',
	'edited_metadata',
	'low_quality',
	'missing_geolocation',
	'location_mismatch'
] as const;

export type PhotoIntegrityFlag = (typeof photoIntegrityFlags)[number];
export const PHOTO_INTEGRITY_INSPECTION_PROFILE = 'field-operations.photo-integrity.v1';

const hexDigest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const positiveInt = Schema.Int.check(Schema.isGreaterThan(0));

export const photoInspectionSchema = Schema.Struct({
	sha256: hexDigest,
	perceptualHash: hexDigest,
	pdqQuality: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
	width: positiveInt,
	height: positiveInt,
	captureLocation: Schema.NullOr(Schema.Struct({ lat: Schema.Number, lon: Schema.Number })),
	flags: Schema.Array(Schema.Literals(photoIntegrityFlags))
});

/** Throws on any fact shape the host inspection cache was not supposed to be able to produce. */
export const decodePhotoInspection = Schema.decodeUnknownSync(photoInspectionSchema);

export interface PhotoInspection {
	sha256: string;
	/** Meta PDQ hash as 64-char hex (256-bit). */
	perceptualHash: string;
	/** PDQ quality score 0–100; Meta recommends discarding ≤49. */
	pdqQuality?: number;
	width: number;
	height: number;
	captureLocation: { lat: number; lon: number } | null;
	flags: PhotoIntegrityFlag[];
}

/**
 * Meta PDQ near-duplicate threshold as Hamming distance (ThreatExchange default ≤31).
 * Stored as a 256-dim 0/1 `vector`; L2 distance equals √Hamming, so the DB threshold is √31.
 */
export const VISUAL_DUPLICATE_MAX_HAMMING = 31;
export const VISUAL_DUPLICATE_MAX_L2 = Math.sqrt(VISUAL_DUPLICATE_MAX_HAMMING);

/** Below this PDQ quality, the hash is too featureless to trust for similarity. */
export const PDQ_MIN_QUALITY = 50;

interface DecodedImage {
	readonly data: Uint8Array;
	readonly width: number;
	readonly height: number;
	readonly channels: 3 | 4;
	readonly format: 'jpeg' | 'png';
}

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
	const lat = exif.GPSLatitude;
	const lon = exif.GPSLongitude;
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
export async function inspectPhoto(input: {
	bytes: Uint8Array;
	mimeType: string;
	now?: Date;
}): Promise<PhotoInspection> {
	const image = decodeImage(input.bytes);
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
	const pdq = await hashPdq({
		data: rgb,
		width: image.width,
		height: image.height,
		channels: 3
	});
	const perceptualHash = pdqHashToHex(pdq.hash);

	let exif: Exif = {};
	try {
		const parsed = decodeExif(
			await exifr.parse(input.bytes, {
				pick: ['DateTimeOriginal', 'CreateDate', 'Software', 'GPSLatitude', 'GPSLongitude']
			})
		);
		if (Option.isSome(parsed)) exif = parsed.value;
	} catch (error) {
		console.warn('[field-ops-photo-evidence] EXIF parsing failed', error);
	}

	const sha256 = createHash('sha256').update(input.bytes).digest('hex');
	const flags = new Set<PhotoIntegrityFlag>();
	const capturedAt = toIsoDate(exif.DateTimeOriginal ?? exif.CreateDate);
	const now = input.now ?? new Date();
	const expectedMime = expectedMimeType(image.format);
	if (
		input.mimeType.toLowerCase() !== expectedMime ||
		(capturedAt != null && new Date(capturedAt).getTime() > now.getTime() + 24 * 60 * 60 * 1000)
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
		perceptualHash,
		pdqQuality: pdq.quality,
		width: image.width,
		height: image.height,
		captureLocation: captureLocationFromExif(exif),
		flags: [...flags]
	};
}

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

export interface DuplicateEvidenceInput {
	readonly id: string;
	readonly sha256: string;
	readonly perceptualEmbedding: readonly number[] | string;
	readonly flags: readonly string[];
	readonly assignmentId: string | null;
}

export interface DuplicateEvidenceUpdate {
	readonly id: string;
	readonly flags: PhotoIntegrityFlag[];
	readonly matchedEvidenceIds: string[];
	readonly assignmentId: string | null;
}

function parseEmbedding(value: readonly number[] | string): readonly number[] | null {
	if (typeof value === 'string') {
		try {
			const parsed: unknown = JSON.parse(value);
			return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'number')
				? parsed
				: null;
		} catch {
			return null;
		}
	}
	return value;
}

function squaredL2(left: readonly number[], right: readonly number[]): number | null {
	if (left.length !== right.length || left.length === 0) return null;
	let squaredDistance = 0;
	for (let index = 0; index < left.length; index += 1) {
		const difference = left[index] - right[index];
		squaredDistance += difference * difference;
	}
	return squaredDistance;
}

/**
 * Plan duplicate flags for selected rows against one bounded corpus. The corpus includes both rows
 * that predated this createMany call and every row inserted by it, so cross-batch and within-batch
 * reuse have identical semantics without an indexed query per new photo.
 */
export function planDuplicateEvidenceBatch(
	corpus: readonly DuplicateEvidenceInput[],
	targetIds: ReadonlySet<string>
): DuplicateEvidenceUpdate[] {
	const embeddings = new Map(
		corpus.map((evidence) => [evidence.id, parseEmbedding(evidence.perceptualEmbedding)])
	);
	return corpus.flatMap((record) => {
		if (!targetIds.has(record.id)) return [];
		const flags = new Set<PhotoIntegrityFlag>(
			record.flags.filter((flag): flag is PhotoIntegrityFlag =>
				photoIntegrityFlags.some((candidate) => candidate === flag)
			)
		);
		const matchedEvidenceIds = new Set<string>();
		const exactCandidates = corpus
			.filter((candidate) => candidate.sha256 === record.sha256)
			.slice(0, 21);
		for (const candidate of exactCandidates) {
			if (candidate.id === record.id || candidate.assignmentId === record.assignmentId) continue;
			flags.add('exact_duplicate');
			matchedEvidenceIds.add(candidate.id);
		}
		const recordEmbedding = embeddings.get(record.id);
		const visualCandidates = recordEmbedding
			? corpus
					.filter((candidate) => candidate.id !== record.id)
					.flatMap((candidate) => {
						const candidateEmbedding = embeddings.get(candidate.id);
						const distance = candidateEmbedding
							? squaredL2(recordEmbedding, candidateEmbedding)
							: null;
						return distance != null && distance <= VISUAL_DUPLICATE_MAX_L2 * VISUAL_DUPLICATE_MAX_L2
							? [{ candidate, distance }]
							: [];
					})
					.sort((left, right) => left.distance - right.distance)
					.slice(0, 50)
			: [];
		for (const { candidate } of visualCandidates) {
			if (candidate.assignmentId === record.assignmentId || candidate.sha256 === record.sha256) {
				continue;
			}
			flags.add('visual_duplicate');
			matchedEvidenceIds.add(candidate.id);
		}
		return [
			{
				id: record.id,
				flags: [...flags],
				matchedEvidenceIds: [...matchedEvidenceIds],
				assignmentId: record.assignmentId
			}
		];
	});
}
