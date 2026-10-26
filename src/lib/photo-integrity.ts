import type { ImageFacts, Instant, Point, ValueOf } from '@norbital-ai/bolt';
import { exceedsSiteTolerance } from './geo.js';
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
type PhotoSource = ValueOf<{ kind: 'custom'; of: 'photo_source' }>;
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
/** A message attachment is the same photo however often it is redelivered; an upload is its file. */
export const photoSourceKey = (source: PhotoSource, fileId: string): string =>
	source.kind === 'message'
		? `${source.integration}:${source.conversation_id}:${source.attachment_id}`
		: `workspace:${fileId}`;
/** The photo's title: where it came from. */
export const photoSummary = (source: PhotoSource): string =>
	source.kind === 'workspace_upload'
		? 'Workspace upload'
		: `From ${source.integration || 'a message'}${source.sent_at ? ` · ${source.sent_at.slice(0, 10)}` : ''}`;
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
		takenAt > Date.parse(String(now)) + 86400000
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
export const exactlyOneParent = (
	job: string | null | undefined,
	variation: string | null | undefined
): boolean => (job != null && job !== '') !== (variation != null && variation !== '');
