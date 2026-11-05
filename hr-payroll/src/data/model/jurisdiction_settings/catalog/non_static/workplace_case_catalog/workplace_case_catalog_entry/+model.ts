import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';
import { jsonObject } from '../../../../../../../lib/payroll_engine/foundation.js';
import { validateRegistered } from '../../../../../../../lib/payroll_engine/registrations.js';

export default model('workplace_case_catalog_entry', {
	description:
		'Employer-scoped source data for one declared case variant, validated before acceptance and protected when captured by payroll.',
	label: 'kind',
	fields: {
		catalog_id: {
			kind: 'ref',
			to: 'workplace_case_catalog',
			inverse: 'entries',
			onDelete: 'restrict'
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'workplace_case_catalog_entries' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'setNull' },
		kind: { kind: 'text' },
		opened_on: { kind: 'date' },
		scheduled_on: { kind: 'date', optional: true },
		closed_on: { kind: 'date', optional: true },
		inputs: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
		evidence_file: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			optional: true,
			label: 'Document'
		}
	},
	locked: { payroll_run_id: { isNull: false } },
	read: {
		workplace_case_catalog_entry: { fields: 'all' },
		'workplace_case_catalog_entry.catalog_id': { fields: 'all' },
		'workplace_case_catalog_entry.payroll_run_id': { fields: 'all' }
	},
	create: {
		columns: {
			workplace_case_catalog_entry: [
				'catalog_id',
				'entity_id',
				'kind',
				'opened_on',
				'scheduled_on',
				'closed_on',
				'inputs',
				'evidence_file'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'workplace_case_catalog_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			return rows;
		}
	},
	update: {
		transform: function* (changes, ctx) {
			if (
				changes.every(
					(change) =>
						Object.keys(change.set).length === 1 && Object.hasOwn(change.set, 'payroll_run_id')
				)
			)
				return changes.map((change) => change.set);
			yield* validateRegistered(
				ctx.db.query,
				'workplace_case_catalog_entry',
				'update',
				changes.map((change) => jsonObject({ ...change.before, ...change.set }))
			);
			return changes.map((change) => change.set);
		},
		columns: {
			workplace_case_catalog_entry: [
				'payroll_run_id',
				'catalog_id',
				'entity_id',
				'kind',
				'opened_on',
				'scheduled_on',
				'closed_on',
				'inputs',
				'evidence_file'
			]
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'workplace_case_catalog_entry', ids: rows.map((r) => r.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'workplace_case_catalog_entry', ids: changes.map((c) => c.after.id) },
				changes
			);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				{ collection: 'workplace_case_catalog_entry', ids: rows.map((r) => r.id) },
				rows.map((before) => ({ before }))
			);
		}
	}
});
