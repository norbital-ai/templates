import { Effect } from 'effect';
import { model } from '../../../../../../.norbital/models/registered_effect.ts';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../lib/payroll_engine/configuration.js';

export default model({
	description:
		'Effective jurisdiction configuration. Sealing the owner freezes this rule and its declared references.',
	record_label: 'record.code',
	fields: {
		lookup: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		},
		code: { kind: 'text' },
		description: { kind: 'text', optional: true },
		name: { kind: 'text' },
		references: { kind: 'custom', of: 'references', optional: true },
		source_collection: { kind: 'text' },
		events: {
			kind: 'enum',
			values: ['create', 'update', 'delete', 'seal', 'exit'],
			many: true
		},
		reads: { kind: 'custom', of: 'reads', optional: true },
		condition: { kind: 'text', max: 65536 },
		target_collection: { kind: 'text' },
		target_action: { kind: 'enum', values: ['create', 'update', 'delete'] },
		effects: { kind: 'text', max: 65536 },
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'registered_effect',
			owned: true
		}
	},
	constraints: { code_per_settings: { unique: ['settings_id', 'code'] } },
	outputs: {
		default: {
			fields: 'all',
			settings_id: { fields: 'all', registered_effect: { fields: 'all' } }
		}
	},
	create: {
		columns: {
			fields: [
				'lookup',
				'code',
				'description',
				'name',
				'references',
				'source_collection',
				'events',
				'reads',
				'condition',
				'target_collection',
				'target_action',
				'effects',
				'settings_id'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'registered_effect',
				changes.map((c) => c.after),
				changes.map((c) => c.after.settings_id)
			);
			return changes.map((c) => c.set);
		}
	},
	update: {
		columns: {
			fields: [
				'lookup',
				'code',
				'description',
				'name',
				'references',
				'source_collection',
				'events',
				'reads',
				'condition',
				'target_collection',
				'target_action',
				'effects'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'registered_effect',
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
