import { automation } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { lineageCodes } from '../lib/payroll_engine/statutory_drift.js';
/**
 * On the 1st of each month at 03:00 UTC, and when started by payroll authority, enqueue one `statutory_lineage` run
 * per sealed in-force jurisdiction code (or the one `code` given). It does not fetch pages or write drafts itself.
 */
const statutory_drift = automation({
	description:
		'On the 1st of each month, enqueue one statutory-lineage research run per sealed in-force jurisdiction. A manual start may name one code. It never seals a version.',
	on: { cron: '0 3 1 * *' },
	input: { code: { kind: 'text', optional: true } },
	output: { kind: 'object', fields: { lineages: { kind: 'list', of: { kind: 'text' } } } },
	runAs: ['statutory_drift_automation'],
	concurrency: { max: 1 }
});
export default statutory_drift;
statutory_drift.run(function* (input, ctx) {
	const { rows } = yield* ctx.read('jurisdiction_settings', {
		where: {
			sealed_at: { isNull: false },
			voided_at: { isNull: true },
			effective_range: { contains: { today: '' } },
			...(input.code == null || input.code === '' ? {} : { code: { eq: input.code } })
		},
		select: { id: true, code: true },
		all: true
	});
	const lineages = lineageCodes(rows);
	// every schedule in one crossing
	yield* Effect.forEach(
		lineages,
		(code) => ctx.schedule('statutory_lineage', { code }, { key: code }),
		{ concurrency: 'unbounded', discard: true }
	);
	return { lineages };
});
