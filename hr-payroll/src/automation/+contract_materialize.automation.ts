import { automation, type EffectCtx } from '@norbital-ai/bolt';
import { add_days, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { JsonObject } from '../lib/payroll_engine/contracts.js';
import { withChange, type ContractChange } from '../lib/payroll_engine/contract_change.js';
import { getErrorMessage, jsonObject, Refusal } from '../lib/payroll_engine/foundation.js';
import { objectValue, queryAllRows, queryRows } from '../lib/payroll_engine/reads.js';
import { raiseFailure } from '../lib/ledger/service.js';

const fromOf = (row: JsonObject) => String(objectValue(row.effective_range).from);
const changeOf = (row: JsonObject): ContractChange => ({
	field_path: String(row.field_path),
	old_value: row.old_value ?? null,
	new_value: row.new_value ?? null
});

const draftOf = Effect.fnUntraced(function* (ctx: Pick<EffectCtx, 'act'>, row: JsonObject) {
	const acts: JsonObject = { 'employee_contract.create': [row] };
	const answer = yield* ctx.act(acts);
	const written = answer.records.find((record) => record.model === 'employee_contract');
	return written === undefined ? undefined : { id: written.id, revision: written.revision };
});

/**
 * Turns the changes whose day has come into one sealed version per person and date, the way HR makes one: a draft, the
 * last version ending the day before, and the seal, which triggers sync. Payroll and the ledger never read a change.
 * A change that cannot seal stays filed and raises a task.
 */
export default automation({
	description: 'Seal contract changes whose day has come; safe to run at any time.',
	input: {},
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	run: function* (_input, ctx) {
		const { contract_change: due = [] } = yield* queryAllRows(ctx.query, {
			contract_change: {
				where: { applied_version_id: { is_null: true }, effective_from: { lte: ctx.today } },
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
				const { employee_contract: versions = [], payslip: paid = [] } = yield* queryRows(
					ctx.query,
					{
						employee_contract: {
							where: { employee_id: { eq: String(changes[0]?.employee_id) } },
							limit: 10000
						},
						// a paid run already priced the day: the change waits for HR to move it to a month still to run
						payslip: {
							where: {
								employee_id: { eq: String(changes[0]?.employee_id) },
								payroll_run_id: {
									is: {
										state: { eq: 'PAID' },
										kind: { eq: 'ON_CYCLE' },
										salary_coverage: { overlaps: { from: on, to: null } }
									}
								}
							},
							fields: ['id'],
							limit: 1
						}
					}
				);
				if (paid.length > 0)
					return yield* Effect.fail(
						new Refusal({
							message: `A paid run already covers ${on}. Move the change to the first of a month still to run.`
						})
					);
				const open = versions.find(
					(row) => row.status === 'SEALED' && objectValue(row.effective_range).to == null
				);
				if (open === undefined)
					return yield* Effect.fail(new Refusal({ message: 'No open contract version.' }));
				const next = yield* Effect.try({
					try: () => jsonObject(changes.map(changeOf).reduce(withChange, open)),
					catch: (error) => new Refusal({ message: getErrorMessage(error) })
				});
				const reason = changes.flatMap((row) => row.notes ?? []).join(' · ') || 'Scheduled change';
				const held = versions.find((row) => row.status === 'DRAFT' && fromOf(row) === on);
				const draft =
					held ??
					(yield* draftOf(ctx, {
						employee_id: open.employee_id ?? null,
						entity_id: open.entity_id ?? null,
						pay_group_id: next.pay_group_id ?? open.pay_group_id ?? null,
						engagement: next.engagement ?? null,
						employee_number: open.employee_number ?? null,
						terms: next.terms ?? null,
						payroll: next.payroll ?? null,
						bank: next.bank ?? open.bank ?? null,
						events: next.events ?? null,
						family: next.family ?? null,
						employee_extension_data: next.employee_extension_data ?? null,
						service_started_on: next.service_started_on ?? open.service_started_on ?? null,
						signed_contract_period:
							next.signed_contract_period ?? open.signed_contract_period ?? null,
						effective_range: { from: on, to: null },
						reason,
						status: 'DRAFT'
					}));
				if (draft === undefined || typeof draft.id !== 'string' || typeof open.id !== 'string')
					return yield* Effect.fail(new Refusal({ message: 'The draft version was not created.' }));
				const acts: JsonObject = {
					'employee_contract.update': [
						{
							target: open,
							set: {
								effective_range: {
									from: fromOf(open),
									to: String(add_days(PlainDate(on), -1))
								},
								reason
							}
						},
						{ target: draft, set: { status: 'SEALED' } }
					],
					'contract_change.update': changes.map((row) => ({
						target: row,
						set: { applied_version_id: draft.id }
					}))
				};
				yield* ctx.act(acts);
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
