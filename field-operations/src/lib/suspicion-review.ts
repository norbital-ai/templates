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
/**
 * The photos nearest a probe on one of photo_evidence's indexes (`pdq`: L2 over the PDQ bits; `scene`: cosine), each with
 * its `$distance`. `limit` stays explicit: the default page times the rerank candidates is too large.
 */
const nearest = (ctx: Ctx, search: IndexSearch<'photo_evidence'>, limit: number) =>
	ctx
		.query({
			photo_evidence: {
				search,
				fields: ['photo', 'sha256', 'flags', 'job_assignment_id'],
				limit
			}
		})
		.pipe(Effect.map(({ photo_evidence }) => photo_evidence.rows));
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
/** Raw job-site JPEGs can be a MiB each; keep a batch within the AI call's 20-second wall. */
const SCENE_BATCH = 4;
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
/** GPS state in words a reviewer reads. */
const gpsWords = (flags: readonly string[]) =>
	flags.includes('missing_geolocation')
		? 'no GPS'
		: flags.includes('location_mismatch')
			? 'GPS outside the site'
			: 'GPS at the site';
/** The provider-bounded facts of one turn as compact text: only what a reviewer needs, oldest messages dropped first. */
function inferenceContext(
	facts: ReviewFacts,
	representatives = selectInferencePhotos(facts.photos)
): string {
	const a = facts.assignment;
	const attached = new Set(representatives.map((photo) => photo.id));
	const others = facts.photos.filter((photo) => !attached.has(photo.id));
	const counts = PHOTO_FLAGS.map(
		(flag) => [flag, others.filter((p) => p.flags.includes(flag)).length] as const
	)
		.filter(([, n]) => n > 0)
		.map(([flag, n]) => `${flag} ×${n}`);
	const head = [
		`Job: ${clipText(a.title, 200)}${a.nature == null ? '' : ` (${clipText(a.nature, 80)})`}, ${a.scheduled_for}, ${a.status}.`,
		`Site: ${facts.site == null ? 'unknown' : clipText(facts.site.name, 200)}.`,
		...(a.description.trim() === '' ? [] : [`Work order: ${clipText(a.description, 600)}`]),
		...(a.summary == null ? [] : [`Contractor summary: ${clipText(a.summary, 600)}`]),
		'',
		representatives.length === 0
			? `Photos: ${facts.photos.length}, none attached for viewing.`
			: `Attached photos, in order (${representatives.length} of ${facts.photos.length}):`,
		...representatives.map(
			(photo, i) =>
				`${i + 1}. ${assetName(photo)} — ${gpsWords(photo.flags)}${photo.flags.length === 0 ? '' : `; ${[...photo.flags].sort().join(', ')}`}`
		),
		...(others.length === 0
			? []
			: [
					`Not attached: ${others.length} more photo${others.length === 1 ? '' : 's'}${counts.length === 0 ? '' : ` (${counts.join(', ')})`}.`
				])
	];
	let messages = [...facts.communications]
		.sort(
			(l, r) =>
				l.sent_at.localeCompare(r.sent_at) || l.source_message_id.localeCompare(r.source_message_id)
		)
		.slice(-MAX_COMMUNICATIONS)
		.map(
			(m) =>
				`- ${m.sent_at.slice(0, 16).replace('T', ' ')} ${clipText(m.sender, 60)}: ${clipText(m.message, MAX_MESSAGE_CHARS)}`
		);
	for (;;) {
		const omitted = facts.communications.length - messages.length;
		const text = [
			...head,
			'',
			messages.length === 0
				? 'Messages: none.'
				: `Messages (${messages.length}${omitted > 0 ? ` most recent; ${omitted} older omitted` : ''}):`,
			...messages
		].join('\n');
		if (text.length <= MAX_INFERENCE_CONTEXT_CHARS || messages.length === 0) return text;
		messages = messages.slice(1);
	}
}
function suspicionPrompt(
	facts: ReviewFacts,
	representatives = selectInferencePhotos(facts.photos)
): string {
	return [
		'Review this field-work assignment in one structured turn. Rules:',
		'- Refer to a photo only by its exact name from the list below; invent no other identifier, address or coordinate.',
		representatives.length === 0
			? '- No photo is attached: judge from the job, the site, the photo flags and the messages; do not describe a scene.'
			: '- Only the listed attached photos are visible; never claim to have seen a marker in one that is not attached.',
		'- Missing GPS and repeated similar views within one job are neutral facts on their own.',
		'- Judge location only from physical markers visible in a photo (door plates, house numbers, street or building signs, lobby signs, lift permits); ignore timestamp/GPS/address overlays, labels, tape measures, tag and phone numbers.',
		'- Duplicate reuse matters only across different jobs; the same file twice in one job is neutral.',
		'- Flag mixed sites only when two attached photos show concrete markers of conflicting sites.',
		'- A suspicion is an escalation: return suspicious true only for a concrete, articulable reason; a location mismatch is evidence to weigh, not an automatic verdict.',
		`- If suspicious: a reason a controller can investigate (at most ${MAX_INFERENCE_REASON_CHARS} characters) and evidence_asset_name = the decisive photo's exact name. If not: evidence_asset_name "" and why (at most ${MAX_INFERENCE_REASON_CHARS} characters).`,
		'',
		inferenceContext(facts, representatives)
	].join('\n');
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
	const { photo_evidence: pending } = yield* ctx.query({
		photo_evidence: {
			where: { sha256: { eq: '' }, inspection_failed_at: { isNull: true } },
			fields: ['revision', 'photo', 'job_assignment_id', 'inspection_claimed_at'],
			limit: INSPECTIONS_PER_RUN
		}
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
		job_assignment_id: p.job_assignment_id
	}));
	const jobIds = [
		...new Set(rows.flatMap((p) => (p.job_assignment_id == null ? [] : [p.job_assignment_id])))
	];
	const { job_assignments: jobs } = jobIds.length
		? yield* ctx.query({ job_assignments: { where: { id: { in: jobIds } }, fields: ['site_id'] } })
		: { job_assignments: { rows: [] } };
	const siteIds = [...new Set(jobs.rows.map((job) => job.site_id))];
	const { sites } = siteIds.length
		? yield* ctx.query({ sites: { where: { id: { in: siteIds } }, fields: ['location'] } })
		: { sites: { rows: [] } };
	const locationOf = new Map(sites.rows.map((site) => [site.id, site.location]));
	const siteOf = new Map(jobs.rows.map((job) => [job.id, locationOf.get(job.site_id) ?? null]));
	let inspected = 0;
	for (const photo of rows) {
		const own = photo.job_assignment_id;
		const claimed =
			!photo.claimed &&
			(yield* ctx
				.act(
					'photo_evidence.update',
					[{ target: photo.id, set: { inspection_claimed_at: ctx.now } }],
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
			yield* ctx.act('photo_evidence.update', [
				{
					target: photo.id,
					set: { inspection_failed_at: ctx.now, inspection_failure_reason: reason }
				}
			]);
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
			.map((hit) => ({ id: hit.id, sha256: hit.sha256, job_assignment_id: hit.job_assignment_id }));
		const foreign = hits.filter((hit) => hit.job_assignment_id !== own);
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
		yield* ctx.act('photo_evidence.update', [
			{
				target: photo.id,
				set: {
					sha256: facts.sha256,
					perceptual_embedding: embedding,
					scene_embedding,
					flags: [...flags],
					matched_evidence_ids: foreign.map((hit) => hit.id)
				}
			}
		]);
		inspected += 1;
	}
	return { inspected, failures, settled: [...settled], held: [...held] };
});
/**
 * Give a scene to hashed photos that have none: a seeded or bank-loaded photo arrives with its hash and pixel embedding but
 * no scene (the scene model is the host's), and without it a re-photographed site under another assignment is invisible
 * to every review. Batched per native `ctx.ai.embed` call (never one image per call); a batch that fails is left for the next run.
 * `ponytail: a photo the model always refuses is asked again each run (bounded by the cap); flag it if that shows up in cost.
 */
export const backfillScenes = Effect.fnUntraced(function* (ctx: Ctx) {
	const {
		photo_evidence: { rows }
	} = yield* ctx.query({
		photo_evidence: {
			where: { sha256: { ne: '' }, scene_embedding: { isNull: true } },
			fields: ['photo'],
			limit: SCENE_BACKFILL_PER_RUN
		}
	});
	let filled = 0;
	const failures: { photo_id: Id<'photo_evidence'>; reason: string }[] = [];
	const place = Effect.fnUntraced(function* (batch: ReadonlyArray<(typeof rows)[number]>) {
		const files = yield* Effect.forEach(batch, (row) => visible(ctx, row.photo), {
			concurrency: 'unbounded'
		});
		const answer = yield* ctx.ai
			.embed(files, {
				model: 'scene',
				dimensions: SCENE_DIMENSIONS
			})
			.pipe(Effect.result);
		if (Result.isFailure(answer)) {
			const reason = messageOf(answer.failure);
			failures.push(...batch.map((row) => ({ photo_id: row.id, reason })));
			yield* Effect.logWarning(answer.failure);
			return;
		}
		for (const [j, row] of batch.entries()) {
			const scene = answer.success[j];
			if (scene?.length !== SCENE_DIMENSIONS) {
				failures.push({
					photo_id: row.id,
					reason: `The scene model returned ${scene?.length ?? 0} dimensions; expected ${SCENE_DIMENSIONS}.`
				});
				continue;
			}
			yield* ctx.act('photo_evidence.update', [
				{ target: row.id, set: { scene_embedding: [...scene] } }
			]);
			filled += 1;
		}
	});
	// SCENE_BATCHES_AT_ONCE native batch requests in flight: each is seconds of provider time, not of this run's
	yield* Effect.forEach(
		Arr.chunksOf(rows, SCENE_BATCH),
		(batch) => place(batch).pipe(Effect.uninterruptible),
		{ concurrency: SCENE_BATCHES_AT_ONCE, discard: true }
	);
	return { filled, failures };
});
/** The unchecked worklist, materialised before reviewing (stamps shrink it as reviews succeed). */
export const uncheckedAssignments = Effect.fnUntraced(function* (
	ctx: Ctx,
	only?: readonly Id<'job_assignments'>[]
) {
	const {
		job_assignments: { rows }
	} = yield* ctx.query({
		job_assignments: {
			where: {
				suspicion_checked_at: { isNull: true },
				...(only === undefined ? {} : { id: { in: only } })
			},
			fields: [
				'site_id',
				'title',
				'nature',
				'scheduled_for',
				'description',
				'status',
				'summary',
				'location'
			]
		}
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
	// the independent facts in one read request: one crossing, one statement
	const { sites, communication_logs: messages } = yield* ctx.query({
		sites: {
			where: { id: { eq: assignment.site_id } },
			fields: ['name', 'location', 'house_type'],
			limit: 1
		},
		communication_logs: {
			where: { job_assignment_id: { eq: job } },
			fields: ['source_message_id', 'sender', 'sent_at', 'message']
		}
	});
	const site = sites.rows[0] ?? null;
	const { photo_evidence: photos } = yield* ctx.query({
		photo_evidence: {
			where: { job_assignment_id: { eq: job } },
			fields: [
				'photo',
				'sha256',
				'inspection_failed_at',
				'flags',
				'matched_evidence_ids',
				'created_at',
				'scene_embedding'
			]
		}
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
			.map((hit) => ({ hit, id: hit.id, owner: hit.job_assignment_id }));
		for (const { hit, id, owner } of rows) {
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
		ctx.act('suspicion_reviews.create', [
			{
				job_assignment_id: job,
				basis_hash: basisHash,
				basis,
				suspicious: verdict.suspicious,
				reason: verdict.reason,
				evidence_id: verdict.evidence_id,
				model: SUSPICION_REVIEW_MODEL,
				reviewed_at: ctx.now,
				source_key: reviewSourceKey(assignment.id, basisHash)
			}
		])
	);
	if (
		Result.isFailure(written) &&
		!(written.failure._tag === 'ActRefused' && written.failure.code === 'unique')
	)
		return yield* Effect.fail(written.failure);
	const created = Result.isSuccess(written) && written.success.kind === 'committed';
	const {
		suspicion_reviews: {
			rows: [review]
		}
	} = yield* ctx.query({
		suspicion_reviews: {
			where: { job_assignment_id: { eq: job }, basis_hash: { eq: basisHash } },
			fields: ['basis', 'suspicious', 'reason', 'evidence_id'],
			limit: 1
		}
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
		// a model is one root per request: the log this review wrote, or any open one, in one read
		const { suspicious_activity_logs: standing } = yield* ctx.query({
			suspicious_activity_logs: {
				where: {
					or: [
						{ review_id: { eq: review.id } },
						{ job_assignment_id: { eq: job }, resolved_at: { isNull: true } }
					]
				},
				fields: ['review_id']
			}
		});
		if (standing.rows.some((log) => log.review_id === review.id)) status = 'suspicious_log_exists';
		else if (standing.rows.length > 0) status = 'suspicious_open_exists';
		else {
			yield* ctx.act('suspicious_activity_logs.create', [
				{
					job_assignment_id: job,
					origin: 'automation',
					basis: review.basis,
					review_id: review.id,
					evidence_id: review.evidence_id,
					reason: review.reason
				}
			]);
			status = 'suspicious';
		}
	}
	yield* ctx.act('job_assignments.update', [
		{ target: job, set: { suspicion_checked_at: ctx.now } }
	]);
	return status;
});
/** The next two-hour slot (00:00, 02:00, … UTC), when a review that did not complete is tried again. */
export const nextRetrySlot = (now: Instant): Instant => {
	const at = new Date(now);
	at.setUTCMinutes(0, 0, 0);
	at.setUTCHours(at.getUTCHours() - (at.getUTCHours() % 2) + 2);
	return instantOf(at.toISOString());
};
