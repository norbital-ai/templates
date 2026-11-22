import { Effect } from 'effect';
import { model } from '@norbital-ai/bolt';
import { sealOnly } from '../service/entries.js';
import { amendmentsFor, refusing } from '../../payroll_run/service/amendments.js';
import { refuseIneligible, validateRegistered } from '../../jurisdiction/service/registrations.js';
import { jsonObject } from '../../../../lib/foundation.js';
import type { Id, WriteCtx } from '@norbital-ai/bolt';
import { tap } from '../../jurisdiction/service/taps.js';

/** The amendment rows of the paid periods these loans' dated instalments fall in. */
const instalmentAmendments = Effect.fnUntraced(function* (
	read: WriteCtx<'loan_catalog_entry'>['query'],
	loans: readonly Id<'loan_catalog_entry'>[]
) {
	if (loans.length === 0) return yield* amendmentsFor(read, []);
	const { loan_catalog_entry_repayment: instalments } = yield* read({
		loan_catalog_entry_repayment: {
			where: { loan_id: { in: loans } },
			fields: ['employment_id', 'paid_on', 'payroll_run_id'],
			limit: 10000
		}
	});
	return yield* amendmentsFor(
		read,
		instalments.rows.flatMap((row) =>
			row.paid_on == null
				? []
				: [
						{
							employment: row.employment_id,
							from: row.paid_on,
							run: row.payroll_run_id ?? null
						}
					]
		)
	);
});

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
		// the payroll run's named read: this model through the stint a run finds it by
		run: {
			fields: 'all',
			repayments: { fields: ['id', 'entity_id', 'payroll_run_id', 'paid_on'] }
		},
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
			'catalog_code',
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
			// the loan's catalogue row says where each instalment lands on a payslip: another row amends every period
			// that took one
			const moved = changes.filter((c) => c.changed('catalog_code')).map((c) => c.before.id);
			// a loan moved to another stint or company (a transfer) takes the instalments no run has taken, in this same
			// write: a repayment stands where its loan does; one a run took keeps the stint and company that paid it
			const relocated = changes.filter((c) => c.changed('employment_id') || c.changed('entity_id'));
			const open =
				relocated.length === 0
					? []
					: (yield* ctx.query({
							loan_catalog_entry_repayment: {
								where: {
									loan_id: { in: relocated.map((c) => c.before.id) },
									payroll_run_id: { is_null: true }
								},
								fields: ['id', 'revision', 'loan_id'],
								limit: 10000
							}
						})).loan_catalog_entry_repayment.rows;
			const follow = open.flatMap((row) => {
				const loan = relocated.find((c) => c.before.id === row.loan_id)?.after;
				return loan === undefined
					? []
					: [
							{
								target: { id: row.id, revision: row.revision },
								set: { entity_id: loan.entity_id, employment_id: loan.employment_id }
							}
						];
			});
			return {
				sets: changes.map((c) => c.set),
				...(follow.length === 0
					? {}
					: { with: { loan_catalog_entry_repayment: { update: follow } } }),
				on_approved: yield* instalmentAmendments(ctx.query, moved).pipe(refusing(ctx))
			};
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
			// a loan goes with its instalments: each period that took one is worked out again without it
			return {
				on_approved: yield* instalmentAmendments(
					ctx.query,
					changes.map((change) => change.before.id)
				).pipe(refusing(ctx))
			};
		}
	}
});
