import { tap } from '../../../lib/payroll_engine/taps.js';
import { model } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { sealConfiguration } from '../../../lib/payroll_engine/sealing.js';

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
		employee_extension_schema: { kind: 'json', optional: true },
		entity_extension_schema: { kind: 'json', optional: true },
		lookup: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
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
				'employee_extension_schema',
				'entity_extension_schema',
				'lookup',
				'status',
				'reason'
			]
		},
		transform: function* (rows, ctx) {
			if (rows.some((r) => r.status !== undefined && r.status !== 'DRAFT'))
				return yield* ctx.refuse('Create a draft before sealing a jurisdiction configuration.');
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
				'employee_extension_schema',
				'entity_extension_schema',
				'lookup',
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
						'leave_entitlement',
						{},
						from > String(ctx.today)
							? { at: Instant(`${from}T00:00:00Z`), key: `leave_entitlement:${from}` }
							: { key: 'leave_entitlement' }
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
