import { collection } from '@norbital-ai/bolt';
import {
	readSnapshotMonthIds,
	validateContributionMonth
} from '../../../lib/benefit-cases/benefit.js';

const months = collection('contribution_statement_months', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employee_id',
				'scheme_code',
				'coverage_month',
				'credited_amount',
				'paid_on',
				'source_reference',
				'evidence_file'
			]
		}
	},
	update: {
		input: { columns: ['credited_amount', 'paid_on', 'source_reference', 'evidence_file'] }
	}
});
export default months;

/** A statement month is recorded as the scheme states it; one a funded plan froze cannot change. */
months.transform(async (inputs, ctx) => {
	const { existing, db } = ctx;
	// An explicitly typed alias, so a refusal narrows what follows it (TS control flow).
	const refuse: (message: string, at?: { field?: string }) => never = (message, at) =>
		ctx.refuse(message, at as never);
	for (const [index, input] of inputs.entries())
		validateContributionMonth({ ...existing[index], ...input });
	const edited = existing.filter((row) => row != null);
	if (edited.length === 0) return inputs;
	const cases = await db.read('benefit_cases', {
		where: { employee_id: { in: [...new Set(edited.map((row) => row.employee_id))] } },
		all: true
	});
	if (cases.rows.length === 0) return inputs;
	const plans = await db.read('benefit_case_plans', {
		where: { benefit_case_id: { in: cases.rows.map((row) => row.id) } },
		all: true
	});
	const funded = await db.read('benefit_case_movements', {
		where: {
			benefit_case_id: { in: cases.rows.map((row) => row.id) },
			direction: { eq: 'EMPLOYEE_PAYMENT' }
		},
		all: true
	});
	const fundedCases = new Set(funded.rows.map((row) => row.benefit_case_id));
	for (const plan of plans.rows) {
		if (!fundedCases.has(plan.benefit_case_id)) continue;
		const frozen = plan.history_snapshot;
		if (frozen == null) refuse('An advance plan has no frozen contribution-statement history.');
		const frozenIds = readSnapshotMonthIds(frozen);
		if (frozenIds.some((id) => edited.some((row) => row.id === id)))
			refuse('A contribution month used by a frozen advance plan cannot change.');
	}
	return inputs;
});
