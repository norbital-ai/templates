import { model } from '@norbital-ai/bolt';
import * as Effect from 'effect/Effect';
import { SUSPICION_BASIS } from '../../../lib/basis.js';
/**
 * A suspicion judgement against one assignment. It is created open, by the review automation or an authorised person,
 * with an immutable basis; it is closed once, by `resolve`, with all three resolution fields together, and that sentence
 * is the record. The judgement is outside the update columns, so it cannot be rewritten.
 */
export default model('suspicious_activity_logs', {
	description:
		'An AI or authorized-human suspicion judgement against one job assignment, with immutable evidence basis and an explicit controller resolution.',
	icon: 'lucide:shield-alert',
	label: 'reason',
	fields: {
		job_assignment_id: {
			kind: 'ref',
			to: 'job_assignments',
			inverse: 'suspicious_activity_logs'
		},
		review_id: {
			kind: 'ref',
			to: 'suspicion_reviews',
			inverse: 'suspicious_activity_logs',
			optional: true
		},
		/** The cited photo is a pointer into the evidence, never a hold on it: deleting the photo clears the citation. */
		evidence_id: { kind: 'ref', to: 'photo_evidence', optional: true, onDelete: 'setNull' },
		resolved_by: { kind: 'ref', to: 'sys_user', optional: true, onDelete: 'setNull' },
		/** `<origin>:<assignment>:<sha256(basis)>`, derived: one log per judged basis. */
		source_key: { kind: 'text', unique: true, hidden: true },
		origin: { kind: 'enum', values: ['automation', 'human'], default: 'human' },
		/** The facts the judgement was made on; a human judgement's is composed from its reason. */
		basis: { kind: 'json', shape: SUSPICION_BASIS, optional: true },
		reason: { kind: 'text' },
		resolution: { kind: 'text', optional: true },
		resolved_at: { kind: 'instant', optional: true }
	},
	index: ['resolved_at'],
	search: { text: ['reason', 'resolution'] },
	read: 'all',
	create: {
		columns: ['job_assignment_id', 'origin', 'basis', 'review_id', 'evidence_id', 'reason'],
		transform: function* (rows, ctx) {
			const reviewIds = [
				...new Set(rows.flatMap((row) => (row.review_id == null ? [] : [row.review_id])))
			];
			const evidenceIds = [
				...new Set(rows.flatMap((row) => (row.evidence_id == null ? [] : [row.evidence_id])))
			];
			const { reviews, evidence } = yield* ctx.db.query({
				reviews: { from: 'suspicion_reviews', where: { id: { in: reviewIds } }, all: true },
				evidence: { from: 'photo_evidence', where: { id: { in: evidenceIds } }, all: true }
			});
			// the second read: the assignment a variation's photo belongs to
			const variationIds = evidence.rows.flatMap((photo) =>
				photo.job_assignment_id == null && photo.variation_request_id != null
					? [photo.variation_request_id]
					: []
			);
			const variations = variationIds.length
				? yield* ctx.db.query('variation_requests', {
						where: { id: { in: variationIds } },
						all: true
					})
				: { rows: [] };
			const reviewJob = new Map(
				reviews.rows.map((r) => [String(r.id), String(r.job_assignment_id)])
			);
			const variationJob = new Map(
				variations.rows.map((v) => [String(v.id), String(v.job_assignment_id)])
			);
			const evidenceJob = new Map(
				evidence.rows.map((p) => [
					String(p.id),
					p.job_assignment_id != null
						? String(p.job_assignment_id)
						: variationJob.get(String(p.variation_request_id))
				])
			);
			const { sha256Text } = yield* Effect.promise(() => import('../../../lib/sha256.js'));
			const out: (typeof rows)[number][] = [];
			for (const [row, input] of rows.entries()) {
				const reason = input.reason;
				if (reason.trim() === '')
					return yield* ctx.refuse('Suspicion judgement reason cannot be empty.', {
						field: 'reason',
						row
					});
				const origin = input.origin ?? 'human';
				const job = String(input.job_assignment_id);
				const given = input.basis;
				if (origin === 'automation' && given?.kind !== 'review')
					return yield* ctx.refuse(
						'An automated suspicion judgement must supply its reviewed evidence basis.',
						{ row }
					);
				if (origin === 'automation' && input.review_id == null)
					return yield* ctx.refuse(
						'An automated suspicion judgement must reference its inference review.',
						{ row }
					);
				if (origin === 'human' && input.review_id != null)
					return yield* ctx.refuse(
						'A human suspicion judgement cannot claim an automated inference review.',
						{ row }
					);
				if (input.review_id != null && reviewJob.get(String(input.review_id)) !== job)
					return yield* ctx.refuse('Suspicion review belongs to another job assignment.', { row });
				if (input.evidence_id != null && evidenceJob.get(String(input.evidence_id)) !== job)
					return yield* ctx.refuse('Suspicion evidence belongs to another job assignment.', {
						row
					});
				const basis = given ?? {
					kind: 'human_judgement' as const,
					reason,
					evidence_id: input.evidence_id ?? null
				};
				const digest = yield* sha256Text(JSON.stringify(basis));
				out.push({ ...input, origin, basis, source_key: `${origin}:${job}:${digest}` });
			}
			return out;
		}
	},
	update: {
		columns: ['resolution', 'resolved_at', 'resolved_by'],
		transform: function* (changes, ctx) {
			for (const [row, { before, set }] of changes.entries()) {
				if (before.resolved_at != null)
					return yield* ctx.refuse(
						'A resolved suspicion judgement cannot be reopened or rewritten.',
						{ row }
					);
				if (
					(set.resolution ?? '').trim() === '' ||
					set.resolved_at == null ||
					set.resolved_by == null
				)
					return yield* ctx.refuse(
						'Resolution, resolved_at, and resolved_by must be written together.',
						{ row }
					);
			}
			return changes.map(({ set }) => set);
		}
	}
});
