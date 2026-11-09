import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../lib/payroll_engine/taps.js';

export default model('work_event', {
	description:
		'One dated real-world event affecting work: a heat period, natural disaster, epidemic or other condition. It may be entity-wide or attached to one employment, and catalog rules read its type and dates.',
	label: 'description',
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employee_contract', optional: true },
		catalog_id: { kind: 'ref', to: 'work_event_catalog', onDelete: 'restrict' },
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
	read: {
		work_event: { fields: 'all' },
		'work_event.catalog_id': { fields: ['code'] },
		'work_event.entity_id': { fields: 'all' },
		'work_event.employment_id': { fields: 'all' }
	},
	create: {
		columns: {
			work_event: [
				'entity_id',
				'employment_id',
				'catalog_id',
				'from',
				'to',
				'location',
				'description',
				'evidence_file'
			]
		}
	},
	update: {
		columns: {
			work_event: [
				'employment_id',
				'catalog_id',
				'from',
				'to',
				'location',
				'description',
				'evidence_file'
			]
		}
	},
	delete: {},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'work_event', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'work_event', ids: changes.map((change) => change.after.id) },
				changes
			);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				{ collection: 'work_event', ids: rows.map((row) => row.id) },
				rows.map((before) => ({ before }))
			);
		}
	}
});
