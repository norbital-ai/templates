import { collection, type TransformCtx } from '@norbital-ai/bolt';
import {
	refusePaidTermsChange,
	refuseTermsOverlap,
	termsFromFacts
} from '../../../../lib/payroll_engine/contract_terms.js';
import { dayKey } from '../../../../lib/payroll_engine/leave.js';
import {
	beforeOf,
	eachBatched,
	runEngine,
	workspaceReadAsHost
} from '../../../../lib/payroll_engine/foundation.js';
import { admitContractTerms } from '../../../../lib/payroll_engine/services.js';
import {
	exitGroundRefusal,
	refuseClosedUpdate
} from '../../../../lib/payroll_engine/offboarding.js';
import { refuseUnlistedKind } from '../../../../lib/payroll_engine/listed_kinds.js';

const create_columns = [
	'employee_number',
	'bank',
	'effective_range',
	'signed_contract_end',
	'prior_service_months',
	'engagement',
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
	'engagement',
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
	// Every input at once over one batched reader: a batch reads once per shape, not once per row.
	return eachBatched(inputs, workspaceReadAsHost(ctx.db.read), async (input, i, read) => {
		const before = ctx.existing[i];
		if (before !== undefined) {
			const closed = refuseClosedUpdate(
				before,
				input.effective_range === undefined ? {} : { effective_range: input.effective_range }
			);
			if (closed != null) ctx.refuse(closed);
		}
		// A departure is a ground with its last day; a ground written, or kept onto a moved last day, is one the
		// version governing the last day lists.
		const ground = 'exit_ground' in input ? input.exit_ground : before?.exit_ground;
		const range = input.effective_range ?? before?.effective_range;
		const unpaired = exitGroundRefusal({ ground, to: range?.to });
		if (unpaired != null) ctx.refuse(unpaired);
		if (
			ground != null &&
			ground !== '' &&
			(ground !== before?.exit_ground ||
				String(range?.to ?? '') !== String(before?.effective_range.to ?? ''))
		) {
			const company_id = input.company_id ?? before?.company_id;
			const refused =
				range?.to == null || company_id == null
					? 'An exit ground is written with the last day of work.'
					: await refuseUnlistedKind(
							{
								rule: 'exit_grounds',
								noun: 'exit ground',
								company_id,
								code: ground,
								day: String(range.to)
							},
							read
						);
			if (refused != null) ctx.refuse(refused);
		}
		const facts = 'facts' in input ? input.facts : before?.facts;
		const overlap = refuseTermsOverlap(termsFromFacts(facts));
		if (overlap != null) ctx.refuse(overlap);
		// A paid period keeps the terms it was paid on: month-to-date statutory and projections read them again.
		if (before !== undefined && 'facts' in input) {
			const slips = await read('payslip', {
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
				read,
				ctx.refuse
			);
		// `before` keeps what a duty may compare, never bank details or free text.
		const {
			bank: _bank,
			comments: _comments,
			...changed
		} = before === undefined ? {} : beforeOf(before, input);
		return before === undefined ? input : { ...input, before: changed };
	});
});
