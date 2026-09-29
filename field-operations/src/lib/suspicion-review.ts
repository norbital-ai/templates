import type { AutomationCtx, FileRef, Id, Point } from '@norbital-ai/bolt';
import { sha256Text } from './sha256.js';
import {
	hexToBinaryEmbedding,
	imageFlags,
	VISUAL_DUPLICATE_MAX_L2,
	type PhotoFlag
} from './photo-integrity.js';
import * as Predicate from './guards.js';

/**
 * The suspicion review, one unchecked assignment at a time: its photos' facts (host-side through `ctx.files.image`, the scene
 * through `ctx.ai.embed`), scene-reuse candidates from other assignments, one structured `sys_2` turn that judges the job-site photos,
 * one two-image turn per nominated pair (a model handed five unlabelled images cross-wired them and matched different
 * bathrooms), an immutable review row per evidence basis, a suspicion log only when the judgement is suspicious
 * and no finding already stands, then the assignment's checked stamp.
 */

type Ctx = AutomationCtx;
/** A thrown facility error is its typed value (`{ kind, message | reason }`), not an `Error`. */
export const messageOf = (error: unknown): string =>
	error instanceof Error
		? error.message
		: Predicate.isObjectOrArray(error)
			? String(
					(error as { message?: unknown; reason?: unknown }).message ??
						(error as { reason?: unknown }).reason ??
						JSON.stringify(error)
				)
			: String(error);
const HIT = {
	photo: true,
	sha256: true,
	flags: true,
	job_assignment_id: true,
	variation_request_id: true
} as const;
/** The photos nearest `vector` by the named similarity (`pdq`: L2 over the PDQ bits; `scene`: cosine). */
const nearest = (ctx: Ctx, search: 'pdq' | 'scene', vector: readonly number[], limit: number) =>
	ctx.similar('photo_evidence', search, { vector: [...vector] }, { select: HIT, limit });
/** The `sys_2` model class the review asks (every one is multimodal, P39). */
export const SUSPICION_REVIEW_MODEL = 'default';
export const MAX_INFERENCE_IMAGES = 3;
export const MAX_INFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_INFERENCE_CONTEXT_CHARS = 48 * 1024;
export const MAX_INFERENCE_REASON_CHARS = 600;
const MAX_ASSET_NAME_CHARS = 256;
const MAX_COMMUNICATIONS = 24;
const MAX_MESSAGE_CHARS = 800;
const MAX_SIGNAL_IMAGES = 2;
const MAX_PROBES = 64;
const MAX_CANDIDATES = 2;
/** Candidates above this size are listed as facts but take no visual slot. */
const MAX_CANDIDATE_IMAGE_BYTES = 1024 * 1024;
/** Photos inspected per run; the rest wait for the next. */
const INSPECTIONS_PER_RUN = 50;
/** A host refusal reason is audit copy, not a transcript. */
const MAX_INSPECTION_FAILURE_REASON_CHARS = 500;
const SCENE_BACKFILL_PER_RUN = 1000;
const SCENE_BATCH = 16;
const SCENE_BATCHES_AT_ONCE = 4;
/** A scene candidate must sit this close (cosine) and beat its runner-up by the margin below. */
const SCENE_MAX_COSINE = 0.35;
/** `photo_evidence.scene_embedding`'s `dim`. */
const SCENE_DIMENSIONS = 256;
export const SCENE_MIN_DISTINCTIVENESS = 0.02;

const PHOTO_FLAGS: readonly PhotoFlag[] = [
	'exact_duplicate',
	'visual_duplicate',
	'metadata_anomaly',
	'edited_metadata',
	'low_quality',
	'missing_geolocation',
	'location_mismatch'
];
/** Missing GPS is reported but earns no visual slot: messaging providers routinely strip it. */
const SIGNAL_WEIGHT: Readonly<Record<PhotoFlag, number>> = {
	exact_duplicate: 7,
	visual_duplicate: 6,
	location_mismatch: 5,
	edited_metadata: 4,
	metadata_anomaly: 3,
	low_quality: 2,
	missing_geolocation: 0
};

export type ReviewPhoto = {
	readonly id: string;
	readonly photo: FileRef;
	/** Byte size, for the attachment budget; `-1` when unknown (then it takes no visual slot). */
	readonly bytes: number;
	readonly sha256: string;
	readonly flags: readonly string[];
	readonly matched_evidence_ids: readonly string[];
	readonly created_at: string | null;
	readonly scene_embedding?: readonly number[] | null;
	/** Set when the host could not read the photo: it takes no visual slot and never blocks the review. */
	readonly inspection_failed_at?: string | null;
};
export type ReviewCandidate = Omit<
	ReviewPhoto,
	'matched_evidence_ids' | 'created_at' | 'scene_embedding' | 'inspection_failed_at'
> & {
	readonly distance: number;
	readonly matched_photo_ids: readonly string[];
};
export type ReviewFacts = {
	readonly assignment: {
		readonly id: string;
		readonly site_id: string;
		readonly title: string;
		readonly nature: string | null;
		readonly scheduled_for: string;
		readonly description: string;
		readonly status: string;
		readonly summary: string | null;
		readonly location: Point | null;
	};
	readonly site: {
		readonly id: string;
		readonly name: string;
		readonly location: Point | null;
		readonly house_type: string | null;
	} | null;
	readonly photos: readonly ReviewPhoto[];
	readonly candidates: readonly ReviewCandidate[];
	readonly communications: readonly {
		readonly source_message_id: string;
		readonly sender: string;
		readonly sent_at: string;
		readonly message: string;
	}[];
};

export const clipText = (value: string, maximum: number): string =>
	value.length <= maximum ? value : `${value.slice(0, maximum - 12)}…[clipped]`;
const assetName = (photo: { readonly photo: FileRef }) =>
	clipText(photo.photo.name, MAX_ASSET_NAME_CHARS);

/** Only what ingestion durably retained about GPS: the flag, never an invented coordinate. */
export const gpsMetadataStatus = (flags: readonly string[]) =>
	flags.includes('missing_geolocation')
		? 'missing_from_asset'
		: flags.includes('location_mismatch')
			? 'present_and_outside_assigned_site_tolerance'
			: 'present_without_location_mismatch';

const photoOrder = (photo: ReviewPhoto) => `${photo.created_at ?? ''}\u0000${photo.id}`;
const byOrder = (left: ReviewPhoto, right: ReviewPhoto) =>
	photoOrder(left).localeCompare(photoOrder(right));
const photoSignal = (photo: ReviewPhoto) =>
	photo.matched_evidence_ids.length * 8 +
	photo.flags.reduce((total, flag) => total + (SIGNAL_WEIGHT[flag as PhotoFlag] ?? 0), 0);

/**
 * A small deterministic visual sample: preferred photos (a candidate's probe), up to two signalled ones, then first,
 * middle and last for temporal coverage, within the attachment byte budget. A photo the host could not read takes no
 * slot.
 */
export function selectInferencePhotos(
	photos: readonly ReviewPhoto[],
	preferred: readonly string[] = []
): ReviewPhoto[] {
	const chronological = [...photos]
		.filter((photo) => photo.inspection_failed_at == null)
		.sort(byOrder);
	const byId = new Map(chronological.map((photo) => [photo.id, photo]));
	const signalled = chronological
		.filter((photo) => photoSignal(photo) > 0)
		.sort((left, right) => photoSignal(right) - photoSignal(left) || byOrder(left, right))
		.slice(0, MAX_SIGNAL_IMAGES);
	const temporal = chronological.length
		? [
				chronological[0]!,
				chronological[Math.floor((chronological.length - 1) / 2)]!,
				chronological.at(-1)!
			]
		: [];
	const selected: ReviewPhoto[] = [];
	let bytes = 0;
	for (const photo of [
		...preferred.flatMap((id) => byId.get(id) ?? []),
		...signalled,
		...temporal,
		...chronological
	]) {
		if (selected.length === MAX_INFERENCE_IMAGES) break;
		if (
			selected.includes(photo) ||
			photo.bytes < 0 ||
			bytes + photo.bytes > MAX_INFERENCE_IMAGE_BYTES
		)
			continue;
		selected.push(photo);
		bytes += photo.bytes;
	}
	return selected.sort(byOrder);
}

/** Canonical facts only: the idempotency key and the audit snapshot. Flags and similarity stay evidence. */
export function reviewBasis(facts: ReviewFacts): string {
	const byId = <T extends { readonly id: string }>(rows: readonly T[]) =>
		[...rows].sort((l, r) => l.id.localeCompare(r.id));
	return JSON.stringify({
		assignment: facts.assignment,
		job: {
			id: facts.assignment.id,
			title: facts.assignment.title,
			nature: facts.assignment.nature,
			scheduled_for: facts.assignment.scheduled_for,
			description: facts.assignment.description
		},
		site: facts.site,
		photos: byId(facts.photos).map((photo) => ({
			id: photo.id,
			file_id: photo.photo.id,
			sha256: photo.sha256,
			flags: [...photo.flags].sort(),
			matched_evidence_ids: [...photo.matched_evidence_ids].sort(),
			created_at: photo.created_at
		})),
		candidates: byId(facts.candidates).map((candidate) => ({
			id: candidate.id,
			file_id: candidate.photo.id,
			sha256: candidate.sha256,
			flags: [...candidate.flags].sort(),
			distance: candidate.distance,
			matched_photo_ids: [...candidate.matched_photo_ids].sort()
		})),
		communications: [...facts.communications]
			.sort((l, r) => l.source_message_id.localeCompare(r.source_message_id))
			.map(({ source_message_id, sender, sent_at, message }) => ({
				source_message_id,
				sender,
				sent_at,
				message
			}))
	});
}
export const reviewSourceKey = (assignmentId: string, basisHash: string) =>
	`suspicion-review:${assignmentId}:${basisHash}`;

type Pair = {
	readonly own: ReviewPhoto;
	readonly candidate: ReviewCandidate;
	readonly attached: boolean;
};
/** Each nominated foreign photo beside the own photo it was retrieved against; attached when both fit the turn. */
const pairsOf = (facts: ReviewFacts, representatives: readonly ReviewPhoto[]): Pair[] => {
	const own = new Map(facts.photos.map((photo) => [photo.id, photo]));
	return facts.candidates.flatMap((candidate) => {
		const photo = candidate.matched_photo_ids.map((id) => own.get(id)).find((p) => p !== undefined);
		return photo === undefined
			? []
			: [
					{
						own: photo,
						candidate,
						attached:
							representatives.includes(photo) &&
							candidate.bytes >= 0 &&
							candidate.bytes <= MAX_CANDIDATE_IMAGE_BYTES
					}
				];
	});
};

/** The provider-bounded facts of one turn, derived from the complete durable basis. */
export function inferenceContext(
	facts: ReviewFacts,
	representatives = selectInferencePhotos(facts.photos)
): string {
	const attached = new Set(representatives.map((photo) => photo.id));
	const base = {
		review_scope: { kind: 'single_assignment_review' },
		attachment_manifest: {
			instruction:
				'The attached images appear in exactly this order. The role and asset_name are authoritative; use no other image identifier.',
			images: representatives.map((photo) => ({
				asset_name: assetName(photo),
				gps_metadata: gpsMetadataStatus(photo.flags),
				role: 'job_site_photo'
			}))
		},
		assignment: {
			...facts.assignment,
			summary: facts.assignment.summary == null ? null : clipText(facts.assignment.summary, 1_600)
		},
		job: {
			id: facts.assignment.id,
			title: clipText(facts.assignment.title, 512),
			nature: facts.assignment.nature == null ? null : clipText(facts.assignment.nature, 512),
			scheduled_for: facts.assignment.scheduled_for,
			description: clipText(facts.assignment.description, 4_000)
		},
		site: facts.site == null ? null : { ...facts.site, name: clipText(facts.site.name, 512) },
		photo_summary: {
			total: facts.photos.length,
			attached_representatives: representatives.length,
			omitted_from_visual_turn: facts.photos.length - representatives.length,
			flag_counts: Object.fromEntries(
				PHOTO_FLAGS.map((flag) => [
					flag,
					facts.photos.filter((photo) => photo.flags.includes(flag)).length
				]).filter(([, count]) => count !== 0)
			),
			similarity_relationships: facts.photos.reduce(
				(count, photo) => count + photo.matched_evidence_ids.length,
				0
			),
			/** Zero means the scene task had nothing to retrieve with, not that the corpus was found clear. */
			scene_embedding_photos: facts.photos.filter(
				(photo) => (photo.scene_embedding?.length ?? 0) > 0
			).length,
			job_site_photo_dataset: [...facts.photos].sort(byOrder).map((photo) => ({
				asset_name: assetName(photo),
				gps_metadata: gpsMetadataStatus(photo.flags),
				visually_attached: attached.has(photo.id),
				file_size: photo.bytes,
				mime_type: photo.photo.mime,
				integrity_flags: [...photo.flags].sort()
			}))
		}
	};
	let messages = [...facts.communications]
		.sort(
			(l, r) =>
				l.sent_at.localeCompare(r.sent_at) || l.source_message_id.localeCompare(r.source_message_id)
		)
		.slice(-MAX_COMMUNICATIONS)
		.map((m) => ({
			source_message_id: clipText(m.source_message_id, 256),
			sender: clipText(m.sender, 256),
			sent_at: m.sent_at,
			message: clipText(m.message, MAX_MESSAGE_CHARS)
		}));
	for (;;) {
		const encoded = JSON.stringify({
			...base,
			communication_summary: {
				total: facts.communications.length,
				included_recent: messages.length,
				omitted: facts.communications.length - messages.length,
				messages
			}
		});
		if (encoded.length <= MAX_INFERENCE_CONTEXT_CHARS || messages.length === 0) return encoded;
		messages = messages.slice(1);
	}
}

export function suspicionPrompt(
	facts: ReviewFacts,
	representatives = selectInferencePhotos(facts.photos)
): string {
	return [
		'Review this field-work assignment in exactly one structured turn.',
		'The attachment_manifest is authoritative: it names every attached image in order. Refer to an image only by its exact asset_name. Do not invent a photo number, record id, attachment label, address, GPS coordinate, or any other identification method.',
		'The job_site_photo_dataset is the complete set submitted to this assignment. Each row gives the actual asset_name and the GPS metadata state durably retained by ingestion.',
		representatives.length === 0
			? 'No photo fit the bounded attachment budget. Judge from the assigned job and site, aggregate deterministic photo facts, and bounded recent contractor communications; do not pretend a scene was visible.'
			: `The attachment_manifest names the ${representatives.length} job-site photo${representatives.length === 1 ? '' : 's'} actually attached for visual review. Photos marked visually_attached false are listed for completeness but were not visible; never claim to have read a marker from one of them.`,
		'The durable audit basis covers every photo and communication; this inference context is deliberately bounded and states what was omitted.',
		'Missing photo geolocation is a neutral fact because messaging services commonly strip metadata.',
		'Visual similarity inside one assignment is a neutral fact because legitimate repeated views are possible.',
		'Use only physical scene markers visibly present in an attached job-site photo, such as door plates, house numbers, street or building signs, mailboxes, lobby signs and lift permits, when assessing location. Ignore uploader-controlled timestamp, GPS and address overlays, work labels, tape measures, tag numbers, bin or lamppost ids and telephone numbers.',
		'Duplicate reuse only matters between distinct assignments: an identical file submitted under the same assignment is a neutral repeat, never evidence.',
		'Raise an unresolved mixed-sites suspicion only when two or more attached job-site photos contain concrete physical markers for conflicting sites. Different-looking rooms, fixtures, exterior views, or common trade features alone do not establish multiple sites.',
		'A suspicion log is an actionable escalation, not a queue for low-confidence review. Plausibly benign ambiguity, incomplete corroboration, or the fact that a controller could confirm something is not enough. When the available evidence has a reasonable ordinary explanation and no concrete contradiction, return suspicious false.',
		'For every other fact, return suspicious only when your contextual judgement finds a concrete, articulable reason to question this assignment.',
		'Likewise, an assignment location mismatch is evidence for judgement, never an automatic verdict.',
		`If suspicious is true, give a concise reason of at most ${MAX_INFERENCE_REASON_CHARS} characters that a controller can investigate. Set evidence_asset_name to the exact asset_name of one decisive attached job-site photo and reference only exact asset names from the supplied dataset in the reason.`,
		`If suspicious is false, set evidence_asset_name to an empty string and explain in at most ${MAX_INFERENCE_REASON_CHARS} characters why the evidence does not justify a log.`,
		`Bounded inference facts: ${inferenceContext(facts, representatives)}`
	].join(' ');
}

/** One nominated pair, judged alone: exactly two images, so neither can be mistaken for another. */
export const PAIR_PROMPT = [
	'Two photos are attached: first a job-site photo, then a photo filed under a different assignment. Decide whether they show the same physical scene.',
	'Return same_scene true only when multiple permanent visual landmarks share the same geometry: for example the same openings, vents, holes, stains, wall or ceiling edges, fixed fixtures and background structure in the same relative positions.',
	'A crop, zoom, recompression, new overlay, different timestamp, different camera, or re-photograph of the same underlying scene is still same_scene true. Overlay text must neither establish nor rebut the match.',
	'Similar colours, tiles, doors, handrails, grab bars, stairs, bathrooms, ceilings or trade fixtures without distinctive shared geometry are expected across unrelated sites and must return same_scene false. Tools, equipment, tags and other portable objects are never landmarks. If uncertain, return same_scene false.'
].join(' ');
export const PAIR_DECISION = {
	kind: 'object',
	fields: { same_scene: { kind: 'bool' }, reason: { kind: 'text' } }
} as const;

/** The structured output of one review turn (a root object, no unions: what structured-output providers accept). */
export const DECISION = {
	kind: 'object',
	fields: {
		suspicious: { kind: 'bool' },
		reason: { kind: 'text' },
		/** Empty: no decisive photo; otherwise an attached job-site asset name. */
		evidence_asset_name: { kind: 'text', max: MAX_ASSET_NAME_CHARS }
	}
} as const;
export type Decision = {
	readonly suspicious: boolean;
	readonly reason: string;
	readonly evidence_asset_name: string;
};

/**
 * The verdict a decision supports: a job-site suspicion counts only when it cites an attached job-site asset; each
 * pair judged the same scene adds its reuse. Model pair prose never enters the log.
 */
export function judge(
	representatives: readonly ReviewPhoto[],
	decision: Decision,
	reused: readonly Pair[]
) {
	if (decision.reason.trim() === '') throw new Error('Suspicion review returned an empty reason.');
	const site = decision;
	const cited =
		site.evidence_asset_name === ''
			? null
			: (representatives.find((photo) => assetName(photo) === site.evidence_asset_name)?.id ??
				null);
	const supported = site.suspicious && cited !== null;
	const unsupported = site.suspicious && cited === null;
	const suspicious = supported || reused.length > 0;
	const reason = clipText(
		[
			...(supported ? [site.reason] : []),
			...reused.map(
				({ own, candidate }) =>
					`Cross-assignment photo reuse: ${assetName(own)} and ${assetName(candidate)} were judged to show the same physical scene.`
			),
			...(!suspicious && unsupported
				? [
						'No suspicion log was created because the review did not identify an attached job-site asset by its supplied name.'
					]
				: []),
			...(!suspicious && !unsupported ? [site.reason] : [])
		].join(' '),
		MAX_INFERENCE_REASON_CHARS
	);
	return { suspicious, reason, evidence_id: supported ? cited : (reused[0]?.own.id ?? null) };
}

/**
 * Nominate at most one foreign photo per own photo, only when it wins by the distinctiveness margin (a dense cluster
 * of look-alike doors nominates nothing), and keep the closest `MAX_CANDIDATES`.
 */
export function nominate(
	probes: readonly string[],
	hits: readonly {
		readonly probe: string;
		readonly distance: number;
		readonly candidate: Omit<ReviewCandidate, 'distance' | 'matched_photo_ids'>;
	}[]
): ReviewCandidate[] {
	const winners = new Map<string, ReviewCandidate>();
	for (const probe of probes) {
		const ranked = hits
			.filter((hit) => hit.probe === probe)
			.sort((l, r) => l.distance - r.distance || l.candidate.id.localeCompare(r.candidate.id));
		const [winner, runnerUp] = ranked;
		if (
			winner === undefined ||
			(runnerUp !== undefined && runnerUp.distance - winner.distance < SCENE_MIN_DISTINCTIVENESS)
		)
			continue;
		const previous = winners.get(winner.candidate.id);
		if (previous === undefined || winner.distance < previous.distance)
			winners.set(winner.candidate.id, {
				...winner.candidate,
				distance: Math.round(winner.distance * 1000) / 1000,
				matched_photo_ids: [probe]
			});
	}
	return [...winners.values()]
		.sort((l, r) => l.distance - r.distance || l.id.localeCompare(r.id))
		.slice(0, MAX_CANDIDATES);
}

// ── the run's reads and writes ──

const bytesOf = async (ctx: Ctx, ref: FileRef) => {
	const meta = await ctx.files.meta.try(ref);
	return 'kind' in meta ? -1 : meta.bytes;
};
/** The assignment a photo hangs off, directly or through its variation. */
async function assignmentsOf(
	ctx: Ctx,
	photos: readonly {
		readonly id: string;
		readonly job_assignment_id: string | null;
		readonly variation_request_id: string | null;
	}[]
) {
	const variationIds = photos.flatMap((p) =>
		p.job_assignment_id == null && p.variation_request_id != null ? [p.variation_request_id] : []
	);
	const variations = variationIds.length
		? await ctx.read('variation_requests', {
				where: { id: { in: variationIds as Id<'variation_requests'>[] } },
				select: { job_assignment_id: true },
				all: true
			})
		: { rows: [] };
	const byVariation = new Map(
		variations.rows.map((v) => [String(v.id), String(v.job_assignment_id)])
	);
	return new Map(
		photos.map((p) => [
			p.id,
			p.job_assignment_id ?? byVariation.get(String(p.variation_request_id)) ?? null
		])
	);
}

/**
 * Fill the facts of photos still awaiting them (empty `sha256`): the host's image facts, the scene embedding, the capture
 * point against the site of the photo's work, and near-duplicates under other assignments (an identical file is `exact_duplicate`, a
 * perceptual near-match `visual_duplicate`). A photo the host cannot read is durably marked failed with a bounded
 * reason and named in `failures`; it stops blocking its assignment and stops consuming later runs' inspection slots.
 */
export async function inspectPendingPhotos(ctx: Ctx) {
	const pending = await ctx.read('photo_evidence', {
		where: { sha256: { eq: '' }, inspection_failed_at: { isNull: true } },
		select: { photo: true, job_assignment_id: true, variation_request_id: true },
		limit: INSPECTIONS_PER_RUN
	});
	const failures: { photo_id: string; reason: string }[] = [];
	if (pending.rows.length === 0) return { inspected: 0, failures };
	const rows = pending.rows.map((p) => ({
		id: String(p.id),
		photo: p.photo,
		job_assignment_id: p.job_assignment_id == null ? null : String(p.job_assignment_id),
		variation_request_id: p.variation_request_id == null ? null : String(p.variation_request_id)
	}));
	const owner = await assignmentsOf(ctx, rows);
	const jobIds = [...new Set([...owner.values()].flatMap((id) => (id == null ? [] : [id])))];
	const jobs = jobIds.length
		? await ctx.read('job_assignments', {
				where: { id: { in: jobIds as Id<'job_assignments'>[] } },
				select: { site_id: { select: { location: true } } },
				all: true
			})
		: { rows: [] };
	const siteOf = new Map(jobs.rows.map((job) => [String(job.id), job.site_id?.location ?? null]));
	let inspected = 0;
	for (const photo of rows) {
		const facts = await ctx.files.image.try(photo.photo);
		if ('kind' in facts) {
			const reason = clipText(
				'message' in facts ? facts.message : facts.reason,
				MAX_INSPECTION_FAILURE_REASON_CHARS
			);
			failures.push({ photo_id: photo.id, reason });
			await ctx.act('photo_evidence.update', {
				target: photo.id as Id<'photo_evidence'>,
				set: { inspection_failed_at: ctx.now, inspection_failure_reason: reason }
			});
			continue;
		}
		const own = owner.get(photo.id) ?? null;
		const flags = new Set(
			imageFlags(facts, photo.photo.mime, ctx.now, own == null ? null : (siteOf.get(own) ?? null))
		);
		const embedding = hexToBinaryEmbedding(facts.pdq);
		const near = await nearest(ctx, 'pdq', embedding, 50);
		const hits = near
			.filter(
				(hit) =>
					hit.$distance <= VISUAL_DUPLICATE_MAX_L2 &&
					String(hit.id) !== photo.id &&
					hit.sha256 !== ''
			)
			.map((hit) => ({
				id: String(hit.id),
				sha256: hit.sha256,
				job_assignment_id: hit.job_assignment_id == null ? null : String(hit.job_assignment_id),
				variation_request_id:
					hit.variation_request_id == null ? null : String(hit.variation_request_id)
			}));
		const hitOwner = await assignmentsOf(ctx, hits);
		const foreign = hits.filter((hit) => hitOwner.get(hit.id) !== own);
		if (foreign.some((hit) => hit.sha256 === facts.sha256)) flags.add('exact_duplicate');
		if (foreign.some((hit) => hit.sha256 !== facts.sha256)) flags.add('visual_duplicate');
		// the scene is retrieval only: a photo the embedding model cannot take keeps no scene, never a failed inspection
		const scene = await ctx.ai.embed.try([await visible(ctx, photo.photo)], {
			model: 'scene',
			dimensions: SCENE_DIMENSIONS
		});
		const scene_embedding =
			'kind' in scene || scene[0]?.length !== SCENE_DIMENSIONS ? null : [...scene[0]];
		await ctx.act('photo_evidence.update', {
			target: photo.id as Id<'photo_evidence'>,
			set: {
				sha256: facts.sha256,
				perceptual_embedding: embedding,
				scene_embedding,
				flags: [...flags],
				matched_evidence_ids: foreign.map((hit) => hit.id)
			}
		});
		inspected += 1;
	}
	return { inspected, failures };
}

/**
 * Give a scene to hashed photos that have none: a seeded or bank-loaded photo arrives with its hash and pixel embedding but
 * no scene (the scene model is the host's), and without it a re-photographed site under another assignment is invisible
 * to every review. Batched per `ctx.ai.embed` call; a batch that fails is left for the next run.
 * ponytail: a photo the model always refuses is asked again each run (bounded by the cap); flag it if that shows up in cost.
 */
export async function backfillScenes(ctx: Ctx) {
	const { rows } = await ctx.read('photo_evidence', {
		where: { sha256: { ne: '' }, scene_embedding: { isNull: true } },
		select: { photo: true },
		limit: SCENE_BACKFILL_PER_RUN
	});
	let filled = 0;
	const batches = Array.from({ length: Math.ceil(rows.length / SCENE_BATCH) }, (_, i) =>
		rows.slice(i * SCENE_BATCH, (i + 1) * SCENE_BATCH)
	);
	const place = async (batch: typeof rows) => {
		const scenes = await ctx.ai.embed.try(
			await Promise.all(batch.map((row) => visible(ctx, row.photo))),
			{ model: 'scene', dimensions: SCENE_DIMENSIONS }
		);
		if ('kind' in scenes) return;
		for (const [j, row] of batch.entries()) {
			const scene = scenes[j];
			if (scene?.length !== SCENE_DIMENSIONS) continue;
			await ctx.act('photo_evidence.update', {
				target: row.id,
				set: { scene_embedding: [...scene] }
			});
			filled += 1;
		}
	};
	// SCENE_BATCHES_AT_ONCE embedding requests in flight: each is seconds of provider time, not of this run's
	await Promise.all(
		Array.from({ length: Math.min(SCENE_BATCHES_AT_ONCE, batches.length) }, async () => {
			for (let next = batches.shift(); next !== undefined; next = batches.shift())
				await place(next);
		})
	);
	return filled;
}

/** The unchecked worklist, materialised before reviewing (stamps shrink it as reviews succeed). */
export async function uncheckedAssignments(ctx: Ctx, only?: readonly string[]) {
	const { rows } = await ctx.read('job_assignments', {
		where: {
			suspicion_checked_at: { isNull: true },
			...(only === undefined ? {} : { id: { in: only as Id<'job_assignments'>[] } })
		},
		select: {
			site_id: true,
			title: true,
			nature: true,
			scheduled_for: true,
			description: true,
			status: true,
			summary: true,
			location: true
		},
		all: true
	});
	return rows.map((row) => ({
		id: String(row.id),
		site_id: String(row.site_id),
		title: row.title,
		nature: row.nature,
		scheduled_for: String(row.scheduled_for),
		description: row.description,
		status: row.status,
		summary: row.summary,
		location: row.location
	}));
}

/** A photo on the assignment has no facts yet and no durable failure: the assignment waits for the next inspection. */
export class AwaitingInspection extends Error {
	constructor(readonly photoId: string) {
		super(`Photo evidence ${photoId} has not been inspected yet.`);
	}
}

async function loadFacts(ctx: Ctx, assignment: ReviewFacts['assignment']): Promise<ReviewFacts> {
	const job = assignment.id as Id<'job_assignments'>;
	const [site, variations, messages] = await Promise.all([
		ctx.get('sites', assignment.site_id as Id<'sites'>, {
			select: { name: true, location: true, house_type: true }
		}),
		ctx.read('variation_requests', {
			where: { job_assignment_id: { eq: job } },
			select: {},
			all: true
		}),
		ctx.read('communication_logs', {
			where: { job_assignment_id: { eq: job } },
			select: { source_message_id: true, sender: true, sent_at: true, message: true },
			all: true
		})
	]);
	const variationIds = variations.rows.map((v) => v.id);
	const photos = await ctx.read('photo_evidence', {
		where: variationIds.length
			? { or: [{ job_assignment_id: { eq: job } }, { variation_request_id: { in: variationIds } }] }
			: { job_assignment_id: { eq: job } },
		select: {
			photo: true,
			sha256: true,
			inspection_failed_at: true,
			flags: true,
			matched_evidence_ids: true,
			created_at: true,
			scene_embedding: true
		},
		all: true
	});
	const waiting = photos.rows.find(
		(photo) => photo.sha256 === '' && photo.inspection_failed_at == null
	);
	if (waiting !== undefined) throw new AwaitingInspection(String(waiting.id));
	return {
		assignment,
		site:
			site == null
				? null
				: {
						id: String(site.id),
						name: site.name,
						location: site.location,
						house_type: site.house_type
					},
		photos: await Promise.all(
			photos.rows.map(async (photo) => ({
				id: String(photo.id),
				photo: photo.photo,
				bytes: await bytesOf(ctx, photo.photo),
				sha256: photo.sha256,
				flags: photo.flags,
				matched_evidence_ids: photo.matched_evidence_ids,
				created_at: photo.created_at == null ? null : String(photo.created_at),
				scene_embedding: photo.scene_embedding,
				inspection_failed_at:
					photo.inspection_failed_at == null ? null : String(photo.inspection_failed_at)
			}))
		),
		candidates: [],
		communications: messages.rows.map((m) => ({
			source_message_id: m.source_message_id,
			sender: m.sender,
			sent_at: String(m.sent_at),
			message: m.message
		}))
	};
}

/** Photos from other assignments whose scene sits close to this assignment's own photos (retrieval, not a verdict). */
async function sceneCandidates(ctx: Ctx, facts: ReviewFacts): Promise<ReviewCandidate[]> {
	const chronological = [...facts.photos].sort(byOrder);
	const probes =
		chronological.length <= MAX_PROBES
			? chronological
			: Array.from(
					{ length: MAX_PROBES },
					(_, i) => chronological[Math.round((i * (chronological.length - 1)) / (MAX_PROBES - 1))]!
				);
	const hits = [];
	for (const probe of probes) {
		if (probe.scene_embedding == null || probe.scene_embedding.length === 0) continue;
		const near = await nearest(ctx, 'scene', probe.scene_embedding, 12);
		const rows = near
			.filter((hit) => hit.$distance <= SCENE_MAX_COSINE && String(hit.id) !== probe.id)
			.map((hit) => ({
				hit,
				id: String(hit.id),
				job_assignment_id: hit.job_assignment_id == null ? null : String(hit.job_assignment_id),
				variation_request_id:
					hit.variation_request_id == null ? null : String(hit.variation_request_id)
			}));
		const owners = await assignmentsOf(ctx, rows);
		for (const { hit, id } of rows) {
			const owner = owners.get(id);
			if (owner == null || owner === facts.assignment.id) continue;
			hits.push({
				probe: probe.id,
				distance: hit.$distance,
				candidate: {
					id,
					photo: hit.photo,
					bytes: await bytesOf(ctx, hit.photo),
					sha256: hit.sha256,
					flags: hit.flags
				}
			});
		}
	}
	return nominate(
		probes.map((p) => p.id),
		hits
	);
}

/** A file the provider reads as an image: a non-image declared type (a WhatsApp document) gets a host-derived JPEG. */
const visible = async (ctx: Ctx, ref: FileRef) => {
	if (/^image\/(jpeg|png|webp|gif)$/.test(ref.mime)) return ref;
	const derived = await ctx.files.image.try(ref, { jpeg: { maxEdge: 2048 } });
	return 'kind' in derived ? ref : derived;
};

export type ReviewStatus =
	'clear' | 'clear_existing' | 'suspicious' | 'suspicious_open_exists' | 'suspicious_log_exists';

/** One assignment's review; throws with the stage it failed at. Stamps the assignment only on success. */
export async function reviewAssignment(
	ctx: Ctx,
	assignment: ReviewFacts['assignment']
): Promise<ReviewStatus> {
	const loaded = await loadFacts(ctx, assignment);
	const candidates = await sceneCandidates(ctx, loaded);
	const facts: ReviewFacts = { ...loaded, candidates };
	const representatives = selectInferencePhotos(
		facts.photos,
		candidates.flatMap((c) => c.matched_photo_ids)
	);
	const basis = reviewBasis(facts);
	const basisHash = sha256Text(basis);
	const attachedPairs = pairsOf(facts, representatives).filter((pair) => pair.attached);
	// `allSettled`, not `all`: one turn that fails must not abandon the others mid-flight. A fail-fast fan-out returns the
	// body while sibling `ctx.ai` calls are still crossing, which the guest reports as an internal failure and loses the
	// review that was succeeding. A pair that could not be judged is simply not counted as reuse.
	const [decision, ...pairTurns] = await Promise.allSettled([
		ctx.ai.sys_2.infer({
			model: SUSPICION_REVIEW_MODEL,
			prompt: suspicionPrompt(facts, representatives),
			files: await Promise.all(representatives.map((p) => visible(ctx, p.photo))),
			output: DECISION
		}) as Promise<Decision>,
		...attachedPairs.map(
			async ({ own, candidate }) =>
				ctx.ai.sys_2.infer({
					model: SUSPICION_REVIEW_MODEL,
					prompt: PAIR_PROMPT,
					files: await Promise.all([visible(ctx, own.photo), visible(ctx, candidate.photo)]),
					output: PAIR_DECISION
				}) as Promise<{ readonly same_scene: boolean }>
		)
	]);
	if (decision.status === 'rejected') throw decision.reason;
	const sameScene = pairTurns.map((turn) => turn.status === 'fulfilled' && turn.value.same_scene);
	const verdict = judge(
		representatives,
		decision.value,
		attachedPairs.filter((_, i) => sameScene[i])
	);
	const job = assignment.id as Id<'job_assignments'>;
	// a retried run with the same basis finds its review by the unique key instead of writing a second
	const written = await ctx.act.try('suspicion_reviews.create', {
		job_assignment_id: job,
		basis_hash: basisHash,
		basis,
		suspicious: verdict.suspicious,
		reason: verdict.reason,
		evidence_id: verdict.evidence_id as Id<'photo_evidence'> | null,
		model: SUSPICION_REVIEW_MODEL,
		reviewed_at: ctx.now,
		source_key: reviewSourceKey(assignment.id, basisHash)
	});
	const created = written.kind === 'committed';
	const {
		rows: [review]
	} = await ctx.read('suspicion_reviews', {
		where: { job_assignment_id: { eq: job }, basis_hash: { eq: basisHash } },
		select: { basis: true, suspicious: true, reason: true, evidence_id: true },
		limit: 1
	});
	if (review === undefined)
		throw new Error(
			written.kind === 'refused' ? written.message : 'The suspicion review was not persisted.'
		);
	let status: ReviewStatus = created ? 'clear' : 'clear_existing';
	if (review.suspicious) {
		// inference is external I/O: re-read the durable findings so a retry never writes a second log
		const [fromReview, open] = await Promise.all([
			ctx.read('suspicious_activity_logs', {
				where: { review_id: { eq: review.id } },
				select: {},
				limit: 1
			}),
			ctx.read('suspicious_activity_logs', {
				where: { job_assignment_id: { eq: job }, resolved_at: { isNull: true } },
				select: {},
				limit: 1
			})
		]);
		if (fromReview.rows.length > 0) status = 'suspicious_log_exists';
		else if (open.rows.length > 0) status = 'suspicious_open_exists';
		else {
			await ctx.act('suspicious_activity_logs.create', {
				job_assignment_id: job,
				origin: 'automation',
				basis: review.basis,
				review_id: review.id,
				evidence_id: review.evidence_id,
				reason: review.reason
			});
			status = 'suspicious';
		}
	}
	await ctx.act('job_assignments.update', { target: job, set: { suspicion_checked_at: ctx.now } });
	return status;
}

/** The next two-hour slot (00:00, 02:00, … UTC), when a review that did not complete is tried again. */
export const nextRetrySlot = <T extends string>(now: T): T => {
	const at = new Date(now);
	at.setUTCMinutes(0, 0, 0);
	at.setUTCHours(at.getUTCHours() - (at.getUTCHours() % 2) + 2);
	return at.toISOString() as T;
};
