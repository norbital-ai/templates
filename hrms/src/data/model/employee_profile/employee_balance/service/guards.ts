import { BigDecimal, Effect } from 'effect';
import { Refusal, isJsonObject, type JsonObject } from '../../../../../lib/foundation.js';
import { idsOf, objectValue, queryRows, type Reader } from '../../../../../lib/reads.js';
import { accountsOf, eventsOf, leftIn, openedBy, unlimited, type Wanted } from './core.js';
import { employerOn } from '../../../entity/service/company.js';
import { chainOf, employmentOn, leaveDaysOf, startsOf } from '../../service/person.js';
import { lawRead, lawsOf, type Law } from '../../../jurisdiction/service/law.js';
import { leaveOffDay } from '../../../roster_entry/service/attendance.js';
import {
	FIELDS,
	LEAVE,
	MANUAL,
	covers,
	manualOf,
	refuse,
	undone,
	uniqueIds,
	type Plan
} from './ledger_store.js';
import { eventPeriods, grantsOf, opened } from './posting_plans.js';
import { entryPlans, known, lawOf, personOf, rowOfCatalog, type Known } from './entry_postings.js';

const sourceOf = (row: JsonObject) => `${LEAVE}:${String(row.id)}`;
/**
 * The half-days of an entry, as `person/date/part`: a person's leave is one calendar across their stints. A stored
 * entry's slots are its captured children; an entry being written carries them on `days`.
 */
const slotsOf = (known: Known, row: JsonObject) => [
	...new Set(
		[...(known.captures.get(String(row.id)) ?? []), ...(Array.isArray(row.days) ? row.days : [])]
			.filter(isJsonObject)
			.map(
				(day) =>
					`${String(known.parts.get(String(row.employment_id))?.stint.employee_id)}/${String(day.date ?? day.incurred_on)}/${String(day.part)}`
			)
	)
];
/** The half-days the people's stored leave already covers (`person/date/part`), but for the entries being `replaced`. */
export const leaveTaken = (known: Known, replaced: readonly JsonObject[] = []) => {
	const gone = new Set(replaced.map((row) => String(row.id)));
	return new Set(
		known.entries
			.filter((row) => row.encashment !== true && !gone.has(String(row.id)))
			.flatMap((row) => slotsOf(known, row))
	);
};
/**
 * Why a leave entry may not commit, if it may not: a half-day other leave covers, or a window it draws on without the
 * days. The balance does not show an entry held for approval, so a held one counts here. The form asks it as the write
 * does.
 */
export const leaveShort = (
	known: Known,
	entries: readonly JsonObject[],
	today: string,
	replaced: readonly JsonObject[] = []
): string | undefined => {
	const taking = entries.filter((row) => row.encashment !== true);
	const ids = uniqueIds(entries, 'employment_id');
	const held = known.entries;
	const taken = leaveTaken(known, replaced);
	for (const slot of taking.flatMap((row) => slotsOf(known, row))) {
		if (taken.has(slot)) return `Leave already covers ${slot.split('/')[1]}.`;
		taken.add(slot);
	}
	const open = held.filter(
		(row) => row.payroll_run_id == null && ids.includes(String(row.employment_id))
	);
	const posted = new Set(known.posted.map((row) => String(row.source)));
	const editing = new Set(replaced.map(sourceOf));
	const waiting = open.filter((row) => !posted.has(sourceOf(row)) && !editing.has(sourceOf(row)));
	const undone = replaced.filter((row) => posted.has(sourceOf(row)));
	const plans = entryPlans(known, 'leave', LEAVE, entries);
	if (plans.length === 0) return undefined;
	const limited = new Map<string, boolean>();
	const opened = new Set<string>();
	for (const entry of entries)
		for (const row of lawOf(known, entry)?.rows.leave_catalog ?? []) {
			limited.set(String(row.code), !unlimited(objectValue(row.lookup)));
			if (Object.keys(openedBy(objectValue(row.lookup))).length > 0) opened.add(String(row.code));
		}
	const accounts = new Map(
		[...known.balance.values()].map((row) => [String(row.id), accountsOf(row.account)])
	);
	const drawn = new Map<string, { row: Wanted; amount: number }>();
	for (const plan of plans)
		for (const row of plan.wanted) {
			if (limited.get(row.code) !== true) continue;
			const key = [plan.balance_id, row.code, row.period].join('/');
			drawn.set(key, { row, amount: (drawn.get(key)?.amount ?? 0) + row.amount });
		}
	const adjust = (others: readonly Plan[], sign: 1 | -1) => {
		for (const plan of others)
			for (const row of plan.wanted) {
				const key = [plan.balance_id, row.code, row.period].join('/');
				const held = drawn.get(key);
				if (held !== undefined)
					drawn.set(key, { ...held, amount: held.amount + sign * row.amount });
			}
	};
	adjust(entryPlans(known, 'leave', LEAVE, waiting), 1);
	adjust(entryPlans(known, 'leave', LEAVE, undone), -1);
	for (const [key, { row, amount }] of drawn) {
		if (amount <= 0) continue;
		const balance = key.slice(0, key.indexOf('/'));
		const measures = accounts.get(balance)?.[row.account]?.[row.code]?.[row.period];
		// a window no sync has opened yet has nothing to refuse against
		const unopened = opened.has(row.code) && !row.period.includes('.E.');
		if (measures === undefined && row.effective_on > today && !unopened) continue;
		const remaining = leftIn(measures);
		if (
			BigDecimal.isNegative(
				BigDecimal.round(BigDecimal.fromNumberUnsafe(remaining - amount), { scale: 8 })
			)
		)
			return `${row.code}: insufficient balance.`;
	}
	return undefined;
};
export const assertLeft = (...given: Parameters<typeof leaveShort>) =>
	Effect.suspend(() => refuse(leaveShort(...given)));

/**
 * Why these leave days may not be taken, if they may not: leave is taken on days the person works, so a rest day or a
 * holiday of theirs is refused. A row counted in calendar days takes every day.
 */
export const leaveOff = (known: Known, entries: readonly JsonObject[]): string | undefined => {
	for (const entry of entries) {
		const held = known.parts.get(String(entry.employment_id));
		const row = lawOf(known, entry)?.rows.leave_catalog.find(
			(item) => item.code === entry.catalog_code
		);
		if (
			held === undefined ||
			entry.encashment === true ||
			objectValue(row?.lookup).unit === 'CALENDAR_DAY'
		)
			continue;
		const own = leaveDaysOf(held, known.plan);
		for (const day of (Array.isArray(entry.days) ? entry.days : []).filter(isJsonObject)) {
			const date = String(day.date ?? day.incurred_on);
			const off = leaveOffDay(date, own);
			if (off !== undefined)
				return off === 'HOLIDAY'
					? `${date} is a holiday: no leave is taken on it.`
					: `${date} is a rest day: no leave is taken on it.`;
		}
	}
	return undefined;
};
export const assertWorked = (...given: Parameters<typeof leaveOff>) =>
	Effect.suspend(() => refuse(leaveOff(...given)));
/** A cash-out pays its row's `payout`: a row that declares none has nothing a run could pay for the days drawn. */
export const assertCashable = Effect.fn('ledger.assertCashable')(function* (
	known: Known,
	entries: readonly JsonObject[]
) {
	const rowOf = (entry: JsonObject) =>
		lawOf(known, entry)?.rows.leave_catalog.find((item) => item.code === entry.catalog_code);
	const bare = entries.find((entry) => {
		const payout = rowOf(entry)?.payout;
		return entry.encashment === true && (typeof payout !== 'string' || payout.trim() === '');
	});
	if (bare !== undefined)
		return yield* Effect.fail(
			new Refusal({
				message: `${String(rowOf(bare)?.code ?? 'This leave')} has no payout, so its days cannot be cashed out. Take them as leave, or give the row a payout.`
			})
		);
});

/**
 * The check before a person's facts change: a fact the write drops must not leave days taken under it with nothing
 * behind them. Each `employment` is a stint as the write leaves it (`employmentOn`), read under its company's law on
 * `on`. A caller that has read those laws passes them (`laws`).
 */
export const assertFactsHold = Effect.fn('ledger.assertFactsHold')(function* (
	read: Reader,
	facts: readonly { readonly employment: JsonObject; readonly on: string }[],
	laws?: (code: unknown, day: string) => Law | undefined
) {
	if (facts.length === 0) return;
	const views = facts.map(({ employment }) => employment);
	const people = idsOf('employee_profile', uniqueIds(views, 'employee_id'));
	const companyIds = idsOf('entity', uniqueIds(views, 'entity_id'));
	const {
		employee_balance: balances = [],
		ledger_entry: manualRows = [],
		entity: companies = [],
		entity_change: companyChanges = [],
		employment: stored = []
	} = yield* queryRows(read, {
		employment: {
			where: { employee_id: { in: people } },
			fields: ['employee_id', 'effective_range', 'entity_id'],
			limit: 10000,
			entity_id: { fields: ['settings_code'] },
			employee_id: { fields: ['cumulative_service'] }
		},
		employee_balance: {
			where: { employee_id: { in: people } },
			fields: ['employee_id', 'account'],
			limit: 10000
		},
		ledger_entry: {
			where: { ...MANUAL, balance_id: { is: { employee_id: { in: people } } } },
			fields: FIELDS,
			limit: 10000
		},
		entity: { where: { id: { in: companyIds } }, fields: ['id', 'settings_code'], limit: 50 },
		entity_change: { where: { entity_id: { in: companyIds } }, limit: 10000 }
	});
	const held = chainOf(stored);
	const lineage = new Map([
		...held.lineage,
		...companies.map((row) => [row.id, row.settings_code] as const)
	]);
	const lawIn =
		laws ?? lawsOf(yield* queryRows(read, lawRead(companies.map((row) => row.settings_code))));
	const manual = manualOf(manualRows);
	const balance = new Map(balances.map((row) => [String(row.employee_id), row]));
	for (const { employment, on } of facts) {
		const law = lawIn(lineage.get(String(employment.entity_id)), on);
		const entity = companies.find((row) => row.id === employment.entity_id);
		// each reads its employer as it stands on the same day
		const employer =
			entity === undefined
				? undefined
				: employerOn(
						entity,
						companyChanges.filter((row) => row.entity_id === entity.id),
						on
					);
		const starts = startsOf(
			employment,
			held.chain,
			lineage,
			held.cumulative.has(String(employment.employee_id))
		);
		const subject = {
			scope: String(law?.code),
			started: starts.service_started_on,
			events: eventsOf(employment)
		};
		const own = balance.get(String(employment.employee_id));
		const leave = accountsOf(own?.account).leave ?? {};
		const added = manual.get(String(own?.id))?.leave ?? {};
		for (const row of law?.rows.leave_catalog ?? []) {
			const { code, lookup } = rowOfCatalog(row);
			const grants = grantsOf(lookup, subject, personOf(employment, starts, employer));
			for (const period of eventPeriods(leave[code], subject.scope)) {
				const used = leave[code]?.[period]?.used ?? 0;
				const grant = grants.get(period);
				const behind = (grant?.days ?? 0) + (added[code]?.[period]?.entitled ?? 0);
				if (used > 0 && (grant === undefined || (!unlimited(lookup) && used > behind)))
					return yield* Effect.fail(
						new Refusal({
							message: `${code}: days taken stand on a fact this change removes or moves. Where only its date moved, give the old date as Leave from.`
						})
					);
			}
		}
	}
});
