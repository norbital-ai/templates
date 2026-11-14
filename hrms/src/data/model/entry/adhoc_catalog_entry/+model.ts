import { model } from '@norbital-ai/bolt';
import { amendmentsFor } from '../../../../lib/amendments.js';
import { entryCreate, entryDelete, entryUpdate } from '../../../../lib/entries.js';
import { tap } from '../../../../lib/payroll_engine/taps.js';

export default model('adhoc_catalog_entry', {
	description: 'One ad-hoc payment or deduction for an employment.',
	record_label:
		"record.employment_id.employee_number + ' · ' + record.catalog_code + ' · ' + string(record.quantity)",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employment', inverse: 'adhoc_catalog_entry' },
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
		fields: [
			'entity_id',
			'employment_id',
			'catalog_code',
			'description',
			'quantity',
			'unit',
			'incurred_on',
			'evidence_file'
		],
		transform: function* (changes, ctx) {
			return yield* entryCreate(ctx, 'adhoc_catalog_entry', changes, (touched) =>
				amendmentsFor(ctx.query, touched)
			);
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
		fields: ['payroll_run_id', 'description', 'quantity', 'unit', 'incurred_on', 'evidence_file'],
		transform: function* (changes, ctx) {
			return yield* entryUpdate(ctx, 'adhoc_catalog_entry', changes, (touched) =>
				amendmentsFor(ctx.query, touched)
			);
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'adhoc_catalog_entry', changes);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			return yield* entryDelete(ctx, 'adhoc_catalog_entry', changes, (touched) =>
				amendmentsFor(ctx.query, touched)
			);
		}
	}
});
