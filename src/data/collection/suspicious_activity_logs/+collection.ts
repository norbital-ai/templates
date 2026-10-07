import { collection } from '@norbital-ai/bolt';
import { sha256Text } from '../../../lib/sha256.js';

/**
 * A judgement is created open, by the review automation or an authorised person, with an immutable basis; it is
 * closed once, by `resolve`, with all three resolution fields together. The judgement is outside the update
 * selection, so it cannot be rewritten.
 */
const logs = collection('suspicious_activity_logs', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: ['job_assignment_id', 'origin', 'basis', 'review_id', 'evidence_id', 'reason']
		}
	},
	update: { input: { columns: ['resolution', 'resolved_at', 'resolved_by'] } },
	actions: {
		resolve: {
			description: "Close this finding with the controller's conclusion.",
			target: 'record',
			input: { resolution: { kind: 'text' } }
		}
	}
});
export default logs;

logs.transform(async (inputs, ctx) => {
	const creates = inputs.filter((_, i) => ctx.existing[i] === undefined);
	const reviewIds = [
		...new Set(creates.flatMap((input) => (input.review_id == null ? [] : [input.review_id])))
	];
	const evidenceIds = [
		...new Set(creates.flatMap((input) => (input.evidence_id == null ? [] : [input.evidence_id])))
	];
	const [reviews, evidence] = await Promise.all([
		reviewIds.length
			? ctx.db.read('suspicion_reviews', {
					where: { id: { in: reviewIds } },
					all: true
				})
			: { rows: [] },
		evidenceIds.length
			? ctx.db.read('photo_evidence', {
					where: { id: { in: evidenceIds } },
					all: true
				})
			: { rows: [] }
	]);
	// the second wave: the assignment a variation's photo belongs to
	const variationIds = evidence.rows.flatMap((photo) =>
		photo.job_assignment_id == null && photo.variation_request_id != null
			? [photo.variation_request_id]
			: []
	);
	const variations = variationIds.length
		? await ctx.db.read('variation_requests', { where: { id: { in: variationIds } }, all: true })
		: { rows: [] };
	const reviewJob = new Map(reviews.rows.map((r) => [String(r.id), String(r.job_assignment_id)]));
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

	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		if (stored !== undefined) {
			if (stored.resolved_at != null)
				ctx.refuse('A resolved suspicion judgement cannot be reopened or rewritten.');
			if (
				String(input.resolution ?? '').trim() === '' ||
				input.resolved_at == null ||
				input.resolved_by == null
			)
				ctx.refuse('Resolution, resolved_at, and resolved_by must be written together.');
			return input;
		}
		const reason = String(input.reason ?? '');
		if (reason.trim() === '')
			ctx.refuse('Suspicion judgement reason cannot be empty.', { field: 'reason' });
		const origin = input.origin ?? 'human';
		const job = String(input.job_assignment_id);
		const given = String(input.basis ?? '').trim();
		if (origin === 'automation' && given === '')
			ctx.refuse('An automated suspicion judgement must supply its reviewed evidence basis.');
		if (origin === 'automation' && input.review_id == null)
			ctx.refuse('An automated suspicion judgement must reference its inference review.');
		if (origin === 'human' && input.review_id != null)
			ctx.refuse('A human suspicion judgement cannot claim an automated inference review.');
		if (input.review_id != null && reviewJob.get(String(input.review_id)) !== job)
			ctx.refuse('Suspicion review belongs to another job assignment.');
		if (input.evidence_id != null && evidenceJob.get(String(input.evidence_id)) !== job)
			ctx.refuse('Suspicion evidence belongs to another job assignment.');
		const basis =
			given === ''
				? JSON.stringify({
						kind: 'human_judgement',
						reason,
						evidence_id: input.evidence_id ?? null
					})
				: String(input.basis);
		return { ...input, origin, basis, source_key: `${origin}:${job}:${sha256Text(basis)}` };
	});
});

logs.action('resolve', async (input, ctx) => {
	await ctx.act('suspicious_activity_logs.update', {
		target: ctx.target.id,
		set: {
			resolution: input.resolution,
			resolved_at: ctx.now,
			resolved_by: ctx.actor.kind === 'member' ? ctx.actor.id : null
		}
	});
});
