import { automation } from '@norbital-ai/bolt';
import { verify } from '../lib/integrity.js';
import { queryAllRows } from '../lib/payroll_engine/reads.js';

/**
 * Checks the ledger against what it stands for and raises one task per finding, keyed
 * `integrity:<invariant>:<subject>`: a finding with an open task raises nothing, and one that comes back after its task
 * was closed raises a dated one. It writes nothing else and repairs nothing.
 */
export default automation('integrity', {
	description: 'Check the ledger and raise a task for each finding; it changes nothing else.',
	input: {},
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const today = String(ctx.today);
		const found = yield* verify(ctx.query, today);
		if (found.length === 0) return;
		const { entity: entities = [], obligation: raised = [] } = yield* queryAllRows(ctx.query, {
			entity: { fields: ['id'], limit: 1 },
			obligation: {
				where: { occurrence_key: { like: 'integrity:%' } },
				fields: ['occurrence_key', 'state'],
				limit: 10000
			}
		});
		const [entity] = entities;
		if (entity === undefined) return;
		const taken = new Set(raised.map((row) => String(row.occurrence_key)));
		const open = new Set(
			raised
				.filter((row) => row.state === 'OPEN')
				.map((row) => String(row.occurrence_key).split('@')[0])
		);
		const due = found.flatMap((finding) => {
			const base = `integrity:${finding.invariant}:${finding.subject}`;
			const occurrence_key = taken.has(base) ? `${base}@${today}` : base;
			return open.has(base) || taken.has(occurrence_key)
				? []
				: [
						{
							entity_id: String(entity.id),
							...(finding.employee_id === undefined ? {} : { employee_id: finding.employee_id }),
							title: `Ledger check: ${finding.message}`,
							occurrence_key
						}
					];
		});
		if (due.length > 0) yield* ctx.act.checked([{ callable: 'obligation.create', input: due }]);
	}
});
