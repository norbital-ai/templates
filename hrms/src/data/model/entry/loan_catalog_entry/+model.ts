import { model } from '@norbital-ai/bolt';
import { sealOnly } from '../../../../lib/entries.js';
import { refusing } from '../../../../lib/amendments.js';
import {
	refuseIneligible,
	validateRegistered
} from '../../../../lib/payroll_engine/registrations.js';
import { jsonObject, numberOf } from '../../../../lib/payroll_engine/foundation.js';
import { tap } from '../../../../lib/payroll_engine/taps.js';

export default model('loan_catalog_entry', {
	description: 'One employee loan advance and its repayment period.',
	record_label: "record.employment_id.employee_number + ' · ' + record.catalog_code",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employment', inverse: 'loan_catalog_entry' },
		catalog_code: { kind: 'text' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, on_delete: 'set_null' },
		quantity: { kind: 'decimal', scale: 12, min: 0 },
		recovered: {
			kind: 'sum',
			of: 'repayments.amount',
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
	outputs: {
		default: {
			fields: 'all',
			employment_id: { fields: 'all' },
			payroll_run_id: { fields: 'all' }
		}
	},
	create: {
		fields: [
			'entity_id',
			'employment_id',
			'catalog_code',
			'quantity',
			'repayment_period',
			'evidence_file'
		],
		// a loan arrives with its schedule: one write, so none is left without instalments
		repayments: {
			fields: ['entity_id', 'employment_id', 'amount', 'paid_on', 'payment_reference']
		},
		transform: function* (changes, ctx) {
			const rows = changes.map((c) => jsonObject(c.after));
			yield* validateRegistered(ctx.query, 'loan_catalog_entry', 'create', rows);
			yield* refuseIneligible(ctx.query, 'loan_catalog_entry', rows);
			return changes.map((c) => c.set);
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'loan_catalog_entry',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		fields: [
			'payroll_run_id',
			'quantity',
			'repayment_period',
			'evidence_file',
			'entity_id',
			'employment_id'
		],
		transform: function* (changes, ctx) {
			if (sealOnly(changes)) return changes.map((change) => change.set);
			const proposed = changes.map((change) => jsonObject(change.after));
			yield* validateRegistered(ctx.query, 'loan_catalog_entry', 'update', proposed);
			yield* refuseIneligible(ctx.query, 'loan_catalog_entry', proposed);
			const sealed = yield* ctx.query({
				loan_catalog_entry_repayment: {
					where: { loan_id: { in: changes.map((c) => c.before.id) } },
					fields: ['loan_id', 'amount', 'payroll_run_id'],
					limit: 10000
				}
			});
			for (const [index, change] of changes.entries()) {
				const paid = (sealed.loan_catalog_entry_repayment.rows ?? [])
					.filter((row) => row.loan_id === change.before.id && row.payroll_run_id != null)
					.reduce((total, row) => total + (numberOf(row.amount) ?? 0), 0);
				const principal = numberOf(change.after.quantity) ?? 0;
				if (principal < paid)
					return yield* ctx.refuse('errors.loan_principal_below_repaid', {
						row: index,
						field: 'quantity'
					});
			}
			return changes.map((c) => c.set);
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'loan_catalog_entry', changes);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			yield* validateRegistered(
				ctx.query,
				'loan_catalog_entry',
				'delete',
				changes.map((change) => jsonObject(change.before))
			).pipe(refusing(ctx));
			const paid = changes.findIndex((change) => change.before.payroll_run_id != null);
			if (paid >= 0) return yield* ctx.refuse('errors.loan_paid_no_delete', { row: paid });
		}
	}
});
