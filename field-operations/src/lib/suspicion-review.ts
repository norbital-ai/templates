import type {
	AutomationCtx,
	FileRef,
	Id,
	IndexSearch,
	Instant,
	Point,
	Row
} from '@norbital-ai/bolt';
import { Instant as instantOf } from '@norbital-ai/std/date';
import type { Pair } from './suspicion-review-verdict.js';
import {
	assetName,
	clipText,
	MAX_ASSET_NAME_CHARS,
	MAX_INFERENCE_REASON_CHARS
} from './suspicion-review-text.js';
import {
	hexToBinaryEmbedding,
	imageFlags,
	VISUAL_DUPLICATE_MAX_L2,
	type PhotoFlag
} from './photo-integrity.js';
import * as Effect from 'effect/Effect';
import * as Arr from 'effect/Array';
import * as Predicate from 'effect/Predicate';
import * as Result from 'effect/Result';
/**
 * The suspicion review, one unchecked assignment at a time: its photos' facts (host-side through `ctx.files.image`, the scene
 * through `ctx.ai.embed`), scene-reuse candidates from other assignments, one structured `sys_2` turn that judges the job-site photos,
 * one two-image turn per nominated pair (a model handed five unlabelled images cross-wired them and matched different
 * bathrooms), an immutable review row per evidence basis, a suspicion log only when the judgement is suspicious
 * and no finding already stands, then the assignment's checked stamp.
 */
type Ctx = AutomationCtx;
/** A thrown facility error is its typed value (`{ kind, message | reason }`), not an `Error`. */
export const messageOf = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	if (!Predicate.isObjectOrArray(error) || Arr.isArray(error)) return String(error);
	const message = error['message'] ?? error['reason'];
	return message != null ? String(message) : JSON.stringify(error);
};
const HIT = {
	photo: true,
	sha256: true,
	flags: true,
	job_assignment_id: true,
	variation_request_id: true
} as const;
/** The photos nearest a probe on one of photo_evidence's indexes (`pdq`: L2 over the PDQ bits; `scene`: cosine). */
const nearest = (ctx: Ctx, search: IndexSearch<'photo_evidence'>, limit: number) =>
	ctx.query('photo_evidence', { search, select: HIT, limit }).pipe(Effect.map((page) => page.rows));
/** The `sys_2` model class the review asks (every one is multimodal, P39). */
const SUSPICION_REVIEW_MODEL = 'default';
const MAX_INFERENCE_IMAGES = 3;
const MAX_INFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_INFERENCE_CONTEXT_CHARS = 48 * 1024;
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
const INSPECTION_CLAIM_LEASE_MS = 10 * 60_000;
const SCENE_BACKFILL_PER_RUN = 1000;
const SCENE_BATCH = 16;
const SCENE_BATCHES_AT_ONCE = 4;
/** A scene candidate must sit this close (cosine) and beat its runner-up by the margin below. */
const SCENE_MAX_COSINE = 0.35;
/** `photo_evidence.scene_embedding`'s `dim`. */
const SCENE_DIMENSIONS = 256;
const SCENE_MIN_DISTINCTIVENESS = 0.02;
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
	readonly id: Id<'photo_evidence'>;
	readonly photo: FileRef;
	/** Byte size, for the attachment budget; `-1` when unknown (then it takes no visual slot). */
	readonly bytes: number;
	readonly sha256: string;
	readonly flags: Row<'photo_evidence'>['flags'];
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
	readonly matched_photo_ids: readonly Id<'photo_evidence'>[];
};
type ReviewFacts = {
	readonly assignment: {
		readonly id: Id<'job_assignments'>;
		readonly site_id: Id<'sites'>;
		readonly title: string;
		readonly nature: string | null;
		readonly scheduled_for: string;
		readonly description: string;
		readonly status: string;
		readonly summary: string | null;
		readonly location: Point | null;
	};
	readonly site: Pick<Row<'sites'>, 'id' | 'name' | 'location' | 'house_type'> | null;
	readonly photos: readonly ReviewPhoto[];
	readonly candidates: readonly ReviewCandidate[];
	readonly communications: readonly {
		readonly source_message_id: string;
		readonly sender: string;
		readonly sent_at: string;
		readonly message: string;
	}[];
};
/** Only what ingestion durably retained about GPS: the flag, never an invented coordinate. */
const gpsMetadataStatus = (flags: readonly string[]) =>
	flags.includes('missing_geolocation')
		? 'missing_from_asset'
		: flags.includes('location_mismatch')
			? 'present_and_outside_assigned_site_tolerance'
			: 'present_without_location_mismatch';
const photoOrder = (photo: ReviewPhoto) => `${photo.created_at ?? ''}\u0000${photo.id}`;
const byOrder = (left: ReviewPhoto, right: ReviewPhoto) =>
	photoOrder(left).localeCompare(photoOrder(right));
function isPhotoFlag(flag: string): flag is PhotoFlag {
	for (const allowed of PHOTO_FLAGS) if (allowed === flag) return true;
	return false;
}
const photoSignal = (photo: ReviewPhoto) =>
	photo.matched_evidence_ids.length * 8 +
	photo.flags.reduce((total, flag) => total + (isPhotoFlag(flag) ? SIGNAL_WEIGHT[flag] : 0), 0);
/**
 * A small deterministic visual sample: preferred photos (a candidate's probe), up to two signalled ones, then first,
 * middle and last for temporal coverage, within the attachment byte budget. A photo the host could not read takes no
 * slot.
 */
function selectInferencePhotos(
	photos: readonly ReviewPhoto[],
	preferred: readonly Id<'photo_evidence'>[] = []
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
function reviewBasis(facts: ReviewFacts): Row<'suspicion_reviews'>['basis'] {
	const byId = <
		T extends {
			readonly id: string;
		}
	>(
		rows: readonly T[]
	) => [...rows].sort((l, r) => l.id.localeCompare(r.id));
	return {
		kind: 'review',
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
	};
}
const reviewSourceKey = (assignmentId: string, basisHash: string) =>
	`suspicion-review:${assignmentId}:${basisHash}`;
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
function inferenceContext(
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
			summary: facts.assignment.summary == null ? null : clipText(facts.assignment.summary, 1600)
		},
		job: {
			id: facts.assignment.id,
			title: clipText(facts.assignment.title, 512),
			nature: facts.assignment.nature == null ? null : clipText(facts.assignment.nature, 512),
			scheduled_for: facts.assignment.scheduled_for,
			description: clipText(facts.assignment.description, 4000)
		},
		site: facts.site == null ? null : { ...facts.site, name: clipText(facts.site.name, 512) },
		photo_summary: {
			total: facts.photos.length,
			attached_representatives: representatives.length,
			omitted_from_visual_turn: facts.photos.length - representatives.length,
			flag_counts: Object.fromEntries(
				PHOTO_FLAGS.map((flag): [PhotoFlag, number] => [
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
function suspicionPrompt(
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
const PAIR_PROMPT = [
	'Two photos are attached: first a job-site photo, then a photo filed under a different assignment. Decide whether they show the same physical scene.',
	'Return same_scene true only when multiple permanent visual landmarks share the same geometry: for example the same openings, vents, holes, stains, wall or ceiling edges, fixed fixtures and background structure in the same relative positions.',
	'A crop, zoom, recompression, new overlay, different timestamp, different camera, or re-photograph of the same underlying scene is still same_scene true. Overlay text must neither establish nor rebut the match.',
	'Similar colours, tiles, doors, handrails, grab bars, stairs, bathrooms, ceilings or trade fixtures without distinctive shared geometry are expected across unrelated sites and must return same_scene false. Tools, equipment, tags and other portable objects are never landmarks. If uncertain, return same_scene false.'
].join(' ');
const PAIR_DECISION = {
	kind: 'object',
	fields: { same_scene: { kind: 'bool' }, reason: { kind: 'text' } }
} as const;
/** The structured output of one review turn (a root object, no unions: what structured-output providers accept). */
const DECISION = {
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
 * Nominate at most one foreign photo per own photo, only when it wins by the distinctiveness margin (a dense cluster
 * of look-alike doors nominates nothing), and keep the closest `MAX_CANDIDATES`.
 */
function nominate<
	Candidate extends {
		readonly id: Id<'photo_evidence'>;
	}
>(
	probes: readonly Id<'photo_evidence'>[],
	hits: readonly {
		readonly probe: Id<'photo_evidence'>;
		readonly distance: number;
		readonly candidate: Candidate;
	}[]
): (Candidate & Pick<ReviewCandidate, 'distance' | 'matched_photo_ids'>)[] {
	const winners = new Map<
		Id<'photo_evidence'>,
		Candidate & Pick<ReviewCandidate, 'distance' | 'matched_photo_ids'>
	>();
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
const fileFactsOf = Effect.fnUntraced(function* (ctx: Ctx, ref: FileRef) {
	return yield* ctx.files.meta(ref).pipe(
		Effect.map((meta) => ({ photo: meta, bytes: meta.bytes })),
		Effect.catch((failure) => Effect.logWarning(failure).pipe(Effect.as({ photo: ref, bytes: -1 })))
	);
});
/** The assignment a photo hangs off, directly or through its variation. */
const assignmentsOf = Effect.fnUntraced(function* (
	ctx: Ctx,
	photos: readonly {
		readonly id: Id<'photo_evidence'>;
		readonly job_assignment_id: Id<'job_assignments'> | null;
		readonly variation_request_id: Id<'variation_requests'> | null;
	}[]
) {
	const variationIds = photos.flatMap((p) =>
		p.job_assignment_id == null && p.variation_request_id != null ? [p.variation_request_id] : []
	);
	const variations = variationIds.length
		? yield* ctx.query('variation_requests', {
				where: { id: { in: variationIds } },
				select: { job_assignment_id: true },
				all: true
			})
		: { rows: [] };
	const byVariation = new Map(variations.rows.map((v) => [v.id, v.job_assignment_id]));
	return new Map(
		photos.map((p) => [
			p.id,
			p.job_assignment_id ??
				(p.variation_request_id == null ? null : (byVariation.get(p.variation_request_id) ?? null))
		])
	);
});
/**
 * Fill the facts of photos still awaiting them (empty `sha256`): the host's image facts, the scene embedding, the capture
 * point against the site of the photo's work, and near-duplicates under other assignments (an identical file is `exact_duplicate`, a
 * perceptual near-match `visual_duplicate`). A photo the host cannot read is durably marked failed with a bounded
 * reason and named in `failures`; it stops blocking its assignment and stops consuming later runs' inspection slots.
 * Each photo is inspected once however many runs read it pending: a run first claims it at the revision it read, and
 * a run that loses the claim (or finds it held) leaves the photo to the holder. `settled` names the assignments of the
 * photos this run inspected or failed; `held` those with a photo another run is inspecting.
 */
export const inspectPendingPhotos = Effect.fnUntraced(function* (ctx: Ctx) {
	// ponytail: a claim held past this lease is taken as abandoned (its run died mid-inspection); an inspection that
	// genuinely runs longer is repeated by the next run
	const abandoned = instantOf(
		new Date(Date.parse(ctx.now) - INSPECTION_CLAIM_LEASE_MS).toISOString()
	);
	const pending = yield* ctx.query('photo_evidence', {
		where: { sha256: { eq: '' }, inspection_failed_at: { isNull: true } },
		select: {
			revision: true,
			photo: true,
			job_assignment_id: true,
			variation_request_id: true,
			inspection_claimed_at: true
		},
		limit: INSPECTIONS_PER_RUN
	});
	const failures: {
		photo_id: Id<'photo_evidence'>;
		reason: string;
	}[] = [];
	const settled = new Set<Id<'job_assignments'>>();
	const held = new Set<Id<'job_assignments'>>();
	if (pending.rows.length === 0) return { inspected: 0, failures, settled: [], held: [] };
	const rows = pending.rows.map((p) => ({
		id: p.id,
		revision: p.revision,
		claimed:
			p.inspection_claimed_at != null &&
			Date.parse(p.inspection_claimed_at) > Date.parse(abandoned),
		photo: p.photo,
		job_assignment_id: p.job_assignment_id,
		variation_request_id: p.variation_request_id
	}));
	const owner = yield* assignmentsOf(ctx, rows);
	const jobIds = [...new Set([...owner.values()].flatMap((id) => (id == null ? [] : [id])))];
	const jobs = jobIds.length
		? yield* ctx.query('job_assignments', {
				where: { id: { in: jobIds } },
				select: { site_id: { select: { location: true } } },
				all: true
			})
		: { rows: [] };
	const siteOf = new Map(jobs.rows.map((job) => [job.id, job.site_id?.location ?? null]));
	let inspected = 0;
	for (const photo of rows) {
		const own = owner.get(photo.id) ?? null;
		const claimed =
			!photo.claimed &&
			(yield* ctx
				.act(
					'photo_evidence.update',
					{ target: photo.id, set: { inspection_claimed_at: ctx.now } },
					{ observed: { [photo.id]: photo.revision } }
				)
				.pipe(
					Effect.as(true),
					Effect.catchTag('ActConflict', () => Effect.succeed(false))
				));
		if (!claimed) {
			if (own != null) held.add(own);
			continue;
		}
		if (own != null) settled.add(own);
		const inspectedPhoto = yield* Effect.result(ctx.files.image(photo.photo));
		if (Result.isFailure(inspectedPhoto)) {
			const reason = clipText(inspectedPhoto.failure.message, MAX_INSPECTION_FAILURE_REASON_CHARS);
			failures.push({ photo_id: photo.id, reason });
			yield* ctx.act('photo_evidence.update', {
				target: photo.id,
				set: { inspection_failed_at: ctx.now, inspection_failure_reason: reason }
			});
			continue;
		}
		const facts = inspectedPhoto.success;
		const flags = new Set(
			imageFlags(facts, photo.photo.mime, ctx.now, own == null ? null : (siteOf.get(own) ?? null))
		);
		const embedding = hexToBinaryEmbedding(facts.pdq);
		const near = yield* nearest(ctx, { pdq: { vector: embedding } }, 50);
		const hits = near
			.filter(
				(hit) =>
					hit.$distance <= VISUAL_DUPLICATE_MAX_L2 && hit.id !== photo.id && hit.sha256 !== ''
			)
			.map((hit) => ({
				id: hit.id,
				sha256: hit.sha256,
				job_assignment_id: hit.job_assignment_id,
				variation_request_id: hit.variation_request_id
			}));
		const hitOwner = yield* assignmentsOf(ctx, hits);
		const foreign = hits.filter((hit) => hitOwner.get(hit.id) !== own);
		if (foreign.some((hit) => hit.sha256 === facts.sha256)) flags.add('exact_duplicate');
		if (foreign.some((hit) => hit.sha256 !== facts.sha256)) flags.add('visual_duplicate');
		// the scene is retrieval only: a photo the embedding model cannot take keeps no scene, never a failed inspection
		const file = yield* visible(ctx, photo.photo);
		const scene = yield* ctx.ai
			.embed([file], {
				model: 'scene',
				dimensions: SCENE_DIMENSIONS
			})
			.pipe(Effect.catch((failure) => Effect.logWarning(failure).pipe(Effect.as(null))));
		const scene_embedding =
			scene === null || scene[0]?.length !== SCENE_DIMENSIONS ? null : [...scene[0]];
		yield* ctx.act('photo_evidence.update', {
			target: photo.id,
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
	return { inspected, failures, settled: [...settled], held: [...held] };
});
/**
 * Give a scene to hashed photos that have none: a seeded or bank-loaded photo arrives with its hash and pixel embedding but
 * no scene (the scene model is the host's), and without it a re-photographed site under another assignment is invisible
 * to every review. Batched per `ctx.ai.embed` call; a batch that fails is left for the next run.
 * ponytail: a photo the model always refuses is asked again each run (bounded by the cap); flag it if that shows up in cost.
 */
export const backfillScenes = Effect.fnUntraced(function* (ctx: Ctx) {
	const { rows } = yield* ctx.query('photo_evidence', {
		where: { sha256: { ne: '' }, scene_embedding: { isNull: true } },
		select: { photo: true },
		limit: SCENE_BACKFILL_PER_RUN
	});
	let filled = 0;
	const place = Effect.fnUntraced(function* (batch: ReadonlyArray<(typeof rows)[number]>) {
		const files = yield* Effect.forEach(batch, (row) => visible(ctx, row.photo), {
			concurrency: 'unbounded'
		});
		const scenes = yield* ctx.ai
			.embed(files, {
				model: 'scene',
				dimensions: SCENE_DIMENSIONS
			})
			.pipe(Effect.catch((failure) => Effect.logWarning(failure).pipe(Effect.as(null))));
		if (scenes === null) return;
		for (const [j, row] of batch.entries()) {
			const scene = scenes[j];
			if (scene?.length !== SCENE_DIMENSIONS) continue;
			yield* ctx.act('photo_evidence.update', {
				target: row.id,
				set: { scene_embedding: [...scene] }
			});
			filled += 1;
		}
	});
	// SCENE_BATCHES_AT_ONCE embedding requests in flight: each is seconds of provider time, not of this run's
	yield* Effect.forEach(
		Arr.chunksOf(rows, SCENE_BATCH),
		(batch) => place(batch).pipe(Effect.uninterruptible),
		{ concurrency: SCENE_BATCHES_AT_ONCE, discard: true }
	);
	return filled;
});
/** The unchecked worklist, materialised before reviewing (stamps shrink it as reviews succeed). */
export const uncheckedAssignments = Effect.fnUntraced(function* (
	ctx: Ctx,
	only?: readonly Id<'job_assignments'>[]
) {
	const { rows } = yield* ctx.query('job_assignments', {
		where: {
			suspicion_checked_at: { isNull: true },
			...(only === undefined ? {} : { id: { in: only } })
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
		id: row.id,
		site_id: row.site_id,
		title: row.title,
		nature: row.nature,
		scheduled_for: String(row.scheduled_for),
		description: row.description,
		status: row.status,
		summary: row.summary,
		location: row.location
	}));
});
const loadFacts = Effect.fnUntraced(function* (ctx: Ctx, assignment: ReviewFacts['assignment']) {
	const job = assignment.id;
	const [site, variations, messages] = yield* Effect.all(
		[
			ctx.query('sites', {
				id: assignment.site_id,
				select: { name: true, location: true, house_type: true }
			}),
			ctx.query('variation_requests', {
				where: { job_assignment_id: { eq: job } },
				select: {},
				all: true
			}),
			ctx.query('communication_logs', {
				where: { job_assignment_id: { eq: job } },
				select: { source_message_id: true, sender: true, sent_at: true, message: true },
				all: true
			})
		],
		{ concurrency: 'unbounded' }
	);
	const variationIds = variations.rows.map((v) => v.id);
	const photos = yield* ctx.query('photo_evidence', {
		where: variationIds.length
			? {
					or: [{ job_assignment_id: { eq: job } }, { variation_request_id: { in: variationIds } }]
				}
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
	if (waiting !== undefined) {
		const { AwaitingInspection } = yield* Effect.promise(
			() => import('./suspicion-review-failures.js')
		);
		return yield* new AwaitingInspection({ photoId: waiting.id });
	}
	const loadPhotoFacts = () =>
		Effect.forEach(
			photos.rows,
			(photo) =>
				fileFactsOf(ctx, photo.photo).pipe(
					Effect.map((file) => ({
						id: photo.id,
						...file,
						sha256: photo.sha256,
						flags: photo.flags,
						matched_evidence_ids: photo.matched_evidence_ids,
						created_at: photo.created_at == null ? null : String(photo.created_at),
						scene_embedding: photo.scene_embedding,
						inspection_failed_at:
							photo.inspection_failed_at == null ? null : String(photo.inspection_failed_at)
					})),
					Effect.uninterruptible
				),
			{ concurrency: 'unbounded' }
		);
	return {
		assignment,
		site:
			site == null
				? null
				: {
						id: site.id,
						name: site.name,
						location: site.location,
						house_type: site.house_type
					},
		photos: yield* loadPhotoFacts(),
		candidates: [],
		communications: messages.rows.map((m) => ({
			source_message_id: m.source_message_id,
			sender: m.sender,
			sent_at: String(m.sent_at),
			message: m.message
		}))
	};
});
const sceneCandidates = Effect.fnUntraced(function* (ctx: Ctx, facts: ReviewFacts) {
	const chronological = [...facts.photos].sort(byOrder);
	const probes =
		chronological.length <= MAX_PROBES
			? chronological
			: Array.from(
					{ length: MAX_PROBES },
					(_, i) => chronological[Math.round((i * (chronological.length - 1)) / (MAX_PROBES - 1))]!
				);
	const hits: {
		readonly probe: Id<'photo_evidence'>;
		readonly distance: number;
		readonly candidate: Pick<Row<'photo_evidence'>, 'id' | 'photo' | 'sha256' | 'flags'>;
	}[] = [];
	for (const probe of probes) {
		const embedding = probe.scene_embedding;
		if (embedding == null || embedding.length === 0) continue;
		const near = yield* nearest(ctx, { scene: { vector: embedding } }, 12);
		const rows = near
			.filter((hit) => hit.$distance <= SCENE_MAX_COSINE && hit.id !== probe.id)
			.map((hit) => ({
				hit,
				id: hit.id,
				job_assignment_id: hit.job_assignment_id,
				variation_request_id: hit.variation_request_id
			}));
		const owners = yield* assignmentsOf(ctx, rows);
		for (const { hit, id } of rows) {
			const owner = owners.get(id);
			if (owner == null || owner === facts.assignment.id) continue;
			hits.push({
				probe: probe.id,
				distance: hit.$distance,
				candidate: {
					id,
					photo: hit.photo,
					sha256: hit.sha256,
					flags: hit.flags
				}
			});
		}
	}
	const nominated = nominate(
		probes.map((p) => p.id),
		hits
	);
	const loadCandidateFacts = () =>
		Effect.forEach(
			nominated,
			(candidate) =>
				fileFactsOf(ctx, candidate.photo).pipe(
					Effect.map((file) => ({ ...candidate, ...file })),
					Effect.uninterruptible
				),
			{ concurrency: 'unbounded' }
		);
	return yield* loadCandidateFacts();
});
/** A file the provider reads as an image: a non-image declared type (a WhatsApp document) gets a host-derived JPEG. */
const visible = Effect.fnUntraced(function* (ctx: Ctx, ref: FileRef) {
	if (/^image\/(jpeg|png|webp|gif)$/.test(ref.mime)) return ref;
	return yield* ctx.files
		.image(ref, { jpeg: { maxEdge: 2048 } })
		.pipe(Effect.catch((failure) => Effect.logWarning(failure).pipe(Effect.as(ref))));
});
type ReviewStatus =
	'clear' | 'clear_existing' | 'suspicious' | 'suspicious_open_exists' | 'suspicious_log_exists';
export const reviewAssignment = Effect.fnUntraced(function* (
	ctx: Ctx,
	assignment: ReviewFacts['assignment']
) {
	const loaded = yield* loadFacts(ctx, assignment);
	const candidates = yield* sceneCandidates(ctx, loaded);
	const facts: ReviewFacts = { ...loaded, candidates };
	const representatives = selectInferencePhotos(
		facts.photos,
		candidates.flatMap((c) => c.matched_photo_ids)
	);
	const basis = reviewBasis(facts);
	const { sha256Text } = yield* Effect.promise(() => import('./sha256.js'));
	const basisHash = yield* sha256Text(JSON.stringify(basis));
	const attachedPairs = pairsOf(facts, representatives).filter((pair) => pair.attached);
	const prepare = (photos: readonly FileRef[]) =>
		Effect.forEach(photos, (photo) => visible(ctx, photo).pipe(Effect.uninterruptible), {
			concurrency: 'unbounded'
		});
	const pairTurn = Effect.fnUntraced(function* ({
		own,
		candidate
	}: (typeof attachedPairs)[number]) {
		const files = yield* prepare([own.photo, candidate.photo]);
		return yield* ctx.ai.sys_2.infer({
			model: SUSPICION_REVIEW_MODEL,
			prompt: PAIR_PROMPT,
			files,
			output: PAIR_DECISION
		});
	});
	const files = yield* prepare(representatives.map((p) => p.photo));
	// Collect failures after every admitted native call drains; an unjudged pair does not count as reuse.
	const [decision, ...pairTurns] = yield* Effect.all(
		[
			ctx.ai.sys_2.infer({
				model: SUSPICION_REVIEW_MODEL,
				prompt: suspicionPrompt(facts, representatives),
				files,
				output: DECISION
			}),
			...attachedPairs.map(pairTurn)
		] as const,
		{ mode: 'result', concurrency: 'unbounded' }
	);
	if (Result.isFailure(decision)) return yield* Effect.fail(decision.failure);
	const sameScene = pairTurns.map((turn) => Result.isSuccess(turn) && turn.success.same_scene);
	const { judge, ReviewDecisionInvalid } = yield* Effect.promise(
		() => import('./suspicion-review-verdict.js')
	);
	const verdict = yield* Effect.try({
		try: () =>
			judge(
				representatives,
				decision.success,
				attachedPairs.filter((_, i) => sameScene[i])
			),
		catch: (cause) =>
			cause instanceof ReviewDecisionInvalid
				? cause
				: new ReviewDecisionInvalid({ message: String(cause) })
	});
	const job = assignment.id;
	// a retried run with the same basis finds its review by the unique key instead of writing a second
	const written = yield* Effect.result(
		ctx.act('suspicion_reviews.create', {
			job_assignment_id: job,
			basis_hash: basisHash,
			basis,
			suspicious: verdict.suspicious,
			reason: verdict.reason,
			evidence_id: verdict.evidence_id,
			model: SUSPICION_REVIEW_MODEL,
			reviewed_at: ctx.now,
			source_key: reviewSourceKey(assignment.id, basisHash)
		})
	);
	if (
		Result.isFailure(written) &&
		!(written.failure._tag === 'ActRefused' && written.failure.code === 'unique')
	)
		return yield* Effect.fail(written.failure);
	const created = Result.isSuccess(written) && written.success.kind === 'committed';
	const {
		rows: [review]
	} = yield* ctx.query('suspicion_reviews', {
		where: { job_assignment_id: { eq: job }, basis_hash: { eq: basisHash } },
		select: { basis: true, suspicious: true, reason: true, evidence_id: true },
		limit: 1
	});
	if (review === undefined) {
		const { ReviewPersistenceFailed } = yield* Effect.promise(
			() => import('./suspicion-review-failures.js')
		);
		return yield* new ReviewPersistenceFailed({
			message: 'The suspicion review was not persisted.'
		});
	}
	let status: ReviewStatus = created ? 'clear' : 'clear_existing';
	if (review.suspicious) {
		// inference is external I/O: re-read the durable findings so a retry never writes a second log
		const [fromReview, open] = yield* Effect.all(
			[
				ctx.query('suspicious_activity_logs', {
					where: { review_id: { eq: review.id } },
					select: {},
					limit: 1
				}),
				ctx.query('suspicious_activity_logs', {
					where: { job_assignment_id: { eq: job }, resolved_at: { isNull: true } },
					select: {},
					limit: 1
				})
			],
			{ concurrency: 'unbounded' }
		);
		if (fromReview.rows.length > 0) status = 'suspicious_log_exists';
		else if (open.rows.length > 0) status = 'suspicious_open_exists';
		else {
			yield* ctx.act('suspicious_activity_logs.create', {
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
	yield* ctx.act('job_assignments.update', { target: job, set: { suspicion_checked_at: ctx.now } });
	return status;
});
/** The next two-hour slot (00:00, 02:00, … UTC), when a review that did not complete is tried again. */
export const nextRetrySlot = (now: Instant): Instant => {
	const at = new Date(now);
	at.setUTCMinutes(0, 0, 0);
	at.setUTCHours(at.getUTCHours() - (at.getUTCHours() % 2) + 2);
	return instantOf(at.toISOString());
};
