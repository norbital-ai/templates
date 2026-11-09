import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../lib/payroll_engine/taps.js';
import { jsonObject } from '../../../../lib/payroll_engine/foundation.js';
import { validateRegistered } from '../../../../lib/payroll_engine/registrations.js';

export default model('entity_profile_version', {
	description:
		'Sealed employer data. A dated replacement changes future values; consumed historical values remain protected.',
	label: 'name',
	fields: {
		input_schema_version_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'employer_payroll_versions',
			onDelete: 'restrict',
			where: { status: { eq: 'SEALED' } }
		},
		settings_code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		representative_name: {
			kind: 'text',
			optional: true,
			help: 'The responsible person the law names for filing and registration duties.'
		},
		registered_address: { kind: 'text', optional: true },
		final_pay_loan_floor_percent: {
			kind: 'int',
			min: 0,
			max: 100,
			default: 10,
			help: 'The share of expected final pay that must remain after loan recovery.'
		},
		overtime_full_award_percent: {
			kind: 'int',
			min: 1,
			max: 100,
			default: 100,
			help: 'How much of planned overtime the clock must cover to pay all of it. Below this, the clocked time pays, rounded down to the half hour.'
		},
		pay_methods: {
			kind: 'object',
			optional: true,
			help: "The employer's own pay methods. Each pays only where it pays more than the law; otherwise the law stands.",
			fields: {
				overtime_hour_basis: {
					kind: 'enum',
					values: ['STATUTORY', 'CONTRACT_WEEKLY'],
					default: 'STATUTORY',
					help: "CONTRACT_WEEKLY prices an overtime hour at the monthly wage × 12 ÷ (52 × the contract's weekly hours)."
				},
				rest_day_hourly_multiplier: {
					kind: 'number',
					min: 1,
					optional: true,
					help: 'Every rest-day hour pays this multiple of the hour rate.'
				},
				night_differential_basis: {
					kind: 'enum',
					values: ['WORKED', 'CLOCK_SPAN'],
					default: 'WORKED',
					help: 'CLOCK_SPAN pays the night premium on every clocked hour in the night window, unpaid breaks and overtime included, at the ordinary hour rate; a shift where the law pays more keeps the law.'
				}
			}
		},
		entity_extension_data: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {},
			help: "The entity data the jurisdiction's entity extension schema declares."
		},
		time_zone: {
			kind: 'text',
			optional: true,
			help: "The zone this entity's payroll windows and rostered days are counted in."
		},
		bank: { kind: 'custom', of: 'bank', optional: true },

		effective_range: {
			kind: 'period',
			of: 'date'
		},

		status: {
			kind: 'state',
			initial: 'DRAFT',
			states: {
				DRAFT: { to: ['SEALED'], edit: 'all' },
				SEALED: { to: ['VOID'], edit: ['effective_range', 'reason'] },
				VOID: { to: [], edit: 'none' }
			}
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'payroll_versions', onDelete: 'restrict' },
		reason: { kind: 'text', optional: true }
	},
	noOverlap: [
		{ key: ['entity_id'], period: 'effective_range', where: { status: { eq: 'SEALED' } } }
	],
	read: {
		entity_profile_version: { fields: 'all' },
		'entity_profile_version.entity_id': { fields: 'all' },
		'entity_profile_version.input_schema_version_id': { fields: 'all' }
	},
	outputs: {
		kiosk: {
			entity_profile_version: {
				fields: ['entity_id', 'effective_range', 'status', 'time_zone']
			}
		}
	},
	create: {
		columns: {
			entity_profile_version: [
				'entity_id',
				'name',
				'representative_name',
				'effective_range',
				'settings_code',
				'input_schema_version_id',
				'time_zone',
				'registered_address',
				'final_pay_loan_floor_percent',
				'overtime_full_award_percent',
				'pay_methods',
				'bank',
				'entity_extension_data',
				'status',
				'reason'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'entity_profile_version',
				'create',
				rows.map((row) => jsonObject(row))
			);
			return rows;
		}
	},
	update: {
		transform: function* (changes, ctx) {
			const substantive = changes.filter((change) => change.set.status !== 'VOID');
			if (substantive.length > 0)
				yield* validateRegistered(
					ctx.db.query,
					'entity_profile_version',
					'update',
					substantive.map((change) => jsonObject({ ...change.before, ...change.set }))
				);
			for (const { set } of changes) {
				if (set.status === 'VOID' && !set.reason?.trim())
					return yield* ctx.refuse('Record why this version is void.');
			}
			return changes.map((change) => change.set);
		},
		columns: {
			entity_profile_version: [
				'entity_id',
				'name',
				'representative_name',
				'effective_range',
				'settings_code',
				'input_schema_version_id',
				'time_zone',
				'registered_address',
				'final_pay_loan_floor_percent',
				'overtime_full_award_percent',
				'pay_methods',
				'bank',
				'entity_extension_data',
				'status',
				'reason'
			]
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'entity_profile_version', ids: rows.map((r) => r.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			const sealed = changes.filter(
				({ before, after }) => before.status !== 'SEALED' && after.status === 'SEALED'
			);
			if (sealed.length > 0)
				yield* tap(
					ctx,
					'seal',
					{ collection: 'entity_profile_version', ids: sealed.map(({ after }) => after.id) },
					sealed.map(({ after }) => ({ after }))
				);
			if (sealed.length > 0) yield* ctx.schedule('ledger', {}, { key: 'ledger' });
			yield* tap(
				ctx,
				'update',
				{ collection: 'entity_profile_version', ids: changes.map((c) => c.after.id) },
				changes
			);
		}
	}
});
