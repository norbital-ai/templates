import { Effect } from 'effect';
import { model } from '../../../../../../../.norbital/models/workplace_case_catalog.ts';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model({
	description:
		'Effective jurisdiction catalogue of entity-wide workplace case variants and their registered effects.',
	record_label: 'record.code',
	fields: {
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'workplace_case_catalog',
			owned: true
		},
		lookup: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
		subtotal_id: { kind: 'ref', to: 'subtotal', optional: true, on_delete: 'restrict' },
		code: { kind: 'text' },
		description: { kind: 'text', optional: true },
		references: { kind: 'custom', of: 'references', optional: true },
		events: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} }
	},
	constraints: { code_per_settings: { unique: ['settings_id', 'code'] } },
	outputs: {
		default: {
			fields: 'all',
			settings_id: { fields: 'all' },
			subtotal_id: { fields: ['code', 'name'] }
		}
	},
	create: {
		columns: {
			fields: [
				'settings_id',
				'lookup',
				'subtotal_id',
				'code',
				'description',
				'references',
				'events'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'workplace_case_catalog',
				changes.map((c) => c.after),
				changes.map((c) => c.after.settings_id)
			);
			return changes.map((c) => c.set);
		}
	},
	update: {
		columns: {
			fields: ['lookup', 'subtotal_id', 'code', 'description', 'references', 'events']
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'workplace_case_catalog',
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
