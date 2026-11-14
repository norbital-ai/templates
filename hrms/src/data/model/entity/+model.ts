import { tap } from '../../../lib/payroll_engine/taps.js';
import { model } from '@norbital-ai/bolt';

/** The company's fields a writer sets. */
const columns = [
	'code',
	'name',
	'settings_code',
	'representative_name',
	'registered_address',
	'time_zone',
	'bank',
	'source_reference',
	'epf_registered_on',
	'socso_registered_on'
] as const;

export default model('entity', {
	description:
		'One company. Its own fields never change by date, so an edit is a correction; what changes from a date is an entity_change row.',
	icon: 'lucide:building-2',
	record_label: 'record.name',
	fields: {
		code: { kind: 'text', optional: true },
		name: { kind: 'text' },
		settings_code: { kind: 'text' },
		representative_name: { kind: 'text', optional: true },
		registered_address: { kind: 'text', optional: true },
		time_zone: { kind: 'text', optional: true },
		bank: { kind: 'custom', of: 'bank', optional: true },
		source_reference: { kind: 'text', optional: true },
		epf_registered_on: { kind: 'date', optional: true },
		socso_registered_on: { kind: 'date', optional: true }
	},
	constraints: { code: { unique: ['code'] } },
	indexes: { search: { text: ['code', 'name'] } },
	outputs: {
		default: {
			fields: 'all',
			changes: { fields: 'all' },
			pay_groups: { fields: 'all' },
			shift_definition: { fields: 'all' },
			employment: {
				fields: 'all',
				employee_id: { fields: 'all' },
				leave_catalog_entry: { fields: 'all' }
			}
		},
		self_service: {
			fields: ['name', 'settings_code', 'time_zone']
		},
		kiosk: {
			fields: ['name', 'settings_code', 'time_zone'],
			employment: {
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
		fields: columns,
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
		fields: columns,
		transform: function* (changes, ctx) {
			const blank = changes.findIndex(({ set }) => set.code != null && set.code.trim() === '');
			if (blank >= 0)
				return yield* ctx.refuse('errors.entity_code_blank', { row: blank, field: 'code' });
			// a company with a dated change or a stint keeps its law
			const moving = changes.flatMap((change) =>
				change.changed('settings_code') ? [change.before.id] : []
			);
			const used = yield* ctx.query({
				entity_change: {
					where: { entity_id: { in: moving } },
					fields: ['entity_id'],
					limit: 10000
				},
				employment: { where: { entity_id: { in: moving } }, fields: ['entity_id'], limit: 10000 }
			});
			const linked = new Set(
				[...used.entity_change.rows, ...used.employment.rows].map((row) => row.entity_id)
			);
			const row = changes.findIndex(({ before }) => linked.has(before.id));
			if (row >= 0)
				return yield* ctx.refuse('errors.entity_jurisdiction_linked', {
					row,
					field: 'settings_code'
				});
			return changes.map(({ set }) => (set.code == null ? set : { ...set, code: set.code.trim() }));
		},
		effect: function* (changes, ctx) {
			// a company's particulars change on the day they are written: its effects read that day as the row's first
			yield* tap(
				ctx,
				'update',
				'entity',
				changes.map(({ before, after }) => ({
					before,
					after: { ...after, effective_range: { from: String(ctx.today), to: null } }
				}))
			);
		}
	}
});
