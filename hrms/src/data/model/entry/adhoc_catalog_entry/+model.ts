import { Effect } from 'effect';
import { model } from '../../../../../.norbital/models/adhoc_catalog_entry.ts';
import { amendmentsFor } from '../../../../lib/amendments.js';
import { entriesUndone, entryPostings, entryRead } from '../../../../lib/ledger/service.js';
import { jsonObject } from '../../../../lib/payroll_engine/foundation.js';
import { tap } from '../../../../lib/payroll_engine/taps.js';

/** The days an entry prices: a paid period holding one is worked out again by the next run. */
const touched = (
	rows: readonly {
		readonly employment_id: string;
		readonly incurred_on: string;
		readonly payroll_run_id?: string | null | undefined;
	}[]
) =>
	rows.map((row) => ({
		employment: String(row.employment_id),
		from: String(row.incurred_on),
		run: row.payroll_run_id ?? null
	}));

export default model({
	description: 'One ad-hoc payment or deduction for an employment.',
	record_label:
		"record.employment_id.employee_number + ' · ' + record.catalog_code + ' · ' + string(record.quantity)",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'adhoc_catalog_entry' },
		catalog_code: { kind: 'text' },
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			inverse: 'adhoc',
			optional: true,
			on_delete: 'set_null'
		},
		description: { kind: 'text' },
		quantity: { kind: 'decimal', scale: 12, min: 0 },
		unit: {
			kind: 'enum',
			values: ['DAY', 'CALENDAR_DAY', 'HOUR', 'MONEY', 'COUNT'],
			default: 'MONEY'
		},
		incurred_on: { kind: 'date' },
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
			employment_id: { fields: 'all', employee_id: { fields: ['name'] } },
			payroll_run_id: { fields: 'all' }
		}
	},
	create: {
		columns: {
			fields: [
				'entity_id',
				'employment_id',
				'catalog_code',
				'description',
				'quantity',
				'unit',
				'incurred_on',
				'evidence_file'
			]
		},
		transform: function* (changes, ctx) {
			const rows = changes.map((c) => c.after);
			const entries = rows.map((row) => jsonObject(row));
			// the approving decision asks again only for what the entry posts: what it checked stands
			const known = yield* entryRead(
				ctx.query,
				'adhoc_catalog_entry',
				entries,
				ctx.approving ? undefined : 'create'
			);
			return {
				sets: changes.map((c) => c.set),
				on_approved: {
					...(yield* entryPostings(known, 'adhoc_catalog_entry', entries)),
					...(yield* amendmentsFor(ctx.query, touched(rows)))
				}
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'adhoc_catalog_entry',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		columns: {
			fields: ['payroll_run_id', 'description', 'quantity', 'unit', 'incurred_on', 'evidence_file']
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
			const known = yield* entryRead(
				ctx.query,
				'adhoc_catalog_entry',
				proposed,
				ctx.approving ? undefined : 'update'
			);
			return {
				// a date that moves leaves the run that priced it: the period it joins prices it, and seals it
				sets: changes.map((c) =>
					c.before.payroll_run_id != null && c.changed('incurred_on')
						? { ...c.set, payroll_run_id: null }
						: c.set
				),
				on_approved: {
					...(yield* entryPostings(known, 'adhoc_catalog_entry', proposed)),
					// a date that moves touches the period it left and the period it joined
					...(yield* amendmentsFor(ctx.query, [
						...touched(changes.map((c) => c.before)),
						...touched(changes.map((c) => c.after))
					]))
				}
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'adhoc_catalog_entry', changes);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const entries = changes.map((change) => jsonObject(change.before));
			const known = yield* entryRead(
				ctx.query,
				'adhoc_catalog_entry',
				entries,
				ctx.approving ? undefined : 'delete'
			).pipe(
				Effect.catchTag('Refusal', (error) =>
					ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
				)
			);
			return {
				on_approved: {
					...entriesUndone(known, 'adhoc_catalog_entry', entries),
					...(yield* amendmentsFor(ctx.query, touched(changes.map((change) => change.before))))
				}
			};
		}
	}
});
