import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { validateLoanRepayments } from '../../../../../../lib/loan_schedule.js';
import { loanAmount, loanRuleFacts } from '../../../../../../lib/loan_values.js';
import { transformEntries } from '../../../../../../lib/payroll_engine/admit.js';
import { entryRow } from '../../../../../../lib/payroll_engine/payslip/context.js';

const c = collection('loan_repayment_entry', {
	read: { fields: 'all', relations: 'all' },
	update: { input: { columns: ['occurred_on', 'amount', 'payslip_id'] } }
});
export default c;

c.transform(function* (inputs, ctx: TransformCtx<'loan_repayment_entry'>) {
	const targets = ctx.existing.flatMap((row) => (row === undefined ? [] : [row.id]));
	if (new Set(targets).size !== targets.length)
		return yield* ctx.refuse('Each repayment can be edited only once in a batch.');
	for (const [index, input] of inputs.entries()) {
		if (ctx.existing[index]?.payslip_id == null) continue;
		if ('$delete' in input) return yield* ctx.refuse('A repayment on a payslip cannot be changed.');
		if (input.amount !== undefined || input.occurred_on !== undefined)
			return yield* ctx.refuse('A repayment on a payslip cannot be changed.');
	}
	// A run's backlink (only `payslip_id`) changes no schedule and admits nothing: its loans need no read.
	if (
		inputs.every(
			(input) =>
				!('$delete' in input) &&
				Object.keys(input).every((key) => key === 'payslip_id' || key === 'id')
		)
	)
		return yield* transformEntries('loan_repayment_entry', inputs, ctx);
	const loanIds = [
		...new Set(ctx.existing.flatMap((row) => (row === undefined ? [] : [row.loan_id])))
	];
	const { loans, siblings } = yield* ctx.db.read({
		loans: { collection: 'loan_catalog_entry', where: { id: { in: loanIds } }, all: true },
		siblings: { collection: 'loan_repayment_entry', where: { loan_id: { in: loanIds } }, all: true }
	});
	for (const loan of loans.rows) {
		const edited = inputs.some((input, index) => {
			if (ctx.existing[index]?.loan_id !== loan.id) return false;
			if ('$delete' in input) return true;
			return input.amount !== undefined || input.occurred_on !== undefined;
		});
		if (!edited) continue;
		if (loan.principal_amount == null || loan.repayment_period == null)
			return yield* ctx.refuse(
				'Complete the loan principal and repayment period before editing its schedule.'
			);
		const repayments = siblings.rows
			.filter((row) => row.loan_id === loan.id)
			.flatMap((row) => {
				const index = ctx.existing.findIndex((existing) => existing?.id === row.id);
				const input = inputs[index];
				if (input !== undefined && '$delete' in input) return [];
				const draft = { ...row, ...input };
				return [
					{ ...draft, occurred_on: PlainDate(draft.occurred_on), amount: loanAmount(draft.amount) }
				];
			});
		const checked = validateLoanRepayments({
			principal_amount: loan.principal_amount,
			repayment_period: loan.repayment_period,
			repayments
		});
		if (!checked.ok) return yield* ctx.refuse(checked.message);
	}
	const values = inputs.map((input, index) => {
		const parent = loans.rows.find((loan) => loan.id === ctx.existing[index]?.loan_id);
		return {
			...entryRow({ ...ctx.existing[index], ...input }),
			facts: parent == null ? {} : loanRuleFacts(parent)
		};
	});
	return yield* transformEntries(
		'loan_repayment_entry',
		inputs,
		ctx,
		{
			loan_repayment_entry: ctx.existing.flatMap((row) =>
				row === undefined ? [] : [row.catalog_id]
			)
		},
		values
	);
});
