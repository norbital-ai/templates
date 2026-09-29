import { collection } from '@norbital-ai/bolt';
import {
	readSssSnapshotMonthIds,
	validateSssContributionMonth
} from '../../../lib/ph/maternity-benefit.js';

const sssContributionMonths = collection('sss_contribution_months', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employee_id',
				'coverage_month',
				'regular_msc',
				'paid_on',
				'source_reference',
				'evidence_file'
			]
		}
	},
	update: {
		input: {
			columns: ['regular_msc', 'paid_on', 'source_reference', 'evidence_file']
		}
	}
});
export default sssContributionMonths;

sssContributionMonths.transform(async (inputs, ctx) => {
	const { existing, db } = ctx;
	// An explicitly typed alias, so a refusal narrows what follows it (TS control flow).
	const refuse: (message: string, at?: { field?: string }) => never = (message, at) =>
		ctx.refuse(message, at as never);
	for (const [index, input] of inputs.entries())
		validateSssContributionMonth({ ...existing[index], ...input });
	const edited = existing.filter((row) => row != null);
	if (edited.length === 0) return inputs;
	const cases = await db.read('ph_maternity_cases', {
		where: { employee_id: { in: [...new Set(edited.map((row) => row.employee_id))] } },
		all: true
	});
	if (cases.rows.length === 0) return inputs;
	const plans = await db.read('ph_maternity_pay_plans', {
		where: { ph_maternity_case_id: { in: cases.rows.map((row) => row.id) } },
		all: true
	});
	const funded = await db.read('ph_maternity_movements', {
		where: {
			ph_maternity_case_id: { in: cases.rows.map((row) => row.id) },
			kind: { in: ['SSS_ADVANCE', 'SALARY_DIFFERENTIAL'] }
		},
		all: true
	});
	const fundedCases = new Set(funded.rows.map((row) => row.ph_maternity_case_id));
	for (const plan of plans.rows) {
		if (!fundedCases.has(plan.ph_maternity_case_id)) continue;
		const frozen = plan.sss_history_snapshot;
		if (frozen == null) refuse('A PH maternity advance plan has no frozen SSS statement history.');
		const frozenIds = readSssSnapshotMonthIds(frozen);
		if (frozenIds.some((id) => edited.some((row) => row.id === id)))
			refuse('An SSS contribution month used by a frozen PH maternity advance plan cannot change.');
	}
	return inputs;
});
