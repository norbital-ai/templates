import { model } from '../../../../../.norbital/models/claim_catalog_entry.ts';
import { amendmentsFor } from '../../../../lib/amendments.js';
import { entryCreate, entryDelete, entryUpdate } from '../../../../lib/entries.js';

export default model({
	description: 'One claim against an employment.',
	record_label:
		"record.employment_id.employee_number + ' · ' + record.catalog_code + ' · ' + string(record.quantity) + (record.unit == 'MONEY' ? '' : ' ' + record.unit)",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employment', inverse: 'claim_catalog_entry' },
		catalog_code: { kind: 'text' },
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			inverse: 'claim',
			optional: true,
			on_delete: 'set_null'
		},
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
			employment_id: { fields: 'all' },
			payroll_run_id: { fields: 'all' }
		}
	},
	create: {
		columns: {
			fields: [
				'entity_id',
				'employment_id',
				'catalog_code',
				'quantity',
				'incurred_on',
				'evidence_file'
			]
		},
		transform: function* (changes, ctx) {
			return yield* entryCreate(ctx, 'claim_catalog_entry', changes, (touched) =>
				amendmentsFor(ctx.query, touched)
			);
		}
	},
	update: {
		columns: {
			fields: ['payroll_run_id', 'quantity', 'incurred_on', 'evidence_file']
		},
		transform: function* (changes, ctx) {
			return yield* entryUpdate(ctx, 'claim_catalog_entry', changes, (touched) =>
				amendmentsFor(ctx.query, touched)
			);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			return yield* entryDelete(ctx, 'claim_catalog_entry', changes, (touched) =>
				amendmentsFor(ctx.query, touched)
			);
		}
	}
});
