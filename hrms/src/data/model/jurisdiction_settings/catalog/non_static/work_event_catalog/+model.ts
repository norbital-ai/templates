import { Effect } from 'effect';
import { model } from '../../../../../../../.norbital/models/work_event_catalog.ts';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../../lib/payroll_engine/configuration.js';

export default model({
	description:
		'Configuration for dated real-world events that affect work and may dispense an allowance. The catalog row itself is the event type; it is referenced directly by a work event.',
	record_label: 'record.code',
	fields: {
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'work_event_catalog',
			owned: true
		},
		code: { kind: 'text' },
		description: { kind: 'text', optional: true },
		subtotal_id: { kind: 'ref', to: 'subtotal', optional: true, on_delete: 'restrict' },
		references: { kind: 'custom', of: 'references', optional: true },
		lookup: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} }
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
			fields: ['settings_id', 'code', 'description', 'subtotal_id', 'references', 'lookup']
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'work_event_catalog',
				changes.map((c) => c.after),
				changes.map((c) => c.after.settings_id)
			);
			return changes.map((c) => c.set);
		}
	},
	update: {
		columns: {
			fields: ['code', 'description', 'subtotal_id', 'references', 'lookup']
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'work_event_catalog',
				changes.map((change) => change.after),
				changes.map((change) => change.before.settings_id)
			);
			return changes.map((change) => change.set);
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
