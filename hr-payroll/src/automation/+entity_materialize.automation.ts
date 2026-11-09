import { automation } from '@norbital-ai/bolt';
import { addDays, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { withChange } from '../lib/payroll_engine/contract_change.js';
import { getErrorMessage, jsonObject, Refusal } from '../lib/payroll_engine/foundation.js';
import { objectValue, queryAllRows, queryRows } from '../lib/payroll_engine/reads.js';
import { raiseFailure } from '../lib/ledger/service.js';

const fromOf = (row: { readonly [key: string]: unknown }) =>
	String(objectValue(row.effective_range).from);
const covers = (row: { readonly [key: string]: unknown }, day: string) => {
	const { from, to } = objectValue(row.effective_range);
	return String(from) <= day && (typeof to !== 'string' || day <= to);
};

/**
 * Turns filed employer changes whose day has come into one sealed version per entity and date. The open version ends the
 * day before; payroll keeps reading the sealed version, never the change.
 */
export default automation('entity_materialize', {
	description: 'Seal employer changes whose day has come; safe to run at any time.',
	input: {},
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	run: function* (_input, ctx) {
		const { entity_change: due = [] } = yield* queryAllRows(ctx.query, {
			entity_change: {
				where: { applied_version_id: { isNull: true }, effective_from: { lte: ctx.today } },
				limit: 1000
			}
		});
		const groups = Map.groupBy(
			due,
			(row) => `${String(row.entity_id)}/${String(row.effective_from)}`
		);
		for (const key of [...groups.keys()].toSorted()) {
			const changes = groups.get(key) ?? [];
			const on = String(changes[0]?.effective_from);
			yield* Effect.gen(function* () {
				const { entity_profile_version: versions = [] } = yield* queryRows(ctx.query, {
					entity_profile_version: {
						where: { entity_id: { eq: String(changes[0]?.entity_id) } },
						limit: 10000
					}
				});
				const open = versions.find((row) => objectValue(row.effective_range).to == null);
				if (open === undefined)
					return yield* Effect.fail(new Refusal({ message: 'No open employer version.' }));
				const next = yield* Effect.try({
					try: () =>
						jsonObject(
							changes
								.map((row) => ({
									field_path: String(row.field_path),
									old_value: row.old_value ?? null,
									new_value: row.new_value ?? null
								}))
								.reduce(withChange, jsonObject(open))
						),
					catch: (error) => new Refusal({ message: getErrorMessage(error) })
				});
				const { jurisdiction_settings: lineage = [] } = yield* queryRows(ctx.query, {
					jurisdiction_settings: {
						where: {
							code: { eq: String(open.settings_code) },
							status: { eq: 'SEALED' }
						},
						fields: ['effective_range'],
						limit: 100
					}
				});
				const reason = changes.flatMap((row) => row.notes ?? []).join(' · ') || 'Scheduled change';
				const held = versions.find(
					(row) => row.status === 'DRAFT' && fromOf(row) === on
				);
				const draft =
					held?.id ??
					(yield* ctx.act.checked([
						{
							callable: 'entity_profile_version.create',
							input: [
								{
									entity_id: open.entity_id ?? null,
									name: next.name ?? open.name ?? null,
									representative_name: next.representative_name ?? null,
									registered_address: next.registered_address ?? null,
									settings_code: open.settings_code ?? null,
									input_schema_version_id:
										lineage.find((row) => covers(row, on))?.id ??
										open.input_schema_version_id ??
										null,
									time_zone: next.time_zone ?? null,
									final_pay_loan_floor_percent:
										next.final_pay_loan_floor_percent ?? 10,
									overtime_full_award_percent:
										next.overtime_full_award_percent ?? 100,
									bank: next.bank ?? open.bank ?? null,
									entity_extension_data: next.entity_extension_data ?? {},
									effective_range: { from: on, to: null },
									reason,
									status: 'DRAFT'
								}
							]
						}
					])).records.find((written) => written.model === 'entity_profile_version')?.id;
				if (typeof draft !== 'string' || typeof open.id !== 'string')
					return yield* Effect.fail(new Refusal({ message: 'The draft version was not created.' }));
				yield* ctx.act.checked([
					{
						callable: 'entity_profile_version.update',
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
						callable: 'entity_profile_version.update',
						input: [{ target: draft, set: { status: 'SEALED' } }]
					},
					{
						callable: 'entity_change.update',
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
						`${String(changes[0]?.entity_id)} on ${on}`,
						getErrorMessage(error),
						'Employer change failed'
					)
				)
			);
		}
	}
});
