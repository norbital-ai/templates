import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';

export default model('work_interruption_catalog_entry', {
	description:
		'An evidenced entity-wide calendar interruption of one declared catalogue variant. Work rules own attendance and pay treatment.',
	label: 'reason',
	fields: {
		catalog_id: {
			kind: 'ref',
			to: 'work_interruption_catalog',
			inverse: 'entries',
			onDelete: 'restrict'
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'work_interruptions' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'setNull' },
		period: { kind: 'period', of: 'date' },
		worksite: { kind: 'text', optional: true },
		evidence_file: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			optional: true,
			label: 'Document'
		},
		reason: { kind: 'text', optional: true }
	},
	locked: { payroll_run_id: { isNull: false } },
	read: {
		work_interruption_catalog_entry: { fields: 'all' },
		'work_interruption_catalog_entry.catalog_id': { fields: 'all' },
		'work_interruption_catalog_entry.payroll_run_id': { fields: 'all' }
	},
	create: {
		columns: {
			work_interruption_catalog_entry: [
				'catalog_id',
				'entity_id',
				'period',
				'worksite',
				'evidence_file',
				'reason'
			]
		}
	},
	update: {
		columns: {
			work_interruption_catalog_entry: [
				'payroll_run_id',
				'catalog_id',
				'entity_id',
				'period',
				'worksite',
				'evidence_file',
				'reason'
			]
		}
	},
	effect: {
		created: function* (rows, ctx) {
			// an entry reaches its version's registered effects through the catalog row it was raised on
			const versions = yield* ctx.query({
				work_interruption_catalog: {
					where: { id: { in: rows.map((row) => row.catalog_id) } },
					fields: ['settings_id'],
					limit: 10000
				}
			});
			const settingsOf = new Map(
				versions.work_interruption_catalog.rows.map((row) => [row.id, row.settings_id])
			);
			yield* tap(
				ctx,
				'create',
				{ collection: 'work_interruption_catalog_entry', ids: rows.map((r) => r.id) },
				rows.map((after) => ({
					after: { ...after, settings_id: settingsOf.get(after.catalog_id) }
				}))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'work_interruption_catalog_entry', ids: changes.map((c) => c.after.id) },
				changes
			);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				{ collection: 'work_interruption_catalog_entry', ids: rows.map((r) => r.id) },
				rows.map((before) => ({ before }))
			);
		}
	}
});
