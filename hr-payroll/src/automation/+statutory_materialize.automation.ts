import { automation } from '@norbital-ai/bolt';
import { addDays } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { JsonObject } from '../lib/payroll_engine/contracts.js';
import { Refusal, stableJson, type Json } from '../lib/payroll_engine/foundation.js';
import { objectValue, queryAllRows, valueText } from '../lib/payroll_engine/reads.js';
import {
	carries,
	materialize,
	valueAt,
	type Snapshot,
	type StatutoryChange
} from '../lib/payroll_engine/statutory_change.js';

const SYSTEM = new Set(['id', 'revision', 'created_at', 'updated_at', 'created_by', 'updated_by']);
const LIFECYCLE = new Set(['status', 'reason']);
const business = (row: JsonObject): JsonObject =>
	Object.fromEntries(
		Object.entries(row).filter(([key]) => !SYSTEM.has(key) && !key.startsWith('$'))
	);
const CHILDREN = [
	'subtotal',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'allowance_catalog',
	'overtime_catalog',
	'statutory_contribution_catalog',
	'workplace_case_catalog',
	'work_interruption_catalog',
	'registered_rule',
	'registered_effect'
] as const;
type WriteCallable = 'jurisdiction_settings.create' | `${(typeof CHILDREN)[number]}.create`;

const fromOf = (row: JsonObject): string => valueText(objectValue(row.effective_range), 'from');
const covers = (row: JsonObject, date: string): boolean => {
	const to = objectValue(row.effective_range).to;
	return fromOf(row) <= date && (typeof to !== 'string' || date <= to);
};
/** Only a confirmed finding's unapplied changes are read: the state is the finding's. */
const changeOf = (row: JsonObject): StatutoryChange & { readonly finding_id: string } => ({
	id: valueText(row, 'id'),
	finding_id: valueText(row, 'finding_id'),
	jurisdiction_code: valueText(row, 'jurisdiction_code'),
	family: valueText(row, 'family'),
	row_code: typeof row.row_code === 'string' ? row.row_code : null,
	field_path: valueText(row, 'field_path'),
	old_value: row.old_value ?? null,
	new_value: row.new_value ?? null,
	effective_from: typeof row.effective_from === 'string' ? row.effective_from : null,
	status: 'CONFIRMED',
	applied_version_id: null
});
const snapshotOf = Effect.fnUntraced(function* (
	read: Parameters<typeof queryAllRows>[0],
	settings: JsonObject
) {
	const id = valueText(settings, 'id');
	const request: Record<string, { where: { settings_id: { eq: string } }; limit: number }> = {};
	for (const model of CHILDREN)
		request[model] = { where: { settings_id: { eq: id } }, limit: 10000 };
	const rows: Snapshot['rows'] = yield* queryAllRows(read, request);
	return { settings, rows };
});

export default automation('statutory_materialize', {
	description:
		'Materializes confirmed statutory changes of one jurisdiction, up to a target date, into one cumulative draft version per effective date, and seals a reviewed draft; `merge` does both for one release. Payroll keeps reading sealed versions until a draft is sealed.',
	input: {
		code: { kind: 'text' },
		target: { kind: 'date' },
		seal: { kind: 'text', optional: true },
		merge: { kind: 'bool', optional: true }
	},
	output: { kind: 'object', fields: { drafts: { kind: 'list', of: { kind: 'text' } } } },
	policies: ['configuration_execution'],
	run: function* (input, ctx) {
		const got = yield* queryAllRows(ctx.query, {
			jurisdiction_settings: {
				where: { code: { eq: input.code }, status: { in: ['SEALED', 'DRAFT'] } },
				limit: 10000
			},
			statutory_change: {
				where: {
					jurisdiction_code: { eq: input.code },
					applied_version_id: { isNull: true },
					finding_id: { is: { status: { eq: 'CONFIRMED' } } }
				},
				limit: 10000
			}
		});
		const versions = got.jurisdiction_settings ?? [];
		const changes = (got.statutory_change ?? []).map(changeOf);
		const sealed = versions.filter((row) => row.status === 'SEALED');
		const baselineOn = (date: string): JsonObject => {
			const baseline = sealed.find((row) => covers(row, date));
			if (baseline === undefined)
				throw new Refusal({
					message: `no_baseline: ${input.code} has no sealed version in force on ${date}.`
				});
			return baseline;
		};
		if (input.seal != null && input.seal !== '') {
			const draft = versions.find((row) => row.id === input.seal && row.status === 'DRAFT');
			if (draft === undefined)
				return yield* Effect.fail(new Refusal({ message: `${input.seal}: no such draft.` }));
			const day = fromOf(draft);
			const earlier = changes.find(
				(row) => row.effective_from !== null && row.effective_from < day
			);
			if (earlier !== undefined)
				return yield* Effect.fail(
					new Refusal({
						message: `out_of_order: seal the ${earlier.effective_from} snapshot before ${day}.`
					})
				);
			const predecessor = baselineOn(day);
			const dated = changes.filter((row) => row.effective_from === day);
			const finished = [...new Set(dated.map((row) => row.finding_id))].filter(
				(id) => !changes.some((row) => row.finding_id === id && row.effective_from !== day)
			);
			const baseline = yield* snapshotOf(ctx.query, predecessor);
			// the predecessor must still accept every change, and the draft must carry each one
			if (
				materialize({ baseline, changes: dated, target: day, jurisdiction: input.code }).length ===
				0
			)
				return yield* Effect.fail(
					new Refusal({ message: `no_changes: nothing confirmed takes effect on ${day}.` })
				);
			const written = yield* snapshotOf(ctx.query, draft);
			const missing = dated.find((change) => !carries(written, change));
			if (missing !== undefined)
				return yield* Effect.fail(
					new Refusal({ message: `stale: the draft does not carry ${missing.id}.` })
				);
			const answer = yield* ctx.act.checked([
				{
					callable: 'jurisdiction_settings.update',
					input: [
						{
							target: valueText(predecessor, 'id'),
							set: { effective_range: { from: fromOf(predecessor), to: addDays(day, -1) } }
						}
					]
				},
				{
					callable: 'jurisdiction_settings.update',
					input: [{ target: valueText(draft, 'id'), set: { status: 'SEALED' } }]
				},
				{
					callable: 'statutory_change.update',
					input: dated.map((change) => ({
						target: change.id,
						set: { applied_version_id: valueText(draft, 'id') }
					}))
				},
				...(finished.length === 0
					? []
					: [
							{
								callable: 'statutory_finding.update' as const,
								input: finished.map((target) => ({ target, set: { status: 'APPLIED' as const } }))
							}
						])
			]);
			if (answer.kind !== 'committed')
				return yield* Effect.fail(new Refusal({ message: 'The seal was held for approval.' }));
			return { drafts: [valueText(draft, 'id')] };
		}
		const baselineRow = baselineOn(input.target);
		const plans = materialize({
			baseline: yield* snapshotOf(ctx.query, baselineRow),
			changes,
			target: input.target,
			jurisdiction: input.code
		});
		if (input.merge === true && plans.length > 1)
			return yield* Effect.fail(
				new Refusal({
					message: `out_of_order: merge the ${plans[0]?.effective_from} release before ${input.target}.`
				})
			);
		const repeated = plans.find((plan) =>
			versions.some((row) => row.status === 'DRAFT' && fromOf(row) === plan.effective_from)
		);
		if (repeated !== undefined) {
			const draft = versions.find(
				(row) => row.status === 'DRAFT' && fromOf(row) === repeated.effective_from
			);
			// a release whose seal failed keeps its draft: merging again retries the seal
			if (input.merge === true && draft !== undefined) {
				yield* ctx.schedule('statutory_materialize', {
					code: input.code,
					target: input.target,
					seal: valueText(draft, 'id')
				});
				return { drafts: [valueText(draft, 'id')] };
			}
			return yield* Effect.fail(
				new Refusal({
					message: `already_materialized: ${input.code} has a draft from ${repeated.effective_from}; seal or void it first.`
				})
			);
		}
		// sealed law later than this release does not carry it; a version holding the old value would silently revert it
		// ponytail: refuses rather than recutting later sealed versions; recut when a jurisdiction needs mid-lineage inserts
		for (const row of sealed.filter((version) => fromOf(version) > input.target)) {
			const later = yield* snapshotOf(ctx.query, row);
			const reverted = changes.find(
				(change) =>
					change.effective_from !== null &&
					change.effective_from <= input.target &&
					stableJson(valueAt(later, change)) === stableJson(change.old_value)
			);
			if (reverted !== undefined)
				return yield* Effect.fail(
					new Refusal({
						message: `later_sealed: the version from ${fromOf(row)} still holds the old ${reverted.field_path}; it would revert this change.`
					})
				);
		}

		const write = Effect.fnUntraced(function* (
			callable: WriteCallable,
			rows: readonly JsonObject[]
		) {
			if (rows.length === 0) return [];
			const answer = yield* ctx.act.checked([{ callable, input: rows }]);
			if (answer.kind !== 'committed')
				return yield* Effect.fail(
					new Refusal({ message: `${callable}: the write was held for approval.` })
				);
			return answer.records;
		});
		const drafts: string[] = [];
		for (const { effective_from, snapshot } of plans) {
			const created = yield* write('jurisdiction_settings.create', [
				Object.fromEntries(
					Object.entries(business(snapshot.settings)).filter(([key]) => !LIFECYCLE.has(key))
				)
			]);
			const draftId = created.find((row) => row.model === 'jurisdiction_settings')?.id;
			if (draftId === undefined)
				return yield* Effect.fail(
					new Refusal({ message: `${input.code}: the ${effective_from} draft was not created.` })
				);

			const subtotalIds = new Map<string, string>();
			const subtotals = snapshot.rows.subtotal ?? [];
			const ordered: JsonObject[] = [];
			let cursor = subtotals.find((row) => row.previous_id == null);
			while (cursor !== undefined) {
				ordered.push(cursor);
				const current = cursor;
				cursor = subtotals.find((row) => row.previous_id === valueText(current, 'id'));
			}
			if (ordered.length !== subtotals.length)
				return yield* Effect.fail(
					new Refusal({ message: `${input.code}: subtotal chain is not linear.` })
				);
			for (const row of ordered) {
				const previous = row.previous_id == null ? null : subtotalIds.get(String(row.previous_id));
				if (row.previous_id != null && previous === undefined)
					return yield* Effect.fail(
						new Refusal({ message: `${valueText(row, 'code')}: predecessor was not copied.` })
					);
				const copied = yield* write('subtotal.create', [
					{ ...business(row), settings_id: String(draftId), previous_id: previous ?? null }
				]);
				const id = copied[0]?.id;
				if (id === undefined)
					return yield* Effect.fail(
						new Refusal({ message: `${valueText(row, 'code')}: subtotal was not created.` })
					);
				subtotalIds.set(valueText(row, 'id'), String(id));
			}
			const rebind = (row: JsonObject): JsonObject => {
				const out: Record<string, Json> = {};
				for (const key of ['subtotal_id', 'employer_cost_subtotal_id']) {
					const value = row[key];
					if (value == null) continue;
					const target = subtotalIds.get(String(value));
					if (target === undefined)
						throw new Refusal({
							message: `${key}: the copied row references a subtotal outside its version.`
						});
					out[key] = target;
				}
				return out;
			};
			for (const model of CHILDREN)
				if (model !== 'subtotal')
					yield* write(
						`${model}.create`,
						(snapshot.rows[model] ?? []).map((row) => ({
							...business(row),
							...rebind(row),
							settings_id: String(draftId)
						}))
					);
			drafts.push(`${input.code}:${draftId}`);
			if (input.merge === true)
				yield* ctx.schedule('statutory_materialize', {
					code: input.code,
					target: input.target,
					seal: String(draftId)
				});
		}
		return { drafts };
	}
});
