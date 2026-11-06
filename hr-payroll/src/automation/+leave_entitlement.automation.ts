import { automation } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { NO_CAP_DAYS, settleLeave, type LeaveRow } from '../lib/leave/entitlement.js';
import { isJsonObject, type Json } from '../lib/payroll_engine/foundation.js';
import { objectValue, queryAllRows } from '../lib/payroll_engine/reads.js';

const BATCH = 50;
const numbers = (value: unknown): Record<string, number> =>
	Object.fromEntries(
		Object.entries(isJsonObject(value) ? value : {}).map(([key, item]) => [key, Number(item)])
	);
const plain = (value: unknown) => (isJsonObject(value) ? value : {});
const covers = (range: unknown, day: string) => {
	const { from, to } = objectValue(range);
	return String(from) <= day && (typeof to !== 'string' || day <= to);
};

/**
 * One service, scoped by what it is given. With `employees`, those people: a contract changed, or the HR controller ran
 * it from a profile. Without, everyone: 1 January, a catalog change, a paid run. Either way it writes only what differs,
 * so running it again changes nothing.
 */
export default automation('leave_entitlement', {
	description: "Compute everyone's leave from the catalog; safe to run at any time.",
	input: {
		employees: {
			kind: 'list',
			of: { kind: 'id', of: 'employee_profile' },
			optional: true
		}
	},
	on: { cron: '0 0 1 1 *' },
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	run: function* ({ employees }, ctx) {
		const settle = Effect.gen(function* () {
			const day = String(ctx.today);
			const read = yield* queryAllRows(ctx.query, {
				employee_contract: {
					where: { status: { eq: 'SEALED' } },
					fields: [
						'employee_id',
						'effective_range',
						'service_started_on',
						'entity_id',
						'engagement',
						'payroll',
						'terms',
						'employee_extension_data',
						'input_schema_version_id'
					],
					limit: 1000
				},
				entity_profile_version: {
					where: { status: { eq: 'SEALED' } },
					fields: ['entity_id', 'effective_range', 'entity_extension_data'],
					limit: 1000
				},
				jurisdiction_settings: {
					where: { status: { eq: 'SEALED' } },
					fields: ['code', 'effective_range'],
					limit: 1000
				},
				employee_balance: {
					...(employees == null ? {} : { where: { employee_id: { in: [...employees] } } }),
					fields: ['employee_id', 'account', 'revision'],
					limit: 1000
				}
			});
			const versions = read.jurisdiction_settings ?? [];
			const inForce = new Map(
				versions.map((row) => [
					String(row.id),
					versions.find((other) => other.code === row.code && covers(other.effective_range, day))
						?.id
				])
			);
			const ids = [
				...new Set([...inForce.values()].flatMap((id) => (id == null ? [] : [String(id)])))
			];
			const { leave_catalog: catalog = [] } = yield* queryAllRows(ctx.query, {
				leave_catalog: {
					where: { settings_id: { in: ids } },
					fields: ['settings_id', 'code', 'lookup'],
					limit: 1000
				}
			});
			const rowsOf = Map.groupBy(
				catalog.map((row) => ({
					settings: String(row.settings_id),
					code: String(row.code),
					lookup: objectValue(row.lookup)
				})),
				(row) => row.settings
			);
			const current = new Map(
				(read.employee_contract ?? [])
					.filter((row) => covers(row.effective_range, day))
					.toSorted((left, right) =>
						String(objectValue(left.effective_range).from).localeCompare(
							String(objectValue(right.effective_range).from)
						)
					)
					.map((row) => [String(row.employee_id), row])
			);
			const stateOwned = new Set(
				(read.entity_profile_version ?? [])
					.filter(
						(row) =>
							covers(row.effective_range, day) &&
							plain(row.entity_extension_data).state_owned === true
					)
					.map((row) => String(row.entity_id))
			);
			const changes = (read.employee_balance ?? []).flatMap((balance) => {
				const contract = current.get(String(balance.employee_id));
				if (contract === undefined) return [];
				const rows: readonly LeaveRow[] =
					rowsOf.get(String(inForce.get(String(contract.input_schema_version_id)))) ?? [];
				const account = objectValue(balance.account);
				const payroll = objectValue(contract.payroll);
				const windows = numbers(account.leave_window);
				const result = settleLeave(
					rows,
					{
						started: String(
							contract.service_started_on ?? objectValue(contract.effective_range).from
						),
						partTime: contract.engagement === 'PART_TIME',
						gender: typeof payroll.gender === 'string' ? payroll.gender : null,
						maritalStatus:
							typeof payroll.marital_status === 'string' ? payroll.marital_status : null,
						terms: plain(contract.terms),
						facts: plain(plain(contract.employee_extension_data).term_facts),
						stateOwned: stateOwned.has(String(contract.entity_id))
					},
					{ leave: numbers(account.leave), windows },
					day
				);
				const same =
					result.moves.length === 0 && JSON.stringify(result.windows) === JSON.stringify(windows);
				return same ? [] : [{ balance, account, result }];
			});
			for (let at = 0; at < changes.length; at += BATCH) {
				const batch = changes.slice(at, at + BATCH);
				const ledger: Json[] = batch.flatMap(({ balance, result }) =>
					result.moves.map(({ code, operation, amount }) => ({
						balance_id: String(balance.id),
						operation,
						account: 'leave',
						code,
						amount,
						unit: 'DAY',
						effective_on: day
					}))
				);
				const updates: Json[] = batch.map(({ balance, account, result }) => ({
					target: String(balance.id),
					set: { account: { ...account, leave: result.leave, leave_window: result.windows } }
				}));
				// a person's movements and their balance commit together, or a rerun starts again from what stands
				yield* ctx.act.checked([
					...(ledger.length === 0 ? [] : [{ callable: 'ledger_entry.create', input: ledger }]),
					{
						callable: 'employee_balance.update',
						input: updates,
						observed: Object.fromEntries(
							batch.map(({ balance }) => [String(balance.id), Number(balance.revision)])
						)
					}
				]);
			}
			return { people: changes.length, cap: NO_CAP_DAYS };
		});
		// payroll writes balances too: a lost race ends this run, and the next one starts from what stands
		yield* settle;
	}
});
