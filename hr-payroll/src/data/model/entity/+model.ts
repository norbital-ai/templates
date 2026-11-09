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
		payment_schedule: {
			kind: 'json',
			optional: true,
			default: {
				frequency: 'MONTHLY',
				business_day: 'PREVIOUS',
				non_working_weekdays: [0, 6],
				short_month: 'LAST_DAY',
				pay_days: [25],
				pay_cutoff_day: 1
			},
			shape: {
				kind: 'union',
				by: 'frequency',
				arms: {
					MONTHLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: {
							kind: 'list',
							min: 1,
							of: { kind: 'int', min: 1, max: 31 },
							help: 'The day each cycle part pays, in order; the last entry repeats. A day past the month end pays on the last day.'
						},
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 }
					},
					SEMI_MONTHLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: {
							kind: 'list',
							min: 1,
							of: { kind: 'int', min: 1, max: 31 },
							help: 'The day each cycle part pays, in order; the last entry repeats. A day past the month end pays on the last day.'
						},
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 }
					},
					TEN_DAY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: {
							kind: 'list',
							min: 1,
							of: { kind: 'int', min: 1, max: 31 },
							help: 'The day each cycle part pays, in order; the last entry repeats. A day past the month end pays on the last day.'
						},
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 }
					},
					INTEGER_MONTHS: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: {
							kind: 'list',
							min: 1,
							of: { kind: 'int', min: 1, max: 31 },
							help: 'The day each cycle part pays, in order; the last entry repeats. A day past the month end pays on the last day.'
						},
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 },
						month_interval: { kind: 'int', min: 1, max: 12 },
						anchor_date: { kind: 'date' }
					},
					WEEKLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						weekday: { kind: 'int', min: 0, max: 6 },
						anchor_date: { kind: 'date' }
					},
					BIWEEKLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						weekday: { kind: 'int', min: 0, max: 6 },
						anchor_date: { kind: 'date' }
					},
					DAILY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] }
					}
				}
			}
		},
		source_reference: { kind: 'text', optional: true, label: 'Source reference' },
		epf_registered_on: {
			kind: 'date',
			optional: true,
			help: 'The actual date the employer registered with the Employees Provident Fund. A missing date means not yet recorded, not unregistered.'
		},
		socso_registered_on: {
			kind: 'date',
			optional: true,
			help: 'The actual date the employer registered with PERKESO; the single registration covers SOCSO and EIS. A missing date means not yet recorded, not unregistered.'
		}
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
		columns: {
			entity: [
				'code',
				'name',
				'settings_code',
				'payment_schedule',
				'source_reference',
				'epf_registered_on',
				'socso_registered_on'
			]
		},
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
		columns: {
			entity: [
				'code',
				'name',
				'settings_code',
				'payment_schedule',
				'source_reference',
				'epf_registered_on',
				'socso_registered_on'
			]
		},
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
