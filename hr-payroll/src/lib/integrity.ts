import { addMonths } from '@norbital-ai/std/date';
import type { EffectCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import type { JsonObject } from './payroll_engine/foundation.js';
import { queryAllRows, type Reader } from './payroll_engine/reads.js';
import { exitsIn, isExitDuty, stands } from './dependants.js';
import {
	accountsOf,
	apply,
	isMeasure,
	isPeriodKey,
	leftIn,
	type Accounts,
	type Movement
} from './ledger/core.js';

/**
 * What the ledger must always be, checked from outside its service. Hard findings: a balance figure that is not the sum
 * of its ledger rows (`H1`), a ledger source that still holds something and no longer exists (`H3`), an entry sealed
 * by a run that has no payslip for its person (`H6`), an open exit task on a contract that is no exit or whose last day
 * moved (`H9`), an approved derived entry no run has taken whose fact no longer stands (`H10`). A watch: an entitlement
 * or what is left of it below zero (`W1`).
 * It reads and reports; it repairs nothing.
 */
export type Finding = {
	readonly invariant: 'H1' | 'H3' | 'H6' | 'H9' | 'H10' | 'W1';
	readonly subject: string;
	readonly message: string;
	readonly employee_id?: string;
};
export type Workspace = Readonly<Record<string, readonly JsonObject[]>>;

const ENTRIES = ['leave_catalog_entry', 'claim_catalog_entry', 'adhoc_catalog_entry'] as const;
/** The months a paid run stays watched: an older one is locked and long settled. */
const WATCHED_MONTHS = 2;
const nothing = (value: number) => Math.abs(value) < 1e-8;
const flat = (accounts: Accounts) =>
	Object.entries(accounts).flatMap(([account, codes]) =>
		Object.entries(codes).flatMap(([code, periods]) =>
			Object.entries(periods).flatMap(([period, measures]) =>
				Object.entries(measures).map(
					([measure, value]) => [[account, code, period, measure].join('/'), value] as const
				)
			)
		)
	);
/** What these ledger rows hold, by `account/code/period/measure`: the ledger's own fold. */
const held = (rows: readonly JsonObject[]) =>
	new Map(
		flat(
			apply(
				{},
				rows.flatMap((row): Movement[] =>
					isPeriodKey(row.period) && isMeasure(row.measure)
						? [
								{
									account: String(row.account),
									code: String(row.code),
									period: row.period,
									measure: row.measure,
									operation: row.operation === 'DEDUCT' ? 'DEDUCT' : 'ADD',
									amount: Number(row.amount ?? 0),
									effective_on: String(row.effective_on),
									source: String(row.source)
								}
							]
						: []
				)
			)
		)
	);

/** The findings in a workspace's rows as read on `today`. */
export const findings = (rows: Workspace, today: string): readonly Finding[] => {
	const found: Finding[] = [];
	const ledger = rows.ledger_entry ?? [];
	const byBalance = Map.groupBy(ledger, (row) => String(row.balance_id));
	for (const balance of rows.employee_balance ?? []) {
		const id = String(balance.id);
		const employee_id = String(balance.employee_id);
		const accounts = accountsOf(balance.account);
		const stands = new Map(flat(accounts));
		const says = held(byBalance.get(id) ?? []);
		for (const key of new Set([...stands.keys(), ...says.keys()])) {
			const [figure, sum] = [stands.get(key) ?? 0, says.get(key) ?? 0];
			if (!nothing(figure - sum))
				found.push({
					invariant: 'H1',
					subject: `${id}/${key}`,
					employee_id,
					message: `The balance holds ${figure} at ${key}; its ledger rows sum to ${sum}.`
				});
		}
		for (const [account, codes] of Object.entries(accounts))
			for (const [code, periods] of Object.entries(codes))
				for (const [period, measures] of Object.entries(periods)) {
					// a window with no figure of its own is unlimited or not yet opened: nothing to fall below
					const figured =
						measures.entitled !== undefined ||
						measures.carried !== undefined ||
						measures.limit !== undefined;
					const left = leftIn(measures);
					if ((measures.entitled ?? 0) < 0 || (figured && left < 0 && !nothing(left)))
						found.push({
							invariant: 'W1',
							subject: `${id}/${account}/${code}/${period}`,
							employee_id,
							message: `${code} is over-taken in ${period}: ${measures.entitled ?? 0} entitled, ${left} left.`
						});
				}
	}

	const exists = new Map(
		[...ENTRIES, 'payroll_run'].map((model) => [
			model,
			new Set((rows[model] ?? []).map((row) => String(row.id)))
		])
	);
	for (const [source, posted] of Map.groupBy(ledger, (row) => String(row.source))) {
		// a retention row empties an old key; no record stands behind it
		if (source.startsWith('retention:')) continue;
		const live = [...Map.groupBy(posted, (row) => String(row.balance_id)).values()].some(
			(own) => ![...held(own).values()].every(nothing)
		);
		if (!live) continue;
		const at = source.indexOf(':');
		const [kind, id] = [source.slice(0, at), source.slice(at + 1)];
		const there =
			kind === 'entitlement'
				? posted.every((row) => id.startsWith(`${String(row.balance_id)}:`))
				: kind === 'manual'
					? posted.every((row) => row.id === id)
					: exists.get(kind)?.has(id) === true;
		if (!there)
			found.push({
				invariant: 'H3',
				subject: source,
				message: `The ledger still holds what ${source} posted, and that record is gone.`
			});
	}

	const since = String(addMonths(today, -WATCHED_MONTHS));
	const watched = new Set(
		(rows.payroll_run ?? [])
			.filter((run) => run.state !== 'PAID' || String(run.pay_date) >= since)
			.map((run) => String(run.id))
	);
	const person = new Map(
		(rows.employee_contract ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	const paid = new Set(
		(rows.payslip ?? []).map((row) => `${String(row.payroll_run_id)}/${String(row.employee_id)}`)
	);
	for (const model of ENTRIES)
		for (const entry of rows[model] ?? []) {
			const run = String(entry.payroll_run_id);
			const employee_id = person.get(String(entry.employment_id));
			if (watched.has(run) && !paid.has(`${run}/${employee_id}`))
				found.push({
					invariant: 'H6',
					subject: `${model}:${String(entry.id)}`,
					...(employee_id === undefined ? {} : { employee_id }),
					message: `A run sealed ${model} ${String(entry.id)} and holds no payslip for its person.`
				});
		}

	const exits = exitsIn(rows.employee_contract ?? [], rows.entity ?? []);
	for (const task of rows.obligation ?? []) {
		const key = String(task.occurrence_key);
		const to = exits.get(String(task.employment_id));
		if (
			task.employment_id != null &&
			isExitDuty(key) &&
			(to === undefined || !key.endsWith(`:${to}`))
		)
			found.push({
				invariant: 'H9',
				subject: `obligation:${String(task.id)}`,
				message: `The exit task ${key} is open and its exit ${to === undefined ? 'no longer stands' : 'moved'}.`
			});
	}
	for (const entry of rows.leave_catalog_entry ?? []) {
		if (stands(entry.occurrence_key, exits)) continue;
		const employee_id = person.get(String(entry.employment_id));
		const subject = `leave_catalog_entry:${String(entry.id)}`;
		// one still waiting is the routine's to withdraw on its pass
		if (entry.$approval == null && entry.payroll_run_id == null)
			found.push({
				invariant: 'H10',
				subject,
				...(employee_id === undefined ? {} : { employee_id }),
				message: `No run has paid ${subject} and the exit it was raised for no longer stands.`
			});
	}
	return found;
};

/** Reads the workspace in one request, every root in pages, and answers its findings. */
export const verify = Effect.fn('integrity.verify')(function* (read: Reader, today: string) {
	const sealed = { fields: ['id', 'employment_id', 'payroll_run_id'], limit: 10000 };
	const rows = yield* queryAllRows(
		read,
		{
			employee_balance: { fields: ['id', 'employee_id', 'account'], limit: 10000 },
			// ponytail: every ledger row is read; bucket by key in the database once `aggregate` takes a ref (`balance_id`) in `by`
			ledger_entry: {
				fields: [
					'id',
					'balance_id',
					'source',
					'operation',
					'account',
					'code',
					'period',
					'measure',
					'amount',
					'effective_on'
				],
				limit: 10000
			},
			leave_catalog_entry: { ...sealed, fields: [...sealed.fields, 'occurrence_key'] },
			claim_catalog_entry: sealed,
			adhoc_catalog_entry: sealed,
			payroll_run: { fields: ['id', 'state', 'pay_date'], limit: 10000 },
			payslip: {
				where: {
					payroll_run_id: {
						is: {
							or: [
								{ state: { eq: 'UNPAID' } },
								{ pay_date: { gte: String(addMonths(today, -WATCHED_MONTHS)) } }
							]
						}
					}
				},
				fields: ['payroll_run_id', 'employee_id'],
				limit: 10000
			},
			employee_contract: {
				fields: ['id', 'employee_id', 'status', 'effective_range', 'entity_id'],
				limit: 10000
			},
			entity: { fields: ['id', 'settings_code'], limit: 10000 },
			obligation: {
				where: { state: { eq: 'OPEN' }, employment_id: { isNull: false } },
				fields: ['id', 'employment_id', 'occurrence_key'],
				limit: 10000
			}
		},
		1_000_000
	);
	return findings(rows, today);
});

/**
 * The check, run at the end of the ledger's whole pass: one task per finding, keyed `integrity:<invariant>:<subject>`.
 * A finding with an open task raises nothing; one that comes back after its task was closed raises a dated one. It
 * writes nothing else and repairs nothing.
 */
export const raiseFindings = Effect.fn('integrity.raiseFindings')(function* (
	ctx: Pick<EffectCtx, 'act' | 'query' | 'today'>
) {
	const today = String(ctx.today);
	const found = yield* verify(ctx.query, today);
	if (found.length === 0) return;
	const { entity: entities = [], obligation: raised = [] } = yield* queryAllRows(ctx.query, {
		entity: { fields: ['id'], limit: 1 },
		obligation: {
			where: { occurrence_key: { like: 'integrity:%' } },
			fields: ['occurrence_key', 'state'],
			limit: 10000
		}
	});
	const [entity] = entities;
	if (entity === undefined) return;
	const taken = new Set(raised.map((row) => String(row.occurrence_key)));
	const open = new Set(
		raised
			.filter((row) => row.state === 'OPEN')
			.map((row) => String(row.occurrence_key).split('@')[0])
	);
	const due = found.flatMap((finding) => {
		const base = `integrity:${finding.invariant}:${finding.subject}`;
		const occurrence_key = taken.has(base) ? `${base}@${today}` : base;
		return open.has(base) || taken.has(occurrence_key)
			? []
			: [
					{
						entity_id: String(entity.id),
						...(finding.employee_id === undefined ? {} : { employee_id: finding.employee_id }),
						title: `Ledger check: ${finding.message}`,
						occurrence_key
					}
				];
	});
	if (due.length > 0) yield* ctx.act.checked([{ callable: 'obligation.create', input: due }]);
});
