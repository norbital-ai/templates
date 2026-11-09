import { tap } from '../../../lib/payroll_engine/taps.js';
import { model } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { sealConfiguration } from '../../../lib/payroll_engine/sealing.js';

/** A conversion arm is a union in use: only FIXED owns its divisor; no other arm may carry it. */
const conversionArmError = (row: {
	readonly conversions?: unknown;
	readonly code?: unknown;
}): string | undefined => {
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
		if (fixed && (typeof divisor !== 'number' || divisor <= 0))
			return `${String(row.code ?? 'settings')}: conversions.${name} FIXED requires a positive ${unit}.`;
		if (!fixed && divisor !== undefined)
			return `${String(row.code ?? 'settings')}: conversions.${name}.${unit} belongs only to FIXED.`;
	}
	return undefined;
};

export default model('jurisdiction_settings', {
	description:
		'One sealed effective legal configuration. Catalogue definitions, validation, registered effects and statutory references have explicit owners.',
	label: 'name',
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
						days: {
							kind: 'number',
							min: 0,
							optional: true,
							help: 'The divisor when the basis is FIXED (Malaysia 26, China 21.75, Thailand and Taiwan 30).'
						}
					}
				},
				/** How one hour's pay derives: the contract's day, the contract's week, or a fixed statutory divisor. */
				hour: {
					kind: 'object',
					fields: {
						basis: { kind: 'enum', values: ['CONTRACT_HOURS', 'CONTRACT_WEEKLY', 'FIXED'] },
						hours: {
							kind: 'number',
							min: 0,
							optional: true,
							help: 'The divisor when the basis is FIXED (Indonesia 173, China 174).'
						}
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
						scale: { kind: 'int', min: 0, max: 12, default: 2 }
					}
				}
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
		work_regions: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'text' } },
			default: {},
			help: 'The work-region keys this jurisdiction recognises, mapped to their display names. A contract picks one key.'
		},
		status: {
			kind: 'state',
			initial: 'DRAFT',
			states: {
				DRAFT: { to: ['SEALED', 'VOID'], edit: 'all' },
				SEALED: { to: ['VOID'], edit: ['effective_range', 'reason'] },
				VOID: { to: [], edit: 'none' }
			}
		},
		reason: { kind: 'text', optional: true }
	},
	noOverlap: [{ key: ['code'], period: 'effective_range', where: { status: { eq: 'SEALED' } } }],
	read: {
		jurisdiction_settings: { fields: 'all' },
		'jurisdiction_settings.subtotals': { fields: 'all' },
		'jurisdiction_settings.leave_catalog': { fields: 'all' },
		'jurisdiction_settings.claim_catalog': { fields: 'all' },
		'jurisdiction_settings.allowance_catalog': { fields: 'all' },
		'jurisdiction_settings.adhoc_catalog': { fields: 'all' },
		'jurisdiction_settings.loan_catalog': { fields: 'all' },
		'jurisdiction_settings.statutory_contribution_catalog': { fields: 'all' },
		'jurisdiction_settings.registered_rule': { fields: 'all' },
		'jurisdiction_settings.registered_effect': { fields: 'all' }
	},
	outputs: {
		kiosk: {
			jurisdiction_settings: {
				fields: ['code', 'name', 'timezone', 'effective_range', 'status']
			}
		}
	},
	create: {
		columns: {
			jurisdiction_settings: [
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
		transform: function* (rows, ctx) {
			if (rows.some((r) => r.status !== undefined && r.status !== 'DRAFT'))
				return yield* ctx.refuse('Create a draft before sealing a jurisdiction configuration.');
			for (const row of rows) {
				const error = conversionArmError(row);
				if (error !== undefined) return yield* ctx.refuse(error);
			}
			return rows.map((r) => ({ ...r, status: 'DRAFT' as const }));
		}
	},
	update: {
		columns: {
			jurisdiction_settings: [
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
				(c) => c.before.status === 'DRAFT' && c.set.status === 'SEALED'
			);
			yield* sealConfiguration(
				ctx,
				sealing.map((c) => c.before.id)
			);
			for (const { before, set } of changes) {
				const error = conversionArmError({ ...before, ...set });
				if (error !== undefined) return yield* ctx.refuse(error);
				if (
					before.status === 'SEALED' &&
					set.effective_range !== undefined &&
					(set.effective_range.from !== before.effective_range.from ||
						set.effective_range.to === null ||
						(before.effective_range.to !== null &&
							set.effective_range.to > before.effective_range.to))
				)
					return yield* ctx.refuse(
						'A sealed version may only shorten its future effective period.'
					);
				if (set.status === 'VOID' && !set.reason?.trim())
					return yield* ctx.refuse('Record why this configuration is void.');
			}
			return changes.map(({ set }) => set);
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'jurisdiction_settings', ids: rows.map((r) => r.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			// the catalog changed: now if the version is in force, else on the day it starts
			for (const { before, after } of changes)
				if (before.status !== 'SEALED' && after.status === 'SEALED') {
					const from = String(after.effective_range.from);
					yield* ctx.schedule(
						'ledger',
						{},
						from > String(ctx.today)
							? { at: Instant(`${from}T00:00:00Z`), key: `ledger:${from}` }
							: { key: 'ledger' }
					);
				}
			yield* tap(
				ctx,
				'update',
				{ collection: 'jurisdiction_settings', ids: changes.map((c) => c.after.id) },
				changes
			);
		}
	}
});
