import { model } from '@norbital-ai/bolt';
import { sealOnly } from '../../service/entries.js';
import { validateRegistered } from '../../../jurisdiction/service/registrations.js';
import { jsonObject } from '../../../../../lib/foundation.js';
import { tap } from '../../../jurisdiction/service/taps.js';
import { repaymentProblem } from '../service/loan_schedule.js';
import type { Id, WriteCtx } from '@norbital-ai/bolt';
import { amendmentsFor, refusing } from '../../../payroll_run/service/amendments.js';

/** An instalment is deducted by the run whose attendance holds its date: a paid period holding it is worked out again. */
const touched = (
	rows: readonly {
		readonly employment_id: string;
		readonly paid_on?: string | null | undefined;
		readonly payroll_run_id?: string | null | undefined;
	}[]
) =>
	rows.flatMap(({ employment_id, paid_on, payroll_run_id }) =>
		paid_on == null
			? []
			: [
					{
						employment: employment_id,
						from: paid_on,
						run: payroll_run_id ?? null,
						attendance: true
					}
				]
	);

type Repayment = {
	readonly loan_id: Id<'loan_catalog_entry'>;
	readonly employment_id: unknown;
	readonly entity_id: unknown;
};
/** Each repayment against its loan as this act leaves it: a loan moved in the same act is read where it now stands. */
const assertOfLoan = function* (
	ctx: WriteCtx<'loan_catalog_entry_repayment'>,
	rows: readonly Repayment[]
) {
	const { loan_catalog_entry: loans } = yield* ctx.query({
		loan_catalog_entry: {
			where: { id: { in: rows.map((row) => row.loan_id) } },
			fields: ['employment_id', 'entity_id'],
			as_of: 'act',
			limit: 10000
		}
	});
	for (const [index, row] of rows.entries()) {
		const problem = repaymentProblem(
			row,
			loans.rows.find((loan) => loan.id === row.loan_id)
		);
		if (problem !== undefined)
			return yield* ctx.refuse('errors.payroll_refused', {
				row: index,
				values: { message: problem }
			});
	}
};

export default model('loan_catalog_entry_repayment', {
	description: 'One repayment against a loan entry.',
	record_label:
		"record.employment_id.employee_number + ' · ' + string(record.amount) + (record.paid_on != null ? ' · ' + string(record.paid_on) : '')",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: {
			kind: 'ref',
			to: 'employment',
			inverse: 'loan_catalog_entry_repayment'
		},
		loan_id: {
			kind: 'ref',
			to: 'loan_catalog_entry',
			inverse: 'repayments',
			// a loan deleted takes its instalments: its own delete carries their amendment rows
			on_delete: 'cascade'
		},
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			inverse: 'repayment',
			optional: true,
			on_delete: 'set_null'
		},
		amount: { kind: 'decimal', scale: 12, min: 0 },
		paid_on: { kind: 'date', optional: true },
		payment_reference: { kind: 'text', optional: true }
	},
	outputs: {
		default: {
			fields: 'all',
			employment_id: { fields: 'all' },
			loan_id: { fields: 'all' },
			payroll_run_id: { fields: 'all' }
		}
	},
	create: {
		fields: ['entity_id', 'employment_id', 'loan_id', 'amount', 'paid_on', 'payment_reference'],
		transform: function* (changes, ctx) {
			const rows = changes.map((c) => c.after);
			yield* validateRegistered(
				ctx.query,
				'loan_catalog_entry_repayment',
				'create',
				rows.map((row) => jsonObject(row))
			);
			yield* assertOfLoan(ctx, rows);
			return {
				sets: changes.map((c) => c.set),
				on_approved: yield* amendmentsFor(ctx.query, touched(rows))
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'loan_catalog_entry_repayment',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		fields: [
			'payroll_run_id',
			'amount',
			'paid_on',
			'payment_reference',
			'entity_id',
			'employment_id'
		],
		transform: function* (changes, ctx) {
			if (sealOnly(changes)) return changes.map((change) => change.set);
			const proposed = changes.map((change) => jsonObject(change.after));
			yield* validateRegistered(ctx.query, 'loan_catalog_entry_repayment', 'update', proposed);
			yield* assertOfLoan(
				ctx,
				changes.map((change) => change.after)
			);
			return {
				// a date that moves leaves the run that priced it: the period it joins prices it, and seals it
				sets: changes.map((c) =>
					c.before.payroll_run_id != null && c.changed('paid_on')
						? { ...c.set, payroll_run_id: null }
						: c.set
				),
				on_approved: yield* amendmentsFor(ctx.query, [
					...touched(changes.map((c) => c.before)),
					...touched(changes.map((c) => c.after))
				])
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'loan_catalog_entry_repayment', changes);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const rows = changes.map((change) => change.before);
			yield* validateRegistered(
				ctx.query,
				'loan_catalog_entry_repayment',
				'delete',
				rows.map((row) => jsonObject(row))
			).pipe(refusing(ctx));
			return { on_approved: yield* amendmentsFor(ctx.query, touched(rows)) };
		}
	}
});
