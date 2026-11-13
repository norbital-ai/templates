import { tap } from '../../../lib/payroll_engine/taps.js';
import { model } from '../../../../.norbital/models/entity.ts';

export default model({
	description:
		'One stable company identity. Sealed, dated employer payroll versions hold every payroll detail and its statutory validation link.',
	icon: 'lucide:building-2',
	record_label: 'record.name',
	fields: {
		code: { kind: 'text', optional: true },
		name: { kind: 'text' },
		settings_code: { kind: 'text' },
		source_reference: { kind: 'text', optional: true },
		epf_registered_on: { kind: 'date', optional: true },
		socso_registered_on: { kind: 'date', optional: true }
	},
	constraints: { code: { unique: ['code'] } },
	indexes: { search: { text: ['code', 'name'] } },
	outputs: {
		default: {
			fields: 'all',
			payroll_versions: { fields: 'all' },
			pay_groups: { fields: 'all' },
			shift_definition: { fields: 'all' },
			employee_contract: {
				fields: 'all',
				employee_id: { fields: 'all' },
				leave_catalog_entry: { fields: 'all' }
			}
		},
		self_service: {
			fields: ['name', 'settings_code'],
			payroll_versions: { fields: ['entity_id', 'effective_range', 'status', 'time_zone'] }
		},
		kiosk: {
			fields: ['name', 'settings_code'],
			employee_contract: {
				fields: ['employee_id', 'entity_id', 'employee_number', 'effective_range'],
				employee_id: {
					fields: [
						'name',
						'email',
						'phone',
						'face_embedding',
						'face_photo',
						'face_enrollment_status',
						'face_enrolled_at'
					]
				}
			}
		}
	},
	create: {
		columns: {
			fields: [
				'code',
				'name',
				'settings_code',
				'source_reference',
				'epf_registered_on',
				'socso_registered_on'
			]
		},
		transform: function* (changes, ctx) {
			const blank = changes.findIndex(({ set }) => set.code != null && set.code.trim() === '');
			if (blank >= 0)
				return yield* ctx.refuse('errors.entity_code_blank', { row: blank, field: 'code' });
			return changes.map(({ set }) => (set.code == null ? set : { ...set, code: set.code.trim() }));
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'entity',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		columns: {
			fields: [
				'code',
				'name',
				'settings_code',
				'source_reference',
				'epf_registered_on',
				'socso_registered_on'
			]
		},
		transform: function* (changes, ctx) {
			for (const [row, change] of changes.entries()) {
				const { before, set } = change;
				if (set.code != null && set.code.trim() === '')
					return yield* ctx.refuse('errors.entity_code_blank', { row, field: 'code' });
				if (!change.changed('settings_code')) continue;
				const used = yield* ctx.query({
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
					return yield* ctx.refuse('errors.entity_jurisdiction_linked', {
						row,
						field: 'settings_code'
					});
			}
			return changes.map(({ set }) => (set.code == null ? set : { ...set, code: set.code.trim() }));
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'entity', changes);
		}
	}
});
