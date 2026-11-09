import { model } from '@norbital-ai/bolt';
import { validateRegistered } from '../../../../../../../../lib/payroll_engine/registrations.js';
import { jsonObject } from '../../../../../../../../lib/payroll_engine/foundation.js';
import { tap } from '../../../../../../../../lib/payroll_engine/taps.js';
import { assertUnpriced } from '../../../../../../../../lib/payroll_engine/pay_cycle.js';

const NEXT = 'Date the instalment in the next period to run.';
/** An instalment is deducted by the run whose attendance holds its date; a reversal is paid by the next run. */
const instalments = (
	rows: readonly { employment_id: string; paid_on?: string | null; reverses?: string | null }[]
) =>
	rows.flatMap(({ employment_id, paid_on, reverses }) =>
		paid_on == null || reverses != null ? [] : [{ employment: employment_id, date: paid_on }]
	);

export default model('loan_catalog_entry_repayment', {
	description: 'One repayment against a loan entry.',
	label: 'payment_reference',
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: {
			kind: 'ref',
			to: 'employee_contract',
			inverse: 'loan_catalog_entry_repayment'
		},
		loan_id: {
			kind: 'ref',
			to: 'loan_catalog_entry',
			inverse: 'repayments',
			onDelete: 'restrict'
		},
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'setNull' },
		amount: { kind: 'decimal', scale: 12, min: 0 },
		paid_on: { kind: 'date', optional: true },
		payment_reference: { kind: 'text', optional: true },
		reverses: {
			kind: 'ref',
			to: 'loan_catalog_entry_repayment',
			optional: true,
			onDelete: 'restrict'
		}
	},
	unique: [{ fields: ['reverses'] }],
	locked: { payroll_run_id: { isNull: false } },
	read: {
		loan_catalog_entry_repayment: { fields: 'all' },
		'loan_catalog_entry_repayment.employment_id': { fields: 'all' },
		'loan_catalog_entry_repayment.loan_id': { fields: 'all' },
		'loan_catalog_entry_repayment.payroll_run_id': { fields: 'all' }
	},
	create: {
		columns: {
			loan_catalog_entry_repayment: [
				'entity_id',
				'employment_id',
				'loan_id',
				'amount',
				'paid_on',
				'payment_reference',
				'reverses'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'loan_catalog_entry_repayment',
				'create',
				rows.map((row) => jsonObject(row))
			);
			yield* assertUnpriced(ctx.db.query, instalments(rows), NEXT);
			return rows;
		}
	},
	update: {
		columns: {
			loan_catalog_entry_repayment: [
				'payroll_run_id',
				'amount',
				'paid_on',
				'payment_reference',
				'entity_id',
				'employment_id'
			]
		},
		transform: function* (changes, ctx) {
			if (
				changes.every(
					(change) =>
						Object.keys(change.set).length === 1 && Object.hasOwn(change.set, 'payroll_run_id')
				)
			)
				return changes.map((change) => change.set);
			const proposed = changes.map((change) => jsonObject({ ...change.before, ...change.set }));
			yield* validateRegistered(ctx.db.query, 'loan_catalog_entry_repayment', 'update', proposed);
			if (changes.some((c) => c.before.payroll_run_id != null))
				return yield* ctx.refuse('This record is locked by a payroll run.');
			yield* assertUnpriced(
				ctx.db.query,
				instalments(changes.map(({ before, set }) => ({ ...before, ...set }))),
				NEXT
			);
			return changes.map((c) => c.set);
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'loan_catalog_entry_repayment',
				'delete',
				rows.map((row) => jsonObject(row))
			);
			if (rows.some((r) => r.payroll_run_id != null))
				return yield* ctx.refuse('This record is locked by a payroll run.');
		}
	},

	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'loan_catalog_entry_repayment', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{
					collection: 'loan_catalog_entry_repayment',
					ids: changes.map((change) => change.after.id)
				},
				changes
			);
		}
	}
});
