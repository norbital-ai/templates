import { tap } from '../../../lib/payroll_engine/taps.js';
import { model } from '../../../../.norbital/models/jurisdiction_settings.ts';
import { Instant } from '@norbital-ai/std/date';
import { sealConfiguration } from '../../../lib/payroll_engine/sealing.js';
import { rangeObject } from '../../../lib/payroll_engine/registrations.js';
import { amendmentsOf, versionReach } from '../../../lib/amendments.js';

type ArmError = {
	readonly key:
		| 'errors.jurisdiction_conversion_fixed_divisor'
		| 'errors.jurisdiction_conversion_divisor_fixed_only';
	readonly values: { readonly code: string; readonly arm: string; readonly unit: string };
};

/** A conversion arm is a union in use: only FIXED owns its divisor; no other arm may carry it. */
const conversionArmError = (row: {
	readonly conversions?: unknown;
	readonly code?: unknown;
}): ArmError | undefined => {
	if (
		row.conversions === null ||
		typeof row.conversions !== 'object' ||
		Array.isArray(row.conversions)
	)
		return undefined;
	const conversions = row.conversions as Record<string, unknown>;
	for (const [name, unit] of [
		['day', 'days'],
		['hour', 'hours']
	] as const) {
		const arm = conversions[name];
		if (arm === null || typeof arm !== 'object' || Array.isArray(arm)) continue;
		const value = arm as Record<string, unknown>;
		const fixed = value.basis === 'FIXED';
		const divisor = value[unit];
		const values = { code: String(row.code ?? 'settings'), arm: name, unit };
		if (fixed && (typeof divisor !== 'number' || divisor <= 0))
			return { key: 'errors.jurisdiction_conversion_fixed_divisor', values };
		if (!fixed && divisor !== undefined)
			return { key: 'errors.jurisdiction_conversion_divisor_fixed_only', values };
	}
	return undefined;
};

export default model({
	description:
		'One sealed effective legal configuration. Catalogue definitions, validation, registered effects and statutory references have explicit owners.',
	record_label: 'record.name',
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text' },
		effective_range: { kind: 'period', of: 'date' },
		currency: { kind: 'currency' },
		timezone: { kind: 'text', format: 'zone' },
		tax_year_start_month: { kind: 'int', min: 1, max: 12 },
		/** How this law converts a month's wage, and how it rounds. One typed block: no loose settings keys. */
		conversions: {
			kind: 'object',
			fields: {
				/** How one day's pay derives from the month's wage: a named conversion, or a fixed statutory divisor. */
				day: {
					kind: 'object',
					fields: {
						basis: {
							kind: 'enum',
							values: ['CALENDAR_DAYS', 'WORKING_DAYS', 'YEAR', 'YEAR_REST_DAYS', 'HOUR', 'FIXED']
						},
						/** The divisor when the basis is FIXED (Malaysia 26, China 21.75, Thailand and Taiwan 30). */
						days: { kind: 'number', min: 0, optional: true }
					}
				},
				/** How one hour's pay derives: the contract's day, the contract's week, or a fixed statutory divisor. */
				hour: {
					kind: 'object',
					fields: {
						basis: { kind: 'enum', values: ['CONTRACT_HOURS', 'CONTRACT_WEEKLY', 'FIXED'] },
						/** The divisor when the basis is FIXED (Indonesia 173, China 174). */
						hours: { kind: 'number', min: 0, optional: true }
					}
				},
				proration: { kind: 'enum', values: ['CALENDAR_DAYS', 'WORKING_DAYS', 'DAY_RATE'] },
				rounding: {
					kind: 'object',
					fields: {
						mode: {
							kind: 'enum',
							values: ['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'TRUNCATE'],
							default: 'HALF_UP'
						},
						scale: { kind: 'int', min: 0, max: 12, default: 2 },
						/** Where a day not paid or not employed is rounded: the day rate first, or only the amount. */
						day_rate: { kind: 'enum', values: ['RATE', 'AMOUNT'], default: 'RATE' }
					}
				},
				/** The ad hoc row, by code, that prices pay of earlier periods in the period it is paid. */
				back_pay: { kind: 'text', optional: true }
			}
		},
		/** Whether the year-to-date balance totals restart per employer (China and Thailand withhold alone). */
		ledger: {
			kind: 'object',
			fields: {
				ytd_scope: { kind: 'enum', values: ['JURISDICTION', 'EMPLOYER'], default: 'JURISDICTION' }
			}
		},
		employee_extension_schema: { kind: 'json', optional: true },
		entity_extension_schema: { kind: 'json', optional: true },
		lookup: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
		/** The work-region keys this jurisdiction recognises, mapped to their display names. */
		work_regions: { kind: 'json', shape: { kind: 'record', of: { kind: 'text' } }, default: {} },
		status: {
			kind: 'state',
			initial: 'DRAFT',
			states: {
				DRAFT: { to: ['SEALED', 'VOID'] },
				SEALED: { to: ['VOID'] },
				VOID: { to: [] }
			}
		},
		reason: { kind: 'text', optional: true }
	},
	constraints: {
		sealed_range: {
			no_overlap: 'effective_range',
			per: ['code'],
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
			subtotals: { fields: 'all' },
			leave_catalog: { fields: 'all' },
			claim_catalog: { fields: 'all' },
			allowance_catalog: { fields: 'all' },
			adhoc_catalog: { fields: 'all' },
			loan_catalog: { fields: 'all' },
			statutory_contribution_catalog: { fields: 'all' },
			registered_rule: { fields: 'all' },
			registered_effect: { fields: 'all' }
		},
		kiosk: { fields: ['code', 'name', 'timezone', 'effective_range', 'status'] }
	},
	create: {
		columns: {
			fields: [
				'code',
				'name',
				'effective_range',
				'currency',
				'timezone',
				'tax_year_start_month',
				'conversions',
				'ledger',
				'employee_extension_schema',
				'entity_extension_schema',
				'lookup',
				'work_regions',
				'status',
				'reason'
			]
		},
		transform: function* (changes, ctx) {
			const sealed = changes.findIndex(
				(c) => c.set.status !== undefined && c.set.status !== 'DRAFT'
			);
			if (sealed >= 0)
				return yield* ctx.refuse('errors.jurisdiction_create_draft_first', {
					row: sealed,
					field: 'status'
				});
			for (const [row, c] of changes.entries()) {
				const error = conversionArmError(c.after);
				if (error !== undefined)
					return yield* ctx.refuse(error.key, { row, field: 'conversions', values: error.values });
			}
			return changes.map((c) => ({ ...c.set, status: 'DRAFT' as const }));
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'jurisdiction_settings',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		columns: {
			fields: [
				'code',
				'name',
				'effective_range',
				'currency',
				'timezone',
				'tax_year_start_month',
				'conversions',
				'ledger',
				'employee_extension_schema',
				'entity_extension_schema',
				'lookup',
				'work_regions',
				'status',
				'reason'
			]
		},
		transform: function* (changes, ctx) {
			const sealing = changes.filter(
				(c) => c.before.status === 'DRAFT' && c.after.status === 'SEALED'
			);
			yield* sealConfiguration(
				ctx,
				sealing.map((c) => c.before.id)
			);
			for (const [row, { before, set, after }] of changes.entries()) {
				const error = conversionArmError(after);
				if (error !== undefined)
					return yield* ctx.refuse(error.key, { row, field: 'conversions', values: error.values });
				if (
					before.status === 'SEALED' &&
					set.effective_range !== undefined &&
					(set.effective_range.from !== before.effective_range.from ||
						set.effective_range.to === null ||
						(before.effective_range.to !== null &&
							set.effective_range.to > before.effective_range.to))
				)
					return yield* ctx.refuse('errors.jurisdiction_sealed_shorten_only', {
						row,
						field: 'effective_range'
					});
				if (set.status === 'VOID' && !set.reason?.trim())
					return yield* ctx.refuse('errors.jurisdiction_void_reason', { row, field: 'reason' });
			}
			// a version sealed from its real date over paid periods corrects the law they were worked out on: everyone
			// paid under it in those periods is amended, and the next run works each period out on the law now in force
			// A sealed version that only ends earlier moves no pay by itself: the version sealed over the days it gave up
			// amends them, in the same merge or a later one.
			const reached = changes.flatMap(({ before, set, after }) =>
				before.status === 'SEALED' && set.status !== 'VOID'
					? []
					: versionReach(before, after).map((span) => ({
							code: before.code,
							...span
						}))
			);
			if (reached.length === 0) return changes.map(({ set }) => set);
			const governed = yield* ctx.query({
				entity: {
					where: { settings_code: { in: [...new Set(reached.map((span) => span.code))] } },
					fields: ['id'],
					limit: 10000
				}
			});
			return {
				sets: changes.map(({ set }) => set),
				on_approved: yield* amendmentsOf(
					ctx.query,
					governed.entity.rows.map((row) => String(row.id)),
					reached
				)
			};
		},
		effect: function* (changes, ctx) {
			// the catalog changed: now if the version is in force, else on the day it starts
			for (const { before, after } of changes)
				if (before.status !== 'SEALED' && after.status === 'SEALED') {
					// an effect reads the stored range
					const from = String(rangeObject(after.effective_range ?? before.effective_range)?.from);
					yield* ctx.schedule(
						'ledger',
						{},
						from > String(ctx.today)
							? { at: Instant(`${from}T00:00:00Z`), key: `ledger:${from}` }
							: { key: 'ledger' }
					);
				}
			yield* tap(ctx, 'update', 'jurisdiction_settings', changes);
		}
	}
});
