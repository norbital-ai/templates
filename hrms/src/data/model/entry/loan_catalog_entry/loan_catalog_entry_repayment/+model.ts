import { Effect } from 'effect';
import { model } from '../../../../../../.norbital/models/loan_catalog_entry_repayment.ts';
import { validateRegistered } from '../../../../../lib/payroll_engine/registrations.js';
import { jsonObject } from '../../../../../lib/payroll_engine/foundation.js';
import { tap } from '../../../../../lib/payroll_engine/taps.js';
import { amendmentsFor } from '../../../../../lib/amendments.js';

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
			: [{ employment: String(employment_id), from: String(paid_on), run: payroll_run_id ?? null }]
	);

export default model({
	description: 'One repayment against a loan entry.',
	record_label:
		"record.employment_id.employee_number + ' · ' + string(record.amount) + (record.paid_on != null ? ' · ' + string(record.paid_on) : '')",
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
			on_delete: 'restrict'
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
		columns: {
			fields: ['entity_id', 'employment_id', 'loan_id', 'amount', 'paid_on', 'payment_reference']
		},
		transform: function* (changes, ctx) {
			const rows = changes.map((c) => c.after);
			yield* validateRegistered(
				ctx.query,
				'loan_catalog_entry_repayment',
				'create',
				rows.map((row) => jsonObject(row))
			);
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
		columns: {
			fields: [
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
			const proposed = changes.map((change) => jsonObject(change.after));
			yield* validateRegistered(ctx.query, 'loan_catalog_entry_repayment', 'update', proposed);
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
			).pipe(
				Effect.catchTag('Refusal', (error) =>
					ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
				)
			);
			return { on_approved: yield* amendmentsFor(ctx.query, touched(rows)) };
		}
	}
});
