import { tap } from '../../../lib/payroll_engine/taps.js';
import { model } from '@norbital-ai/bolt';

export default model('entity', {
	description:
		'One stable company identity. Sealed, dated employer payroll versions hold every payroll detail and its statutory validation link.',
	icon: 'lucide:building-2',
	label: 'name',
	search: { text: ['code', 'name'] },
	fields: {
		code: {
			kind: 'text',
			optional: true,
			unique: true,
			help: 'The company’s stable business code for imports and cross-references. This is separate from its immutable record ID, name, jurisdiction and dated registration numbers.'
		},
		name: { kind: 'text' },
		settings_code: { kind: 'text' },
		source_reference: { kind: 'text', optional: true, label: 'Source reference' }
	},
	read: {
		entity: { fields: 'all' },
		'entity.payroll_versions': { fields: 'all' },
		'entity.shift_definition': { fields: 'all' },
		'entity.employee_contract': { fields: 'all' },
		'entity.employee_contract.employee_id': { fields: 'all' },
		'entity.employee_contract.leave_catalog_entry': { fields: 'all' }
	},
	outputs: {
		self_service: {
			entity: { fields: ['name', 'settings_code'] },
			'entity.payroll_versions': {
				fields: ['entity_id', 'effective_range', 'status', 'time_zone']
			}
		},
		kiosk: {
			entity: { fields: ['name', 'settings_code'] },
			'entity.employee_contract': {
				fields: ['employee_id', 'entity_id', 'employee_number', 'effective_range']
			},
			'entity.employee_contract.employee_id': {
				fields: [
					'name',
					'email',
					'phone',
					'face_embedding',
					'face_photo',
					'face_enrollment_status',
					'face_enrolled_at',
					'face_match_count',
					'face_last_match_at'
				]
			}
		}
	},
	create: {
		columns: { entity: ['code', 'name', 'settings_code', 'source_reference'] },
		transform: function* (rows, ctx) {
			for (const row of rows)
				if (row.code != null && row.code.trim() === '')
					return yield* ctx.refuse(
						'An entered company code must contain a nonblank business identifier.'
					);
			return rows.map((row) => (row.code == null ? row : { ...row, code: row.code.trim() }));
		}
	},
	update: {
		columns: { entity: ['code', 'name', 'settings_code', 'source_reference'] },
		transform: function* (changes, ctx) {
			for (const { before, set } of changes) {
				if (set.code != null && set.code.trim() === '')
					return yield* ctx.refuse(
						'An entered company code must contain a nonblank business identifier.'
					);
				if (set.settings_code === undefined || set.settings_code === before.settings_code) continue;
				const used = yield* ctx.db.query({
					entity_profile_version: {
						where: { entity_id: { eq: before.id } },
						fields: ['id'],
						limit: 1
					},
					employee_contract: {
						where: { entity_id: { eq: before.id } },
						fields: ['id'],
						limit: 1
					}
				});
				if (used.entity_profile_version.rows.length > 0 || used.employee_contract.rows.length > 0)
					return yield* ctx.refuse(
						'This company has payroll versions or contracts linked to its jurisdiction. Create a separate company for a different jurisdiction.'
					);
			}
			return changes.map(({ set }) => (set.code == null ? set : { ...set, code: set.code.trim() }));
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'entity', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'entity', ids: changes.map(({ after }) => after.id) },
				changes
			);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				{ collection: 'entity', ids: rows.map((row) => row.id) },
				rows.map((before) => ({ before }))
			);
		}
	}
});
