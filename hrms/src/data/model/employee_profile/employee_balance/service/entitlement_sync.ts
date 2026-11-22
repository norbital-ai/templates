import { DateTime, Effect } from 'effect';
import { new_id, type EffectCtx, type Id } from '@norbital-ai/bolt';
import {
	isJsonObject,
	jsonObject,
	type Json,
	type JsonObject
} from '../../../../../lib/foundation.js';
import { idOf, idsOf, objectValue, queryRows, type Reader } from '../../../../../lib/reads.js';
import { accountsOf, apply, eventsOf, expired, nextWindow, unlimited, windowOf } from './core.js';
import { employerOn } from '../../../entity/service/company.js';
import { employmentOn, startsOf } from '../../service/person.js';
import { lawRead, lawsOf, type Law } from '../../../jurisdiction/service/law.js';
import {
	BATCH,
	FIELDS,
	MANUAL,
	covers,
	manualOf,
	settle,
	stintsOf,
	stintsRead,
	uniqueIds,
	type Ctx,
	type Plan
} from './ledger_store.js';
import { entitlementPlans, opened } from './posting_plans.js';
import { personOf } from './entry_postings.js';

/** What a company's people are entitled under: the company on any day, its work events and the law it follows. */
const companyRead = (read: Reader, companies: readonly Id<'entity'>[], codes: readonly string[]) =>
	queryRows(read, {
		entity: { where: { id: { in: companies } }, fields: ['id', 'settings_code'], limit: 50 },
		entity_change: { where: { entity_id: { in: companies } }, limit: 10000 },
		...lawRead(codes),
		work_event: {
			where: { entity_id: { in: companies } },
			fields: ['id', 'entity_id', 'employment_id', 'catalog_code', 'from', 'to', 'location'],
			limit: 10000
		}
	});
type CompanyRead = Effect.Success<ReturnType<typeof companyRead>>;
/** People synced in one pass of reads and one settle. */
const SYNC_BATCH = 200;

/**
 * Sync: entitlements on a day, from the rows in force and the facts of each person's employment that day. For the
 * people named, or for everyone with a stint (one read); either way in batches, each a read keyed by its people, one
 * of their companies and the settle's one. A company's law and events are read once and kept for its next batches.
 */
export const syncEntitlements = Effect.fn('ledger.syncEntitlements')(function* (
	ctx: Ctx,
	employees?: readonly string[]
) {
	const everyone = idsOf(
		'employee_profile',
		employees ??
			uniqueIds(
				(yield* queryRows(ctx.query, { employment: { fields: ['employee_id'], limit: 10000 } }))
					.employment,
				'employee_id'
			)
	);
	const companies = new Map<string, CompanyRead>();
	let people = 0;
	let boundary: string | undefined;
	for (let at = 0; at < everyone.length; at += SYNC_BATCH) {
		const done = yield* syncPeople(ctx, everyone.slice(at, at + SYNC_BATCH), companies);
		people += done.people;
		if (done.boundary !== undefined && (boundary === undefined || done.boundary < boundary))
			boundary = done.boundary;
	}
	return { people, boundary };
});

const syncPeople = Effect.fnUntraced(function* (
	ctx: Ctx,
	employees: readonly Id<'employee_profile'>[],
	companies: Map<string, CompanyRead>
) {
	const day = ctx.today;
	// their stints, balances and the rows HR keyed by hand
	const own = yield* queryRows(ctx.query, {
		...stintsRead(employees),
		employee_balance: {
			where: { employee_id: { in: employees } },
			fields: ['employee_id', 'account'],
			limit: 10000
		},
		ledger_entry: {
			where: { ...MANUAL, balance_id: { is: { employee_id: { in: employees } } } },
			fields: FIELDS,
			limit: 10000
		}
	});
	// a balance row opens with the person's first stint; a pass opens any that is still missing, so nobody is left where
	// every entry is refused for want of one. Its id is minted here: an empty balance needs no read back
	const has = new Set(own.employee_balance.map((row) => row.employee_id));
	const opened = employees
		.filter((id) => !has.has(id))
		.map((employee_id) => ({ id: new_id('employee_balance'), employee_id, account: {} }));
	if (opened.length > 0) yield* ctx.act({ 'employee_balance.create': opened });
	// the companies those stints name: read once, kept for the next batch of the same companies
	const named = own.employment.flatMap((row) =>
		isJsonObject(row.entity_id) ? [row.entity_id] : []
	);
	const ids = idsOf(
		'entity',
		named.map((row) => row.id)
	).toSorted();
	const key = ids.join(',');
	const theirs =
		companies.get(key) ??
		(yield* companyRead(ctx.query, ids, [...new Set(named.map((row) => row.settings_code))]));
	companies.set(key, theirs);
	const read = {
		...own,
		...theirs,
		employee_balance: [...own.employee_balance, ...opened.map((row) => jsonObject(row))]
	};
	const manual = manualOf(read.ledger_entry ?? []);
	// a stint's law is its entity's jurisdiction as it stands on the day
	const lineage = new Map((read.entity ?? []).map((row) => [String(row.id), row.settings_code]));
	const laws = lawsOf(read);
	const lawIn = (entity: unknown, on: string) => laws(lineage.get(String(entity)), on);
	const entitled = (account: string, rows: readonly JsonObject[]) =>
		rows.map((row) => ({ account, code: String(row.code), lookup: objectValue(row.lookup) }));
	const rowsOf = (law: Law | undefined) =>
		law === undefined
			? []
			: [
					...entitled('leave', law.rows.leave_catalog),
					...entitled('claim', law.rows.claim_catalog)
				];
	// a stint no terms row has reached yet (a hire still being written) owes nothing
	const { parts: stints } = stintsOf(read);
	const agreed = Map.groupBy(
		stints.filter((parts) => parts.terms.length > 0),
		(parts) => String(parts.stint.employee_id)
	);
	const workEvents = (read.work_event ?? []).map((row) => ({
		code: row.catalog_code,
		entity_id: row.entity_id,
		employment_id: row.employment_id == null ? null : row.employment_id,
		from: row.from,
		to: row.to == null ? null : row.to,
		location: row.location ?? null
	}));
	const eventsFor = (contract: JsonObject) =>
		workEvents.filter(
			(event) =>
				event.entity_id === String(contract.entity_id) &&
				(event.employment_id == null || event.employment_id === String(contract.id))
		);
	const chains = Map.groupBy(
		stints.map((parts) => parts.stint),
		(row) => String(row.employee_id)
	);
	const changesOf = Map.groupBy(read.entity_change ?? [], (row) => row.entity_id);
	const employerAt = (entity: unknown, on: string) => {
		const company = (read.entity ?? []).find((row) => row.id === entity);
		return company === undefined
			? undefined
			: employerOn(company, changesOf.get(company.id) ?? [], on);
	};
	const plans: Plan[] = [];
	let boundary: string | undefined;
	for (const balance of read.employee_balance ?? []) {
		const own = agreed.get(String(balance.employee_id)) ?? [];
		const now = own.find((parts) => covers(parts.stint.effective_range, day));
		if (now === undefined) continue;
		// the stint covering today, as it stands today
		const contract = employmentOn(now, day);
		const law = lawIn(contract.entity_id, day);
		const rows = rowsOf(law);
		const starts = startsOf(
			now.stint,
			chains.get(String(balance.employee_id)) ?? [],
			lineage,
			now.profile.cumulative_service === true
		);
		const subject = {
			scope: String(law?.code),
			started: starts.service_started_on,
			events: eventsOf(contract)
		};
		const personOn = (held: JsonObject, on: string) =>
			personOf(held, starts, employerAt(held.entity_id, on), eventsFor(held));
		plans.push(
			...entitlementPlans(
				rows,
				personOn(contract, day),
				subject,
				String(balance.id),
				accountsOf(balance.account),
				day,
				// a window that closed settles under the law of its last day and the stint covering it, as it stood then
				({ code }, on) => {
					const then = own.find((parts) => covers(parts.stint.effective_range, on));
					const held = then === undefined ? contract : employmentOn(then, on);
					const row = rowsOf(lawIn(held.entity_id, on)).find((item) => item.code === code);
					return row === undefined ? undefined : { lookup: row.lookup, person: personOn(held, on) };
				},
				manual.get(String(balance.id))
			)
		);
		for (const row of rows) {
			if (row.account !== 'leave' || unlimited(row.lookup)) continue;
			const next = nextWindow(windowOf(row.lookup), day, subject.started);
			if (next !== undefined && (boundary === undefined || next < boundary)) boundary = next;
		}
	}
	yield* settle(ctx, plans);
	return { people: (read.employee_balance ?? []).length, boundary };
});

const YEARS_HELD = 3;
/** Old periods leave the balance through dated movements; the ledger keeps them forever. */
export const retire = Effect.fn('ledger.retire')(function* (ctx: Ctx) {
	const { employee_balance: rows = [] } = yield* queryRows(ctx.query, {
		employee_balance: { fields: ['account', 'revision'], limit: 1000 }
	});
	const today = ctx.today;
	const due = rows.flatMap((balance) => {
		const movements = expired(accountsOf(balance.account), today, YEARS_HELD);
		return movements.length === 0 ? [] : [{ balance, movements }];
	});
	for (let at = 0; at < due.length; at += BATCH) {
		const batch = due.slice(at, at + BATCH);
		const acts: Record<string, Json> = {
			'ledger_entry.create': batch.flatMap(({ balance, movements }) =>
				// `REMOVE` only drops the emptied key from the balance: the ledger keeps the movement that emptied it
				movements
					.filter((row) => row.operation !== 'REMOVE')
					.map((row) => jsonObject({ ...row, balance_id: balance.id }))
			),
			'employee_balance.update': batch.map(({ balance, movements }) => ({
				target: { id: balance.id, revision: balance.revision },
				set: jsonObject({ account: apply(accountsOf(balance.account), movements) })
			}))
		};
		yield* ctx.act(acts);
	}
});

/** The leave postings and manual adjustments of these rows in a window that has closed. */
const lateIn = (today: unknown, rows: readonly JsonObject[]) => {
	// a window lasts a year: one that began a year ago or more has closed, whatever day of the year it opens on
	const closed = DateTime.formatIsoDate(
		DateTime.subtract(DateTime.makeUnsafe(String(today)), { years: 1 })
	);
	return rows.filter(
		(row) =>
			(String(row.source).startsWith('leave_catalog_entry:') ||
				String(row.source).startsWith('manual:') ||
				(String(row.source).startsWith('payroll_run:') && row.account === 'leave')) &&
			String(row.period).slice(-10) <= closed
	);
};
/** A leave posting or a manual adjustment in a window that has closed can change what carried since: its people sync again. */
export const syncLate = Effect.fn('ledger.syncLate')(function* (
	ctx: Pick<EffectCtx, 'query' | 'schedule' | 'today'>,
	rows: readonly JsonObject[]
) {
	const late = lateIn(ctx.today, rows);
	if (late.length === 0) return;
	const { employee_balance: balances = [] } = yield* queryRows(ctx.query, {
		employee_balance: {
			where: { id: { in: idsOf('employee_balance', uniqueIds(late, 'balance_id')) } },
			fields: ['employee_id'],
			limit: 1000
		}
	});
	yield* ctx.schedule('ledger', {
		employees: uniqueIds(balances, 'employee_id').map((id) => idOf('employee_profile', id))
	});
});

/**
 * After a write that carried postings (their rows go straight to storage): the same look at what its sources posted,
 * each row read with its person, in one read.
 */
export const syncLatePosted = Effect.fn('ledger.syncLatePosted')(function* (
	ctx: Pick<EffectCtx, 'query' | 'schedule' | 'today'>,
	sources: readonly string[]
) {
	// an approval move runs the effect with no change list: nothing was written
	if (sources.length === 0) return;
	const { ledger_entry: posted } = yield* queryRows(ctx.query, {
		ledger_entry: {
			where: { source: { in: [...sources] } },
			fields: ['source', 'account', 'period', 'balance_id'],
			limit: 10000,
			balance_id: { fields: ['employee_id'] }
		}
	});
	const late = lateIn(ctx.today, posted);
	if (late.length === 0) return;
	yield* ctx.schedule('ledger', {
		employees: idsOf(
			'employee_profile',
			late.flatMap((row) => {
				const person = objectValue(row.balance_id).employee_id;
				return typeof person === 'string' ? [person] : [];
			})
		)
	});
});

/** Who writes the ledger and the balance directly: sync (`payroll_execution`). A record that posts carries its rows in its own write. */
export const writesLedger = (ctx: { readonly policies: readonly string[] }) =>
	ctx.policies.includes('payroll_execution');

/** A sync that failed for good raises a task, so nothing is lost in silence. */
export const raiseFailure = Effect.fn('ledger.raiseFailure')(function* (
	ctx: Ctx,
	label: string,
	reason: string,
	title = 'Ledger sync failed'
) {
	// any one company carries the task: the first page is enough, however many there are
	const { entity } = yield* ctx.query({ entity: { fields: ['id'], limit: 1 } });
	const first = entity.rows[0];
	if (first === undefined) return;
	yield* ctx.act({
		'obligation.create': [
			{
				entity_id: first.id,
				title: `${title}: ${label}. ${reason}`,
				occurrence_key: `ledger-failure:${ctx.today}:${label}`
			}
		]
	});
});
