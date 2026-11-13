import { model } from '../../../../../.norbital/models/entity_profile_version.ts';
import { tap } from '../../../../lib/payroll_engine/taps.js';
import { jsonObject } from '../../../../lib/payroll_engine/foundation.js';
import { validateRegistered } from '../../../../lib/payroll_engine/registrations.js';
import { amendmentsOf, versionReach } from '../../../../lib/amendments.js';

export default model({
	description:
		'Sealed employer data. A dated replacement changes future values; consumed historical values remain protected.',
	record_label: 'record.name',
	fields: {
		settings_code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		representative_name: {
			kind: 'text',
			optional: true
		},
		registered_address: { kind: 'text', optional: true },
		final_pay_loan_floor_percent: {
			kind: 'int',
			min: 0,
			max: 100,
			default: 10
		},
		overtime_full_award_percent: {
			kind: 'int',
			min: 1,
			max: 100,
			default: 100
		},
		pay_methods: {
			kind: 'object',
			optional: true,
			fields: {
				overtime_hour_basis: {
					kind: 'enum',
					values: ['STATUTORY', 'CONTRACT_WEEKLY'],
					default: 'STATUTORY'
				},
				rest_day_hourly_multiplier: {
					kind: 'number',
					min: 1,
					optional: true
				},
				night_differential_basis: {
					kind: 'enum',
					values: ['WORKED', 'CLOCK_SPAN', 'WHOLE_NIGHT'],
					default: 'WORKED'
				},
				contribution_split: {
					kind: 'enum',
					values: ['EVEN', 'FIRST_RUN'],
					default: 'EVEN'
				},
				health_billing: {
					kind: 'enum',
					values: ['CURRENT', 'ARREARS'],
					default: 'CURRENT'
				},
				benefit_exclusion: {
					kind: 'enum',
					values: ['POOLED', 'EXCESS_TAXED'],
					default: 'POOLED'
				},
				/** Leave codes the employer pays in full where the law's row leaves them unpaid: its own policy, no statute. */
				paid_leave: { kind: 'text', many: true, optional: true }
			}
		},
		entity_extension_data: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		},
		time_zone: {
			kind: 'text',
			optional: true
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
				DRAFT: { to: ['SEALED'] },
				SEALED: { to: ['VOID'] },
				VOID: { to: [] }
			}
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'payroll_versions', on_delete: 'restrict' },
		reason: { kind: 'text', optional: true }
	},
	constraints: {
		sealed_range: {
			no_overlap: 'effective_range',
			per: ['entity_id'],
			where: { status: { eq: 'SEALED' } }
		},
		// a sealed version keeps its terms: only its period, its reason and a move to VOID stay editable
		sealed_version: {
			locked: { status: { eq: 'SEALED' } },
			except: ['effective_range', 'reason', 'status']
		},
		void_version: { locked: { status: { eq: 'VOID' } } }
	},
	outputs: {
		default: {
			fields: 'all',
			entity_id: { fields: 'all' }
		},
		kiosk: { fields: ['entity_id', 'effective_range', 'status', 'time_zone'] }
	},
	create: {
		columns: {
			fields: [
				'entity_id',
				'name',
				'representative_name',
				'effective_range',
				'settings_code',
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
		transform: function* (changes, ctx) {
			const rows = changes.map(({ set }) => set);
			yield* validateRegistered(
				ctx.query,
				'entity_profile_version',
				'create',
				rows.map((row) => jsonObject(row))
			);
			return {
				sets: rows,
				// a version sealed over paid periods amends everyone the company paid in them
				on_approved: yield* amendmentsOf(
					ctx.query,
					[...new Set(rows.map((row) => String(row.entity_id)))],
					rows.flatMap((row) => versionReach(undefined, row))
				)
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'entity_profile_version',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		columns: {
			fields: [
				'entity_id',
				'name',
				'representative_name',
				'effective_range',
				'settings_code',
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
		transform: function* (changes, ctx) {
			const substantive = changes.filter((change) => change.set.status !== 'VOID');
			if (substantive.length > 0)
				yield* validateRegistered(
					ctx.query,
					'entity_profile_version',
					'update',
					substantive.map((change) => jsonObject(change.after))
				);
			const unexplained = changes.findIndex(
				({ set }) => set.status === 'VOID' && !set.reason?.trim()
			);
			if (unexplained >= 0)
				return yield* ctx.refuse('errors.entity_profile_version_void_reason', {
					row: unexplained,
					field: 'reason'
				});
			return {
				sets: changes.map((change) => change.set),
				// sealed, voided or cut short over paid periods: everyone the company paid in them is amended
				on_approved: yield* amendmentsOf(
					ctx.query,
					[...new Set(changes.map((change) => String(change.before.entity_id)))],
					changes.flatMap(({ before, after }) => versionReach(before, after))
				)
			};
		},
		effect: function* (changes, ctx) {
			const sealed = changes.filter(
				({ before, after }) => before.status !== 'SEALED' && after.status === 'SEALED'
			);
			if (sealed.length > 0)
				yield* tap(
					ctx,
					'seal',
					'entity_profile_version',
					sealed.map(({ after }) => ({ after }))
				);
			if (sealed.length > 0) yield* ctx.schedule('ledger', {}, { key: 'ledger' });
			yield* tap(ctx, 'update', 'entity_profile_version', changes);
		}
	}
});
