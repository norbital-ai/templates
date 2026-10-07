import type { ImageFacts, Instant, Point } from '@norbital-ai/bolt';
import { exceedsSiteTolerance } from './geo.js';
import * as Predicate from './guards.js';

/**
 * The template's photo rules over the host's `ctx.files.image` facts (§5.8.1): the host decodes (JPEG, PNG, HEIC),
 * hashes (SHA-256, PDQ) and reads EXIF; what counts as a duplicate, an anomaly or a mismatch is decided here.
 */

export type PhotoFlag =
	| 'exact_duplicate'
	| 'visual_duplicate'
	| 'metadata_anomaly'
	| 'edited_metadata'
	| 'low_quality'
	| 'missing_geolocation'
	| 'location_mismatch';

export type PhotoSource =
	| { readonly kind: 'workspace_upload' }
	| {
			readonly kind: 'channel';
			readonly provider: string;
			readonly conversation_id: string;
			readonly message_id: string;
			readonly attachment_id: string;
			readonly sender_id: string;
			readonly sent_at?: unknown;
	  };

/** Meta PDQ near-duplicate threshold as Hamming distance (ThreatExchange ≤ 31); L2 over 0/1 vectors is √Hamming. */
export const VISUAL_DUPLICATE_MAX_L2 = Math.sqrt(31);
const PDQ_DIMENSIONS = 256;

/** The facts every photo is born with, however it is filed, until the review reads it. */
export const uninspectedPhotoFacts = (): {
	sha256: string;
	perceptual_embedding: number[];
	flags: PhotoFlag[];
	matched_evidence_ids: string[];
} => ({
	sha256: '',
	perceptual_embedding: new Array<number>(PDQ_DIMENSIONS).fill(0),
	flags: [],
	matched_evidence_ids: []
});

/** A channel attachment is the same photo however often it is redelivered; an upload is its file. */
export const photoSourceKey = (source: PhotoSource, fileId: string): string =>
	source.kind === 'channel'
		? `${source.provider}:${source.conversation_id}:${source.attachment_id}`
		: `workspace:${fileId}`;

/** The photo's title: where it came from. */
export const photoSummary = (source: PhotoSource): string =>
	source.kind === 'workspace_upload'
		? 'Workspace upload'
		: `From ${source.provider || 'a channel'}${source.sent_at ? ` · ${String(source.sent_at).slice(0, 10)}` : ''}`;

/** A PDQ hex digest as the 256-dim 0/1 vector `perceptual_embedding` stores. */
export const hexToBinaryEmbedding = (hex: string): number[] =>
	[...hex].flatMap((digit) =>
		Number.parseInt(digit, 16).toString(2).padStart(4, '0').split('').map(Number)
	);

const FORMAT_MIME: Readonly<Record<string, readonly string[]>> = {
	jpeg: ['image/jpeg'],
	png: ['image/png'],
	heic: ['image/heic', 'image/heif'],
	heif: ['image/heif', 'image/heic']
};
/** A declared type that says nothing about the format (a WhatsApp document) is not an anomaly. */
const UNDECLARED = new Set(['', 'application/octet-stream']);

/** The flags a photo's own bytes raise, before comparing it with other photos. */
export function imageFlags(
	facts: ImageFacts,
	declaredMime: string,
	now: Instant,
	site: Point | null
): PhotoFlag[] {
	const flags = new Set<PhotoFlag>();
	const declared = declaredMime.toLowerCase();
	const expected = FORMAT_MIME[facts.format.toLowerCase()] ?? [];
	const takenAt = facts.exif.takenAt == null ? Number.NaN : Date.parse(String(facts.exif.takenAt));
	if (
		(!expected.includes(declared) && !UNDECLARED.has(declared)) ||
		takenAt > Date.parse(String(now)) + 86_400_000
	)
		flags.add('metadata_anomaly');
	if (/photoshop|lightroom|gimp|snapseed|pixelmator/i.test(facts.exif.software ?? ''))
		flags.add('edited_metadata');
	if (facts.width < 640 || facts.height < 480) flags.add('low_quality');
	const gps = facts.exif.gps;
	if (gps == null) flags.add('missing_geolocation');
	else if (site != null && exceedsSiteTolerance(gps, site)) flags.add('location_mismatch');
	return [...flags];
}

/** Photo evidence hangs off exactly one of a job assignment or a variation request. */
export const exactlyOneParent = (job: unknown, variation: unknown): boolean =>
	(job != null && job !== '') !== (variation != null && variation !== '');

const same = (left: unknown, right: unknown) =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const fileId = (file: unknown) =>
	Predicate.isObjectOrArray(file) && 'id' in file ? String(file.id) : null;

/**
 * A filed photo is an audit record: its file, parent, key and source never change. The review may still write the
 * facts. Returns the refusal, or nothing.
 */
export function provenanceChange(
	input: { readonly [field: string]: unknown },
	stored: { readonly [field: string]: unknown }
): string | undefined {
	if ('photo' in input && fileId(input['photo']) !== fileId(stored['photo']))
		return 'Photo evidence provenance is immutable; create new evidence to change its photo or parent.';
	for (const field of ['job_assignment_id', 'variation_request_id', 'source_key'])
		if (field in input && !same(input[field], stored[field]))
			return 'Photo evidence provenance is immutable; create new evidence to change its photo or parent.';
	if ('source' in input && !same(input['source'], stored['source']))
		return 'Photo evidence provenance is immutable; create new evidence to change its source.';
	return undefined;
}
