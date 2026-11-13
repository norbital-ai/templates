import { Effect } from 'effect';
import { model } from '../../../../../../.norbital/models/registered_rule.ts';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../../lib/payroll_engine/configuration.js';

export default model({
	description:
		'Effective jurisdiction configuration. Sealing the owner freezes this rule and its declared references.',
	record_label: 'record.code',
	fields: {
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'registered_rule',
			owned: true
		},
		code: { kind: 'text' },
		description: { kind: 'text', optional: true },
		target_collection: { kind: 'text' },
		events: {
			kind: 'enum',
			values: ['create', 'update', 'delete'],
			many: true
		},
		reads: { kind: 'custom', of: 'reads', optional: true },
		condition: { kind: 'text', max: 65536, optional: true },
		validate: { kind: 'text', max: 65536 },
		order: { kind: 'int', default: 0 },
		lookup: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		},
		references: { kind: 'custom', of: 'references', optional: true }
	},
	constraints: { code_per_settings: { unique: ['settings_id', 'code'] } },
	outputs: {
		default: {
			fields: 'all',
			settings_id: { fields: 'all', registered_rule: { fields: 'all' } }
		}
	},
	create: {
		columns: {
			fields: [
				'settings_id',
				'code',
				'description',
				'target_collection',
				'events',
				'reads',
				'condition',
				'validate',
				'order',
				'lookup',
				'references'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'registered_rule',
				changes.map((c) => c.after),
				changes.map((c) => c.after.settings_id)
			);
			return changes.map((c) => c.set);
		}
	},
	update: {
		columns: {
			fields: [
				'code',
				'description',
				'target_collection',
				'events',
				'reads',
				'condition',
				'validate',
				'order',
				'lookup',
				'references'
			]
		},
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'registered_rule',
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
