import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';
import {
	isJsonObject,
	jsonObject,
	type JsonObject
} from '../../../../../../../lib/payroll_engine/foundation.js';
import { queryRows, type Reader } from '../../../../../../../lib/payroll_engine/reads.js';
import { Effect } from 'effect';
import { validateRegistered } from '../../../../../../../lib/payroll_engine/registrations.js';

/** A case carries the inputs its catalogue row marks as required: one rule for every jurisdiction. */
const missingInputs = Effect.fnUntraced(function* (read: Reader, entries: readonly JsonObject[]) {
	const { workplace_case_catalog: rows = [] } = yield* queryRows(read, {
		workplace_case_catalog: {
			where: { id: { in: [...new Set(entries.map((entry) => String(entry.catalog_id)))] } },
			fields: ['id', 'lookup'],
			limit: 10000
		}
	});
	const required = new Map(
		rows.map((row) => {
			const schema = jsonObject(jsonObject(row.lookup ?? {}).input_schema ?? {});
			return [
				String(row.id),
				Array.isArray(schema.required) ? schema.required.map(String) : []
			] as const;
		})
	);
	for (const entry of entries) {
		const inputs = isJsonObject(entry.inputs) ? entry.inputs : {};
		const missing = (required.get(String(entry.catalog_id)) ?? []).filter(
			(key) => inputs[key] == null || inputs[key] === ''
		);
		if (missing.length > 0) return `This case needs ${missing.join(', ')}.`;
	}
	return undefined;
});

export default model('workplace_case_catalog_entry', {
	description:
		'Employer-scoped source data for one declared case variant, validated before acceptance and protected when captured by payroll.',
	label: 'kind',
	fields: {
		catalog_id: {
			kind: 'ref',
			to: 'workplace_case_catalog',
			inverse: 'entries',
			onDelete: 'restrict'
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'workplace_case_catalog_entries' },
		employment_id: {
			kind: 'ref',
			to: 'employee_contract',
			inverse: 'workplace_case_catalog_entry',
			onDelete: 'restrict'
		},
		severity: {
			kind: 'enum',
			values: [
				'DEATH',
				'PERMANENT_TOTAL_DISABILITY',
				'SERIOUS_INJURY',
				'MINOR_INJURY',
				'NEAR_MISS',
				'PROPERTY_DAMAGE',
				'N/A'
			],
			default: 'N/A',
			help: 'The injury or loss classification. Non-injury cases such as harassment or data mishandling use N/A.'
		},
		occurred_on: { kind: 'date', optional: true },
		location: { kind: 'text', optional: true },
		reference: { kind: 'text', optional: true },
		description: { kind: 'text', optional: true },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'setNull' },
		kind: { kind: 'text' },
		opened_on: { kind: 'date' },
		scheduled_on: { kind: 'date', optional: true },
		closed_on: { kind: 'date', optional: true },
		inputs: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
		evidence_file: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			optional: true,
			label: 'Document'
		}
	},
	locked: { payroll_run_id: { isNull: false } },
	read: {
		workplace_case_catalog_entry: { fields: 'all' },
		'workplace_case_catalog_entry.catalog_id': { fields: 'all' },
		'workplace_case_catalog_entry.payroll_run_id': { fields: 'all' }
	},
	create: {
		columns: {
			workplace_case_catalog_entry: [
				'catalog_id',
				'entity_id',
				'employment_id',
				'severity',
				'occurred_on',
				'location',
				'reference',
				'description',
				'kind',
				'opened_on',
				'scheduled_on',
				'closed_on',
				'inputs',
				'evidence_file'
			]
		},
		transform: function* (rows, ctx) {
			const missing = yield* missingInputs(
				ctx.db.query,
				rows.map((row) => jsonObject(row))
			);
			if (missing !== undefined) return yield* ctx.refuse(missing);
			yield* validateRegistered(
				ctx.db.query,
				'workplace_case_catalog_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			return rows;
		}
	},
	update: {
		transform: function* (changes, ctx) {
			if (
				changes.every(
					(change) =>
						Object.keys(change.set).length === 1 && Object.hasOwn(change.set, 'payroll_run_id')
				)
			)
				return changes.map((change) => change.set);
			const missing = yield* missingInputs(
				ctx.db.query,
				changes.map((change) => jsonObject({ ...change.before, ...change.set }))
			);
			if (missing !== undefined) return yield* ctx.refuse(missing);
			yield* validateRegistered(
				ctx.db.query,
				'workplace_case_catalog_entry',
				'update',
				changes.map((change) => jsonObject({ ...change.before, ...change.set }))
			);
			return changes.map((change) => change.set);
		},
		columns: {
			workplace_case_catalog_entry: [
				'payroll_run_id',
				'catalog_id',
				'entity_id',
				'employment_id',
				'severity',
				'occurred_on',
				'location',
				'reference',
				'description',
				'kind',
				'opened_on',
				'scheduled_on',
				'closed_on',
				'inputs',
				'evidence_file'
			]
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				'workplace_case_catalog_entry',
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			// sealing into a run is not an edit of the entry
			const edited = changes.filter(
				({ before, after }) => before.payroll_run_id === after.payroll_run_id
			);
			if (edited.length === 0) return;
			yield* tap(ctx, 'update', 'workplace_case_catalog_entry', edited);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				'workplace_case_catalog_entry',
				rows.map((before) => ({ before }))
			);
		}
	}
});
