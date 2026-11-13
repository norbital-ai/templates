import { model } from '../../../../../.norbital/models/work_event.ts';
import { tap } from '../../../../lib/payroll_engine/taps.js';
import { amendmentsFor, amendmentsOf } from '../../../../lib/amendments.js';
import type { Reader } from '../../../../lib/payroll_engine/reads.js';
import { Effect } from 'effect';

type Dated = {
	readonly entity_id: string;
	readonly employment_id?: string | null | undefined;
	readonly from: string;
	readonly to?: string | null | undefined;
};
/** The days an event covers: catalogue rules price them, so a paid period holding one is worked out again. */
const amended = Effect.fnUntraced(function* (read: Reader, rows: readonly Dated[]) {
	const span = (row: Dated) => ({
		from: String(row.from),
		to: row.to == null ? null : String(row.to)
	});
	const own = rows.filter((row) => row.employment_id != null);
	const wide = rows.filter((row) => row.employment_id == null);
	return {
		...(yield* amendmentsOf(
			read,
			[...new Set(wide.map((row) => String(row.entity_id)))],
			wide.map(span)
		)),
		...(yield* amendmentsFor(
			read,
			own.map((row) => ({ employment: String(row.employment_id), ...span(row) }))
		))
	};
});

export default model({
	description:
		'One dated real-world event affecting work: a heat period, natural disaster, epidemic or other condition. It may be entity-wide or attached to one employment, and catalog rules read its type and dates.',
	record_label: 'record.description',
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employee_contract', optional: true },
		catalog_code: { kind: 'text' },
		from: { kind: 'date' },
		to: { kind: 'date', optional: true },
		location: { kind: 'text', optional: true },
		description: { kind: 'text', optional: true },
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
			entity_id: { fields: 'all' },
			employment_id: { fields: 'all' }
		}
	},
	create: {
		columns: {
			fields: [
				'entity_id',
				'employment_id',
				'catalog_code',
				'from',
				'to',
				'location',
				'description',
				'evidence_file'
			]
		},
		transform: function* (changes, ctx) {
			const rows = changes.map(({ set }) => set);
			return { sets: rows, on_approved: yield* amended(ctx.query, rows) };
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'work_event',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		columns: {
			fields: [
				'employment_id',
				'catalog_code',
				'from',
				'to',
				'location',
				'description',
				'evidence_file'
			]
		},
		transform: function* (changes, ctx) {
			return {
				sets: changes.map((change) => change.set),
				on_approved: yield* amended(ctx.query, [
					...changes.map((change) => change.before),
					...changes.map((change) => change.after)
				])
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'work_event', changes);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			return {
				on_approved: yield* amended(
					ctx.query,
					changes.map(({ before }) => before)
				)
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'delete',
				'work_event',
				changes.map(({ before }) => ({ before }))
			);
		}
	}
});
