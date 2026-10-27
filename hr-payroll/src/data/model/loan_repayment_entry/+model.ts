import { model, type WriteCtx, type UpdateSet, type StoredRow, type Id } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { validateLoanRepayments } from '../../../lib/loan_schedule.js';
import { loanAmount, loanCalendar, loanRuleFacts } from '../../../lib/loan_values.js';
import { loadEntry, transformEntries } from '../../../lib/payroll_engine/admit.js';
import { entryRow } from '../../../lib/payroll_engine/payslip/context.js';
import { Effect } from 'effect';

type WriteInput = Omit<UpdateSet<'loan_repayment_entry'>, 'id'> & {
	readonly id?: Id<'loan_repayment_entry'>;
	readonly $delete?: true;
};

const transformRows = Effect.fnUntraced(function* (
	inputs: readonly WriteInput[],
	existing: readonly (StoredRow<'loan_repayment_entry'> | undefined)[],
	ctx: WriteCtx<'loan_repayment_entry'>
) {
	const targets = existing.flatMap((row) => (row === undefined ? [] : [row.id]));
	if (new Set(targets).size !== targets.length)
		return yield* ctx.refuse('Each repayment can be edited only once in a batch.');
	// A run's backlink (only `payslip_id`) changes no schedule and admits nothing: its loans need no read.
	if (
		inputs.every(
			(input) =>
				!('$delete' in input) &&
				Object.keys(input).every((key) => key === 'payslip_id' || key === 'id')
		)
	)
		return yield* transformEntries('loan_repayment_entry', inputs, existing, ctx);
	const loanIds = [...new Set(existing.flatMap((row) => (row === undefined ? [] : [row.loan_id])))];
	// A nested schedule edit is checked against the principal and terms this same act will commit.
	const loans = yield* ctx.db.after('loan_catalog_entry', { id: { in: loanIds } });
	const admission = inputs.flatMap((input, index) => {
		const before = existing[index];
		if (before === undefined) return [];
		const row = { ...before, ...input };
		return [
			{
				employment_id: row.employment_id,
				catalog_id: row.catalog_id,
				occurred_on: row.occurred_on
			}
		];
	});
	const catalogueIds = {
		loan_repayment_entry: [...new Set(admission.map((row) => row.catalog_id))]
	};
	const prefetched = yield* loadEntry(
		ctx.db.query,
		'loan_repayment_entry',
		admission,
		catalogueIds,
		existing.flatMap((row) => (row === undefined ? [] : [row])),
		loans
	).pipe(Effect.catchTag('Refusal', (failure) => ctx.refuse(failure.message)));
	if (prefetched.kind !== 'loan_repayment_entry')
		return yield* ctx.refuse('The repayment schedule requires its loan admission.');
	const { siblings, classes, versions } = prefetched.schedule;
	for (const loan of loans) {
		const edited = inputs.some((input, index) => {
			if (existing[index]?.loan_id !== loan.id) return false;
			if ('$delete' in input) return true;
			return input.amount !== undefined || input.occurred_on !== undefined;
		});
		if (!edited) continue;
		if (loan.principal_amount == null || loan.repayment_period == null)
			return yield* ctx.refuse(
				'Complete the loan principal and repayment period before editing its schedule.'
			);
		const repayments = siblings
			.filter((row) => row.loan_id === loan.id)
			.flatMap((row) => {
				const index = existing.findIndex((existing) => existing?.id === row.id);
				const input = inputs[index];
				if (input !== undefined && '$delete' in input) return [];
				const draft = { ...row, ...input };
				return [
					{
						...draft,
						occurred_on: PlainDate(draft.occurred_on),
						amount: loanAmount(draft.amount)
					}
				];
			});
		const calendar = loanCalendar(
			versions.find(
				(version) => version.id === classes.find((row) => row.id === loan.catalog_id)?.settings_id
			)?.payroll
		);
		if (calendar === null)
			return yield* ctx.refuse(
				'The loan class’s jurisdiction version states no currency or semi-monthly split.'
			);
		const checked = validateLoanRepayments({
			principal_amount: loan.principal_amount,
			repayment_period: loan.repayment_period,
			repayments,
			...calendar
		});
		if (!checked.ok) return yield* ctx.refuse(checked.message);
	}
	const values = inputs.map((input, index) => {
		const parent = loans.find((loan) => loan.id === existing[index]?.loan_id);
		return {
			...entryRow({ ...existing[index], ...input }),
			facts: parent == null ? {} : loanRuleFacts(parent)
		};
	});
	return yield* transformEntries(
		'loan_repayment_entry',
		inputs,
		existing,
		ctx,
		catalogueIds,
		values,
		prefetched
	);
});

export default model('loan_repayment_entry', {
	description: 'One generated repayment of a principal loan, consumed and locked by one payslip.',
	icon: 'lucide:landmark',
	label: 'occurred_on',
	fields: {
		occurred_on: { kind: 'date' },
		amount: { kind: 'decimal', scale: 2 },
		activity: { kind: 'enum', values: ['AWARD', 'REVERSAL'], default: 'AWARD' },
		sequence: { kind: 'int', min: 1, optional: true },
		loan_id: {
			kind: 'ref',
			to: 'loan_catalog_entry',
			inverse: 'repayments',
			owned: true
		},
		catalog_id: { kind: 'ref', to: 'loan_catalog', inverse: 'repayments' },
		company_id: { kind: 'ref', to: 'entity', inverse: 'loan_repayment_entry' },
		employment_id: {
			kind: 'ref',
			to: 'employment_contract',
			inverse: 'loan_repayment_entry'
		},
		payslip_id: {
			kind: 'ref',
			to: 'payslip',
			inverse: 'loan_repayment_entry',
			optional: true,
			onDelete: 'setNull'
		}
	},
	check: { positive_repayment: { amount: { gt: 0 } } },
	locked: { payslip_id: { isNull: false } },
	read: 'all',
	update: {
		columns: { loan_repayment_entry: ['occurred_on', 'amount', 'payslip_id'] },
		transform: function* (changes, ctx) {
			const transformed = yield* transformRows(
				changes.map(({ set }) => set),
				changes.map(({ before }) => before),
				ctx
			);
			return changes.map(({ set: original }, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...original, ...set };
			});
		}
	}
});
