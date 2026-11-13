import { model } from '../../../../../.norbital/models/workplace_case_catalog_entry.ts';
import { tap } from '../../../../lib/payroll_engine/taps.js';
import {
	isJsonObject,
	jsonObject,
	type JsonObject
} from '../../../../lib/payroll_engine/foundation.js';
import type { Reader } from '../../../../lib/payroll_engine/reads.js';
import { lawOn } from '../../../../lib/law.js';
import { Effect } from 'effect';
import { validateRegistered } from '../../../../lib/payroll_engine/registrations.js';

/**
 * A case carries the inputs its catalogue row marks as required: one rule for every jurisdiction. The row is the one
 * its code names in the law in force the day the case opened.
 */
const missingInputs = Effect.fnUntraced(function* (read: Reader, entries: readonly JsonObject[]) {
	const laws = yield* lawOn(
		read,
		entries.map((entry) => ({ entity: entry.entity_id, on: entry.opened_on }))
	);
	for (const [index, entry] of entries.entries()) {
		const row = laws[index]?.rows.workplace_case_catalog.find(
			(held) => held.code === entry.catalog_code
		);
		const schema = jsonObject(jsonObject(row?.lookup ?? {}).input_schema ?? {});
		const inputs = isJsonObject(entry.inputs) ? entry.inputs : {};
		const missing = (Array.isArray(schema.required) ? schema.required.map(String) : []).filter(
			(key) => inputs[key] == null || inputs[key] === ''
		);
		if (missing.length > 0) return { row: index, inputs: missing.join(', ') };
	}
	return undefined;
});

export default model({
	description:
		'Employer-scoped source data for one declared case variant, validated before acceptance and protected when captured by payroll.',
	record_label: "record.kind + ' · ' + string(record.opened_on)",
	fields: {
		catalog_code: { kind: 'text' },
		entity_id: { kind: 'ref', to: 'entity', inverse: 'workplace_case_catalog_entries' },
		employment_id: {
			kind: 'ref',
			to: 'employee_contract',
			inverse: 'workplace_case_catalog_entry',
			on_delete: 'restrict'
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
			default: 'N/A'
		},
		occurred_on: { kind: 'date', optional: true },
		location: { kind: 'text', optional: true },
		reference: { kind: 'text', optional: true },
		description: { kind: 'text', optional: true },
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			inverse: 'case',
			optional: true,
			on_delete: 'set_null'
		},
		kind: { kind: 'text' },
		opened_on: { kind: 'date' },
		scheduled_on: { kind: 'date', optional: true },
		closed_on: { kind: 'date', optional: true },
		inputs: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, default: {} },
		evidence_file: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			optional: true
		}
	},
	constraints: { captured: { locked: { payroll_run_id: { is_null: false } } } },
	outputs: {
		default: {
			fields: 'all',
			payroll_run_id: { fields: 'all' }
		}
	},
	create: {
		columns: {
			fields: [
				'catalog_code',
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
		transform: function* (changes, ctx) {
			const rows = changes.map((c) => jsonObject(c.after));
			const missing = yield* missingInputs(ctx.query, rows);
			if (missing !== undefined)
				return yield* ctx.refuse('errors.workplace_case_missing_inputs', {
					row: missing.row,
					field: 'inputs',
					values: { inputs: missing.inputs }
				});
			yield* validateRegistered(ctx.query, 'workplace_case_catalog_entry', 'create', rows);
			return changes.map((c) => c.set);
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'workplace_case_catalog_entry',
				changes.map(({ after }) => ({ after }))
			);
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
			const proposed = changes.map((change) => jsonObject(change.after));
			const missing = yield* missingInputs(ctx.query, proposed);
			if (missing !== undefined)
				return yield* ctx.refuse('errors.workplace_case_missing_inputs', {
					row: missing.row,
					field: 'inputs',
					values: { inputs: missing.inputs }
				});
			yield* validateRegistered(ctx.query, 'workplace_case_catalog_entry', 'update', proposed);
			return changes.map((change) => change.set);
		},
		effect: function* (changes, ctx) {
			// sealing into a run is not an edit of the entry
			const edited = changes.filter((change) => !change.changed('payroll_run_id'));
			if (edited.length === 0) return;
			yield* tap(ctx, 'update', 'workplace_case_catalog_entry', edited);
		},
		columns: {
			fields: [
				'payroll_run_id',
				'catalog_code',
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
	}
	// no delete exposure, as before: the old `effect.deleted` could not run, and a delete effect would expose delete
});
