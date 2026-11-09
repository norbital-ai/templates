import { model } from '@norbital-ai/bolt';
import { validateRegistered } from '../../../../../../../lib/payroll_engine/registrations.js';
import { jsonObject, numberOf } from '../../../../../../../lib/payroll_engine/foundation.js';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';

export default model('loan_catalog_entry', {
	description: 'One employee loan advance and its repayment period.',
	record_label:
		"record.employment_id.employee_number + ' · ' + string(record.recovered) + ' recovered'",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'loan_catalog_entry' },
		catalog_id: { kind: 'ref', to: 'loan_catalog', onDelete: 'restrict' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'setNull' },
		quantity: { kind: 'decimal', scale: 12, min: 0 },
		recovered: {
			kind: 'sum',
			of: 'repayments.amount',
			where: { reverses: { isNull: true } },
			hidden: true
		},
		repayment_period: { kind: 'period', of: 'date' },
		evidence_file: {
			kind: 'file',
			accept: ['application/pdf', 'image/*'],
			max: '20MiB',
			optional: true
		}
	},
	read: {
		loan_catalog_entry: { fields: 'all' },
		'loan_catalog_entry.employment_id': { fields: 'all' },
		'loan_catalog_entry.catalog_id': { fields: 'all' },
		'loan_catalog_entry.payroll_run_id': { fields: 'all' }
	},
	create: {
		columns: {
			loan_catalog_entry: [
				'entity_id',
				'employment_id',
				'catalog_id',
				'quantity',
				'repayment_period',
				'evidence_file'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'loan_catalog_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			return rows;
		}
	},
	update: {
		columns: {
			loan_catalog_entry: [
				'payroll_run_id',
				'quantity',
				'repayment_period',
				'evidence_file',
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
			yield* validateRegistered(ctx.db.query, 'loan_catalog_entry', 'update', proposed);
			const sealed = yield* ctx.db.query({
				loan_catalog_entry_repayment: {
					where: { loan_id: { in: changes.map((c) => c.before.id) } },
					fields: ['loan_id', 'amount', 'payroll_run_id'],
					limit: 10000
				}
			});
			for (const change of changes) {
				const paid = (sealed.loan_catalog_entry_repayment.rows ?? [])
					.filter((row) => row.loan_id === change.before.id && row.payroll_run_id != null)
					.reduce((total, row) => total + (numberOf(row.amount) ?? 0), 0);
				const principal = numberOf(change.set.quantity ?? change.before.quantity) ?? 0;
				if (principal < paid)
					return yield* ctx.refuse(
						'The principal cannot be less than repayments already included in payroll.'
					);
			}
			return changes.map((c) => c.set);
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'loan_catalog_entry',
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
				{ collection: 'loan_catalog_entry', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'loan_catalog_entry', ids: changes.map((change) => change.after.id) },
				changes
			);
		}
	}
});
