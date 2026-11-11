import type { Id } from '@norbital-ai/bolt';
import type { EffectCtx } from '@norbital-ai/bolt';
import { addDays, addMonths, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { accountsOf, latestLeft } from './ledger/core.js';
import { isExit, versionOn } from './payroll_engine/contract_change.js';
import {
	getErrorMessage,
	isJsonObject,
	jsonObject,
	Refusal,
	type JsonObject
} from './payroll_engine/foundation.js';
import { buildLoanSchedule, FINAL_SETTLEMENT } from './payroll_engine/loan_schedule.js';
import { idOf, objectValue, queryAllRows, queryRows } from './payroll_engine/reads.js';
import { weeklyRestDays } from './payroll_engine/rest_days.js';

/**
 * Dependants of a fact. A record the system derives from a fact names it in `occurrence_key`, `<fact>:<record id>`; the
 * one fact today is an exit, `exit:<contract id>:<last day>`. `reconcile` compares what each fact wants with what is held, the way
 * sync does for the ledger, so running it again changes nothing.
 */
const EXIT = 'exit:';
/** The key of what an exit raised: `exit:<contract>:<last day>`. A moved last day is another fact. */
export const exitKey = (contract: string, to?: string) =>
	`${EXIT}${contract}${to === undefined ? '' : `:${to}`}`;

/** A task an exit raised: a law's duty or the loan task (`…:<contract>:exit:<last day>` or `exit:<contract>:…:<last day>`). */
export const isExitDuty = (key: string) => key.includes(':exit:') || key.startsWith(EXIT);

/** The task that asks HR to reverse a cash-out a paid run took: `reverse:<leave entry id>`. */
const REVERSE = 'reverse:';
const CHAIN = ['id', 'employee_id', 'status', 'effective_range', 'entity_id'];
/** Every contract of the people who hold these contracts. */
const chainsOf = (contracts: readonly string[]) => ({
	employee_id: { is: { employee_contract: { some: { id: { in: [...contracts] } } } } }
});

/** The contracts of these chains that are exits now, each with its last day. */
export const exitsIn = (
	chain: readonly JsonObject[],
	entities: readonly JsonObject[]
): ReadonlyMap<string, string> => {
	const lineage = new Map(entities.map((row) => [String(row.id), String(row.settings_code)]));
	return new Map(
		chain
			.filter((row) => isExit(row, chain, lineage))
			.map((row) => [String(row.id), String(objectValue(row.effective_range).to)])
	);
};

/** Whether the fact a key names still stands. A record with no key, or a fact not known here, stands. */
export const stands = (key: unknown, exits: ReadonlyMap<string, string>) => {
	if (typeof key !== 'string' || !key.startsWith(EXIT)) return true;
	const [contract = '', to] = key.slice(EXIT.length).split(':');
	return exits.has(contract) && (to === undefined || exits.get(contract) === to);
};

/** A run that sealed derived entries was deleted or paid: the routine looks at their contracts again. */
export const follow = Effect.fnUntraced(function* (
	ctx: Pick<EffectCtx, 'query' | 'schedule'>,
	sealed: JsonObject
) {
	const { leave_catalog_entry: rows = [] } = yield* queryRows(ctx.query, {
		leave_catalog_entry: {
			where: { ...sealed, occurrence_key: { isNull: false } },
			fields: ['employment_id'],
			limit: 10000
		}
	});
	if (rows.length > 0)
		yield* ctx.schedule('encashment', {
			employments: [...new Set(rows.map((row) => String(row.employment_id)))].map((id) =>
				idOf('employee_contract', id)
			)
		});
});

type Slot = { readonly incurred_on: string; readonly part: 'AM' | 'PM'; readonly sealed: boolean };
/** A leave entry as the routine reads it. `OPEN` is approved and in no run; `UNPAID` and `PAID` name the run that sealed it. */
type Entry = {
	readonly id: string;
	readonly entity: string;
	readonly employment: string;
	readonly catalog: string;
	readonly code: string;
	readonly cashOut: boolean;
	readonly reverses: string | null;
	readonly key: string | null;
	readonly zone: 'PENDING' | 'OPEN' | 'UNPAID' | 'PAID';
	/** The open request that holds it, while it is `PENDING`. */
	readonly requestId: string | null;
	readonly slots: readonly Slot[];
};
const entryOf = (row: JsonObject, unpaid: ReadonlySet<string>): Entry => {
	const days = (
		Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : []
	).filter(isJsonObject);
	const runs = [row, ...days].flatMap((item) =>
		item.payroll_run_id == null ? [] : [String(item.payroll_run_id)]
	);
	const catalog = isJsonObject(row.catalog_id) ? row.catalog_id : {};
	return {
		id: String(row.id),
		entity: String(row.entity_id),
		employment: String(row.employment_id),
		catalog: String(catalog.id),
		code: String(catalog.code),
		cashOut: row.encashment === true,
		reverses: row.reverses == null ? null : String(row.reverses),
		key: typeof row.occurrence_key === 'string' ? row.occurrence_key : null,
		zone:
			row.$approval != null
				? 'PENDING'
				: runs.length === 0
					? 'OPEN'
					: runs.some((run) => unpaid.has(run))
						? 'UNPAID'
						: 'PAID',
		requestId: isJsonObject(row.$approval) ? String(row.$approval.requestId) : null,
		slots: days.map((day) => ({
			incurred_on: String(day.incurred_on),
			part: day.part === 'PM' ? 'PM' : 'AM',
			sealed: day.payroll_run_id != null
		}))
	};
};
const daysOf = (slots: readonly Slot[]) =>
	slots.map(({ incurred_on, part }) => ({ incurred_on, part }));

/**
 * One step of the routine: withdraw, then raise, then the tasks. A run takes one step, because a run reads once and a
 * write changes what it read; it answers whether another step is due, and the automation starts the next run.
 *
 * One pass over the contracts whose exit was raised, moved or cancelled: it reads afresh and takes the first step that
 * has work, each safe to repeat. Withdraw: a request still waiting, of an exit that no longer stands or sized for an
 * earlier last day, is withdrawn, one a pass; then an exit that no longer stands (or whose day moved) has its approved
 * cash-outs no run has taken deleted, and a loan schedule still holding an unpaid final settlement rebuilt. Raise: the cash-out
 * request of an exit that stands, sized after the sync that ran before it and under leave still waiting for its
 * decision. Tasks: open exit tasks that no longer stand are waived, and a cash-out a paid run took gets one task asking
 * HR to reverse it. Nothing under an unpaid run moves. It answers `false` when nothing is left to do, else the passes
 * its write adds to the run's bound: one for a withdrawn request, none for any other step.
 */
export const reconcile = Effect.fn('dependants.reconcile')(function* (
	ctx: Pick<EffectCtx, 'act' | 'approvals' | 'query' | 'today'>,
	employments: readonly Id<'employee_contract'>[]
) {
	const {
		employee_contract: chain = [],
		entity: entities = [],
		jurisdiction_settings: versions = [],
		pay_group: groups = []
	} = yield* queryRows(ctx.query, {
		employee_contract: {
			where: chainsOf(employments),
			fields: [...CHAIN, 'pay_group_id', 'exit_ground', 'terms'],
			limit: 10000
		},
		entity: { fields: ['id', 'settings_code'], limit: 10000 },
		jurisdiction_settings: {
			where: { status: { eq: 'SEALED' } },
			fields: ['id', 'code', 'effective_range'],
			limit: 10000
		},
		pay_group: { fields: ['id', 'payment_schedule'], limit: 1000 }
	});
	const asked = new Set<string>(employments);
	const contracts = chain.filter((row) => asked.has(String(row.id)));
	if (contracts.length === 0) return false as const;

	const exits = exitsIn(chain, entities);
	const lineage = new Map(entities.map((row) => [String(row.id), String(row.settings_code)]));
	const schedule = new Map(groups.map((row) => [String(row.id), row.payment_schedule]));
	// an exit that pays out: the law on its last day, and the first day of the attendance its final run holds
	const paying = new Map(
		contracts.flatMap((row) => {
			const to = exits.get(String(row.id));
			const law =
				to === undefined ? undefined : versionOn(versions, lineage.get(String(row.entity_id)), to);
			// a dismissal for misconduct pays no untaken leave
			if (to === undefined || law === undefined || row.exit_ground === 'MISCONDUCT_DISMISSAL')
				return [];
			const cutoff = Number(
				jsonObject(schedule.get(String(row.pay_group_id)) ?? {}).pay_cutoff_day ?? 1
			);
			const month = to.slice(0, 7);
			const from =
				cutoff <= 1
					? `${month}-01`
					: `${String(addMonths(`${month}-01`, -1)).slice(0, 7)}-${String(cutoff).padStart(2, '0')}`;
			return [[String(row.id), { law: String(law.id), from }] as const];
		})
	);
	const ids = contracts.map((row) => String(row.id));
	const cancelled = ids.filter((id) => !exits.has(id));
	const windows = [...paying.values()].map((item) => item.from).toSorted();
	const found = yield* queryAllRows(ctx.query, {
		leave_catalog: {
			where: { settings_id: { in: [...new Set([...paying.values()].map((item) => item.law))] } },
			fields: ['id', 'code', 'payout', 'lookup', 'settings_id'],
			limit: 10000
		},
		leave_catalog_entry: {
			where: { employment_id: { in: chain.map((row) => String(row.id)) } },
			fields: [
				'id',
				'entity_id',
				'employment_id',
				'catalog_id',
				'encashment',
				'reverses',
				'occurrence_key',
				'payroll_run_id'
			],
			limit: 10000
		},
		'leave_catalog_entry.catalog_id': { fields: ['code'] },
		'leave_catalog_entry.leave_catalog_entry_day': {
			fields: ['incurred_on', 'part', 'payroll_run_id'],
			limit: 10000
		},
		payroll_run: { where: { state: { eq: 'UNPAID' } }, fields: ['id'], limit: 10000 },
		employee_balance: {
			where: { employee_id: { in: contracts.map((row) => String(row.employee_id)) } },
			fields: ['employee_id', 'account'],
			limit: 10000
		},
		holiday: {
			where: {
				entity_id: { in: contracts.map((row) => String(row.entity_id)) },
				employee_id: { isNull: true },
				date: {
					gte: windows[0] ?? String(ctx.today),
					lte: String(addDays(PlainDate(windows.at(-1) ?? String(ctx.today)), 62))
				}
			},
			fields: ['entity_id', 'date'],
			limit: 10000
		},
		loan_catalog_entry: {
			where: { employment_id: { in: cancelled } },
			fields: ['id', 'entity_id', 'employment_id', 'quantity', 'repayment_period'],
			limit: 10000
		},
		loan_catalog_entry_repayment: {
			where: { employment_id: { in: cancelled }, reverses: { isNull: true } },
			fields: ['id', 'loan_id', 'amount', 'paid_on', 'payroll_run_id', 'payment_reference'],
			limit: 10000
		}
	});
	const unpaid = new Set((found.payroll_run ?? []).map((row) => String(row.id)));
	const held = (found.leave_catalog_entry ?? []).map((row) => entryOf(row, unpaid));
	const undone = new Set(
		held.flatMap((entry) => (entry.reverses === null ? [] : [entry.reverses]))
	);
	const account = new Map(
		(found.employee_balance ?? []).map((row) => [String(row.employee_id), row.account])
	);

	const withdraw: string[] = [];
	/** Requests still waiting that no longer answer their exit: the request, and why it is taken back. */
	const waiting = new Map<string, string>();
	const raise: JsonObject[][] = [];
	const reverse = new Map<string, JsonObject>();
	for (const row of contracts) {
		const id = String(row.id);
		const key = exitKey(id, exits.get(id));
		const pays = paying.get(id);
		const keyed = held.filter((entry) => entry.key?.startsWith(exitKey(id)) === true);
		if (!exits.has(id)) {
			withdraw.push(...keyed.filter((entry) => entry.zone === 'OPEN').map((entry) => entry.id));
			for (const entry of keyed)
				if (entry.requestId !== null) waiting.set(entry.requestId, 'The exit was cancelled.');
			// a paid run took it: the days and the money come back only through a reversal, which HR keys, once
			for (const entry of keyed)
				if (
					entry.zone === 'PAID' &&
					entry.cashOut &&
					entry.reverses === null &&
					!undone.has(entry.id)
				)
					reverse.set(`${REVERSE}${entry.id}`, {
						entity_id: entry.entity,
						employee_id: String(row.employee_id),
						employment_id: entry.employment,
						title: `Reverse the ${entry.code} cash-out a paid run took: its exit was cancelled`,
						occurrence_key: `${REVERSE}${entry.id}`
					});
			continue;
		}
		if (pays === undefined) continue;
		const terms = jsonObject(row.terms ?? {});
		const hours = Number(terms.normal_hours_per_day ?? 0);
		const accounts = accountsOf(account.get(String(row.employee_id)));
		// A leave balance is in working days. A cash-out carries the same days as slot pairs on working days of the
		// final settlement month; the contract's normal week decides the weekly rest days.
		const nonWorking = weeklyRestDays(Number(terms.normal_days_per_week ?? 5));
		const closed = new Set(
			(found.holiday ?? [])
				.filter((holiday) => holiday.entity_id === row.entity_id)
				.map((holiday) => String(holiday.date))
		);
		const working: string[] = [];
		for (let index = 0; working.length < 62 && index < 366; index += 1) {
			const date = String(addDays(PlainDate(pays.from), index));
			const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
			if (!nonWorking.has(weekday) && !closed.has(date)) working.push(date);
		}
		const own = new Set(
			chain
				.filter((other) => other.employee_id === row.employee_id)
				.map((other) => String(other.id))
		);
		const input: JsonObject[] = [];
		for (const catalog of found.leave_catalog ?? []) {
			if (
				catalog.settings_id !== pays.law ||
				typeof catalog.payout !== 'string' ||
				catalog.payout.trim() === ''
			)
				continue;
			const code = String(catalog.code);
			// a row that counts in hours cashes them out as half days of the contract's normal day
			const perDay = jsonObject(catalog.lookup ?? {}).unit === 'HOUR' && hours > 0 ? hours : 1;
			let left = latestLeft(accounts, 'leave', code) / perDay;
			if (!Number.isFinite(left)) continue;
			// leave still waiting for its decision holds its days: they are not cashed out under it
			left -= held
				.filter(
					(entry) =>
						own.has(entry.employment) &&
						entry.zone === 'PENDING' &&
						!entry.cashOut &&
						entry.reverses === null &&
						entry.code === code
				)
				.reduce((total, entry) => total + entry.slots.length / 2, 0);
			const all = held.filter(
				(entry) => entry.employment === id && entry.cashOut && entry.code === code
			);
			// raised for an earlier last day: one in no run is withdrawn and raised again for the new day, and a request
			// still waiting is withdrawn first
			const moved = keyed.filter((entry) => entry.code === code && entry.key !== key);
			const stale = moved.filter((entry) => entry.zone === 'OPEN');
			withdraw.push(...stale.map((entry) => entry.id));
			for (const entry of moved)
				if (entry.requestId !== null)
					waiting.set(
						entry.requestId,
						`The exit date moved to ${String(exits.get(id))}; the cash-out is raised again for that day.`
					);
			// one a row: a request still waiting, one a run holds, or one HR keyed stands in its place
			if (all.length > stale.length) continue;
			left += stale.reduce(
				(total, entry) => total + ((entry.reverses === null ? 1 : -1) * entry.slots.length) / 2,
				0
			);
			const halfDays = Math.round(Math.abs(left) * 2);
			if (halfDays === 0) continue;
			const base = {
				entity_id: String(row.entity_id),
				employment_id: id,
				catalog_id: String(catalog.id),
				encashment: true,
				occurrence_key: key
			};
			if (left > 0) {
				// one slot pair a working day: a single date cannot hold more than its AM and PM
				input.push({
					...base,
					leave_catalog_entry_day: working
						.flatMap((date) => [
							{ incurred_on: date, part: 'AM' },
							{ incurred_on: date, part: 'PM' }
						])
						.slice(0, halfDays)
				});
				continue;
			}
			// Leave taken beyond what the last day leaves earned is taken back the same way, reversed: a reversal of the
			// latest half days a run has paid, one reversal an entry, settled in cash by the row's payout.
			const paid = held
				.filter(
					(entry) =>
						own.has(entry.employment) &&
						!entry.cashOut &&
						entry.reverses === null &&
						!undone.has(entry.id) &&
						entry.code === code
				)
				.flatMap((entry) =>
					entry.slots.filter((slot) => slot.sealed).map((slot) => ({ ...slot, entry: entry.id }))
				)
				.toSorted((one, other) =>
					`${other.incurred_on}${other.part}`.localeCompare(`${one.incurred_on}${one.part}`)
				)
				.slice(0, halfDays);
			for (const [entry, slots] of Map.groupBy(paid, (slot) => slot.entry))
				input.push({ ...base, reverses: entry, leave_catalog_entry_day: daysOf(slots) });
		}
		raise.push(input);
	}

	// A cancelled exit's loan still holding the final settlement no run took goes back to monthly instalments.
	const remove: string[] = [];
	const instalments: JsonObject[] = [];
	const repayments = Map.groupBy(found.loan_catalog_entry_repayment ?? [], (row) =>
		String(row.loan_id)
	);
	for (const loan of found.loan_catalog_entry ?? []) {
		const rows = repayments.get(String(loan.id)) ?? [];
		if (
			!rows.some(
				(row) =>
					row.payroll_run_id == null &&
					String(row.payment_reference ?? '').startsWith(FINAL_SETTLEMENT)
			)
		)
			continue;
		const period = objectValue(loan.repayment_period);
		const plan = yield* Effect.try({
			try: () =>
				buildLoanSchedule({
					principal: Number(loan.quantity),
					from: String(period.from),
					to: String(period.to),
					repayments: rows.map((row) => ({
						id: String(row.id),
						amount: Number(row.amount),
						paid_on: String(row.paid_on),
						payroll_run_id: row.payroll_run_id == null ? null : String(row.payroll_run_id)
					}))
				}),
			catch: (error) => new Refusal({ message: getErrorMessage(error) })
		});
		remove.push(...plan.remove);
		instalments.push(
			...plan.create.map((item) => ({
				entity_id: String(loan.entity_id),
				employment_id: String(loan.employment_id),
				loan_id: String(loan.id),
				amount: item.amount,
				paid_on: item.paid_on
			}))
		);
	}

	// one step a pass: a write changes what the pass read, so the next step reads again
	const [request] = waiting;
	if (request !== undefined) {
		yield* ctx.approvals.withdraw(...request);
		return 1;
	}
	const back = [
		{ callable: 'leave_catalog_entry.delete', input: withdraw.map((target) => ({ target })) },
		{
			callable: 'loan_catalog_entry_repayment.delete',
			input: remove.map((target) => ({ target }))
		},
		{ callable: 'loan_catalog_entry_repayment.create', input: instalments }
	].filter((act) => act.input.length > 0);
	if (back.length > 0) {
		yield* ctx.act.checked(back);
		return 0;
	}
	// one request a person, held for the HR controller
	const asking = raise.find((input) => input.length > 0);
	if (asking !== undefined) {
		yield* ctx.act.checked([{ callable: 'leave_catalog_entry.create', input: asking }]);
		return 0;
	}
	// last, the tasks: read here, so nothing above waits on them. Those of an exit that no longer stands, or of an
	// earlier last day, are waived; a paid cash-out of a cancelled exit gets one task asking HR for its reversal,
	// waived once the reversal is keyed or the exit stands again.
	const { obligation: tasks = [] } = yield* queryRows(ctx.query, {
		obligation: {
			where: { employment_id: { in: ids } },
			fields: ['id', 'employment_id', 'occurrence_key', 'state', 'waiver_reason'],
			limit: 10000
		}
	});
	const raised = new Set(tasks.map((task) => String(task.occurrence_key)));
	// what this routine waived, it reopens when the fact stands again; a task HR waived for its own reason stays
	const CANCELLED = 'The exit was cancelled.';
	const MOVED = 'The exit date moved; this task answered the earlier date.';
	const SETTLED = 'The cash-out was reversed, or its exit stands again.';
	const moves = tasks.flatMap((task): JsonObject[] => {
		const key = String(task.occurrence_key);
		const to = exits.get(String(task.employment_id));
		const due = key.startsWith(REVERSE)
			? reverse.has(key)
			: isExitDuty(key) && to !== undefined && key.endsWith(`:${to}`);
		const stale = key.startsWith(REVERSE) || isExitDuty(key) ? !due : false;
		if (task.state === 'OPEN' && stale)
			return [
				{
					target: String(task.id),
					set: {
						state: 'WAIVED',
						waiver_reason: key.startsWith(REVERSE) ? SETTLED : to === undefined ? CANCELLED : MOVED
					}
				}
			];
		if (
			task.state === 'WAIVED' &&
			due &&
			[CANCELLED, MOVED, SETTLED].includes(String(task.waiver_reason))
		)
			return [{ target: String(task.id), set: { state: 'OPEN', waiver_reason: null } }];
		return [];
	});
	const ask = [...reverse].flatMap(([key, task]) => (raised.has(key) ? [] : [task]));
	const last = [
		{ callable: 'obligation.update', input: moves },
		{ callable: 'obligation.create', input: ask }
	].filter((act) => act.input.length > 0);
	if (last.length > 0) yield* ctx.act.checked(last);
	return false as const;
});
