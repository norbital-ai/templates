import { automation, type EffectCtx } from '@norbital-ai/bolt';
import { addDays, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { JsonObject } from '../lib/payroll_engine/contracts.js';
import { withChange, type ContractChange } from '../lib/payroll_engine/contract_change.js';
import { getErrorMessage, jsonObject, Refusal } from '../lib/payroll_engine/foundation.js';
import { objectValue, queryAllRows, queryRows } from '../lib/payroll_engine/reads.js';
import { raiseFailure } from '../lib/ledger/service.js';

const fromOf = (row: JsonObject) => String(objectValue(row.effective_range).from);
const covers = (row: JsonObject, day: string) => {
	const { from, to } = objectValue(row.effective_range);
	return String(from) <= day && (typeof to !== 'string' || day <= to);
};
const changeOf = (row: JsonObject): ContractChange => ({
	field_path: String(row.field_path),
	old_value: row.old_value ?? null,
	new_value: row.new_value ?? null
});

const draftOf = Effect.fnUntraced(function* (ctx: Pick<EffectCtx, 'act'>, row: JsonObject) {
	const answer = yield* ctx.act.checked([{ callable: 'employee_contract.create', input: [row] }]);
	return answer.records.find((written) => written.model === 'employee_contract')?.id;
});

/**
 * Turns the changes whose day has come into one sealed version per person and date, the way HR makes one: a draft, the
 * last version ending the day before, and the seal, which triggers sync. Payroll and the ledger never read a change.
 * A change that cannot seal stays filed and raises a task.
 */
export default automation('contract_materialize', {
	description: 'Seal contract changes whose day has come; safe to run at any time.',
	input: {},
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	run: function* (_input, ctx) {
		const { contract_change: due = [] } = yield* queryAllRows(ctx.query, {
			contract_change: {
				where: { applied_version_id: { isNull: true }, effective_from: { lte: ctx.today } },
				limit: 1000
			}
		});
		const groups = Map.groupBy(
			due,
			(row) => `${String(row.employee_id)}/${String(row.effective_from)}`
		);
		for (const key of [...groups.keys()].toSorted()) {
			const changes = groups.get(key) ?? [];
			const on = String(changes[0]?.effective_from);
			yield* Effect.gen(function* () {
				const { employee_contract: versions = [] } = yield* queryRows(ctx.query, {
					employee_contract: {
						where: { employee_id: { eq: String(changes[0]?.employee_id) } },
						limit: 10000
					}
				});
				const open = versions.find(
					(row) => row.status === 'SEALED' && objectValue(row.effective_range).to == null
				);
				if (open === undefined)
					return yield* Effect.fail(new Refusal({ message: 'No open contract version.' }));
				const next = yield* Effect.try({
					try: () => jsonObject(changes.map(changeOf).reduce(withChange, open)),
					catch: (error) => new Refusal({ message: getErrorMessage(error) })
				});
				const { jurisdiction_settings: law = [] } = yield* queryRows(ctx.query, {
					jurisdiction_settings: {
						where: { id: { eq: String(open.input_schema_version_id) } },
						fields: ['code'],
						limit: 1
					}
				});
				const { jurisdiction_settings: lineage = [] } = yield* queryRows(ctx.query, {
					jurisdiction_settings: {
						where: { code: { eq: String(law[0]?.code) }, status: { eq: 'SEALED' } },
						fields: ['effective_range'],
						limit: 100
					}
				});
				const reason = changes.flatMap((row) => row.notes ?? []).join(' · ') || 'Scheduled change';
				const held = versions.find((row) => row.status === 'DRAFT' && fromOf(row) === on);
				const draft =
					held?.id ??
					(yield* draftOf(ctx, {
						employee_id: open.employee_id ?? null,
						entity_id: open.entity_id ?? null,
						engagement: next.engagement ?? null,
						employee_number: open.employee_number ?? null,
						terms: next.terms ?? null,
						payroll: next.payroll ?? null,
						bank: next.bank ?? open.bank ?? null,
						children: next.children ?? null,
						events: next.events ?? null,
						dependents_count: next.dependents_count ?? null,
						only_child: next.only_child ?? null,
						input_schema_version_id:
							lineage.find((row) => covers(row, on))?.id ?? open.input_schema_version_id ?? null,
						employee_extension_data: next.employee_extension_data ?? null,
						service_started_on: next.service_started_on ?? open.service_started_on ?? null,
						signed_contract_period:
							next.signed_contract_period ?? open.signed_contract_period ?? null,
						effective_range: { from: on, to: null },
						reason,
						status: 'DRAFT'
					}));
				if (typeof draft !== 'string' || typeof open.id !== 'string')
					return yield* Effect.fail(new Refusal({ message: 'The draft version was not created.' }));
				yield* ctx.act.checked([
					{
						callable: 'employee_contract.update',
						input: [
							{
								target: open.id,
								set: {
									effective_range: {
										from: fromOf(open),
										to: String(addDays(PlainDate(on), -1))
									},
									reason
								}
							}
						]
					},
					{
						callable: 'employee_contract.update',
						input: [{ target: draft, set: { status: 'SEALED' } }]
					},
					{
						callable: 'contract_change.update',
						input: changes.map((row) => ({
							target: String(row.id),
							set: { applied_version_id: draft }
						}))
					}
				]);
			}).pipe(
				Effect.catch((error) =>
					raiseFailure(
						ctx,
						`${String(changes[0]?.employee_id)} on ${on}`,
						getErrorMessage(error),
						'Contract change failed'
					)
				)
			);
		}
	}
});
