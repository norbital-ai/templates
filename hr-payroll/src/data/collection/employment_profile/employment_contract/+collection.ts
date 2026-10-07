import { collection, type TransformCtx } from '@norbital-ai/bolt';
import {
	refusePaidTermsChange,
	refuseTermsOverlap,
	termsFromFacts
} from '../../../../lib/payroll_engine/contract_terms.js';
import { dayKey } from '../../../../lib/payroll_engine/leave.js';
import { runEngine } from '../../../../lib/payroll_engine/foundation.js';
import { admitContractTerms } from '../../../../lib/payroll_engine/services.js';
import { refuseClosedUpdate } from '../../../../lib/payroll_engine/offboarding.js';

const create_columns = [
	'employee_number',
	'bank',
	'effective_range',
	'signed_contract_end',
	'prior_service_months',
	'exit_ground',
	'exit_facts',
	'comments',
	'facts',
	'employee_id',
	'company_id'
] as const;
const update_columns = [
	'employee_number',
	'bank',
	'effective_range',
	'signed_contract_end',
	'prior_service_months',
	'exit_ground',
	'exit_facts',
	'comments',
	'facts',
	'employee_id',
	'company_id'
] as const;

const c = collection('employment_contract', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'employment_contract'>) => {
	const out = [];
	for (const [i, input] of inputs.entries()) {
		const before = ctx.existing[i];
		if (before !== undefined) {
			const closed = refuseClosedUpdate(
				before,
				input.effective_range === undefined ? {} : { effective_range: input.effective_range }
			);
			if (closed != null) ctx.refuse(closed);
		}
		const facts = 'facts' in input ? input.facts : before?.facts;
		const overlap = refuseTermsOverlap(termsFromFacts(facts));
		if (overlap != null) ctx.refuse(overlap);
		// A paid period keeps the terms it was paid on: month-to-date statutory and projections read them again.
		if (before !== undefined && 'facts' in input) {
			const slips = await ctx.db.read('payslip', {
				where: { employment_id: { eq: before.id } },
				select: { salary_from: true, salary_to: true },
				all: true
			});
			const paid = slips.rows.flatMap((slip) => {
				const from = dayKey(slip.salary_from);
				const to = dayKey(slip.salary_to);
				return from == null || to == null ? [] : [{ from, to }];
			});
			const locked = refusePaidTermsChange(before.facts, input.facts, paid);
			if (locked != null) ctx.refuse(locked);
		}
		// The governing version's contract validations judge every new or changed term.
		if ('facts' in input)
			await runEngine(
				admitContractTerms({ contract: { ...before, ...input }, before: before?.facts }),
				ctx.db.read,
				ctx.refuse
			);
		out.push(input);
	}
	return out;
});
