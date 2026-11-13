import { Effect } from 'effect';
import { model } from '../../../../../../../.norbital/models/claim_catalog.ts';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model({
	description:
		'Effective jurisdiction configuration. Sealing the owner freezes this rule and its declared references.',
	record_label: 'record.code',
	fields: {
		subtotal_id: {
			kind: 'ref',
			to: 'subtotal',
			optional: true,
			on_delete: 'restrict',
			inverse: 'claim_catalog'
		},
		lookup: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
		code: { kind: 'text' },
		description: { kind: 'text', optional: true },
		references: { kind: 'custom', of: 'references', optional: true },
		eligibility: { kind: 'text', max: 65536, optional: true },
		conversion: { kind: 'text', max: 65536, optional: true },
		settings_id: { kind: 'ref', to: 'jurisdiction_settings', inverse: 'claim_catalog', owned: true }
	},
	constraints: { code_per_settings: { unique: ['settings_id', 'code'] } },
	outputs: {
		default: {
			fields: 'all',
			settings_id: { fields: 'all', registered_rule: { fields: 'all' } },
			subtotal_id: { fields: ['code', 'name'] }
		}
	},
	create: {
		columns: {
			fields: [
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'references',
				'eligibility',
				'conversion',
				'settings_id'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'claim_catalog',
				changes.map((c) => c.after),
				changes.map((c) => c.after.settings_id)
			);
			return changes.map((c) => c.set);
		}
	},
	update: {
		columns: {
			fields: [
				'subtotal_id',
				'lookup',
				'code',
				'description',
				'references',
				'eligibility',
				'conversion'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'claim_catalog',
				changes.map((c) => c.after),
				changes.map((c) => c.before.settings_id)
			);
			return changes.map((c) => c.set);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			yield* requireDraftSettings(
				ctx.query,
				changes.map((c) => c.before.settings_id)
			).pipe(
				Effect.catchTag('Refusal', (error) =>
					ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
				)
			);
		}
	}
});
