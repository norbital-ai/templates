import { model } from '@norbital-ai/bolt';
import { validateRegistered } from '../../../../../../../../lib/payroll_engine/registrations.js';
import { jsonObject } from '../../../../../../../../lib/payroll_engine/foundation.js';
import { tap } from '../../../../../../../../lib/payroll_engine/taps.js';

export default model('loan_repayment_entry', {
	description: 'One repayment against a loan entry.',
	label: 'payment_reference',
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'loan_repayment_entry' },
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
		reverses: { kind: 'ref', to: 'loan_repayment_entry', optional: true, onDelete: 'restrict' }
	},
	unique: [{ fields: ['reverses'] }],
	locked: { payroll_run_id: { isNull: false } },
	read: {
		loan_repayment_entry: { fields: 'all' },
		'loan_repayment_entry.employment_id': { fields: 'all' },
		'loan_repayment_entry.loan_id': { fields: 'all' },
		'loan_repayment_entry.payroll_run_id': { fields: 'all' }
	},
	create: {
		columns: {
			loan_repayment_entry: [
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
				'loan_repayment_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			return rows;
		}
	},
	update: {
		columns: {
			loan_repayment_entry: [
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
			yield* validateRegistered(ctx.db.query, 'loan_repayment_entry', 'update', proposed);
			if (changes.some((c) => c.before.payroll_run_id != null))
				return yield* ctx.refuse('This record is locked by a payroll run.');
			return changes.map((c) => c.set);
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'loan_repayment_entry',
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
				{ collection: 'loan_repayment_entry', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'loan_repayment_entry', ids: changes.map((change) => change.after.id) },
				changes
			);
		}
	}
});
