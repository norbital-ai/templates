import { Effect } from 'effect';
import { refuse, type AutomationApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceRow } from '../../collections/leave_requests/$types.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { completedMonths } from '../../collections/payroll_runs/lib/dates.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { isEligible, personContext } from '../../collections/payroll_runs/lib/eligibility.js';
import { roundHalfDay } from '../../collections/payroll_runs/lib/rounding.js';
import { dateKey } from '../iso-day.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { awardedLeaveDays, leaveBalance } from './ledger.js';
import { leaveEntitlementIdFor, leaveEntryIdFor, requestSourceKey } from './identity.js';

/**
 * The leave reconciler: four rules, one arithmetic.
 *
 * 1. For each employment × leave type × (previous, current, next) leave year, the leave types
 *    being those of the jurisdiction settings version in force on the year's rule date (a year no
 *    sealed version covers generates nothing): if the person is eligible on the rule date, the
 *    entitlement row exists and its award schedule is
 *    posted through today: one `OPENING_ENTITLEMENT` (UPFRONT) or the `accrual:<n>` lines
 *    (MONTHLY). Not eligible, or a band of zero on a metered type: no row. Eligibility first
 *    satisfied mid-year opens the row then: UPFRONT grants the band, MONTHLY the months left.
 * 2. A catalogue edit that changes an OPEN entitlement's target appends one `ADJUSTMENT` for the
 *    delta between the new target-to-date and the posted awards, keyed `adjust:<updated_at>`, so a
 *    rerun is a no-op and each edit posts once. MONTHLY lines after the edit come from the new band.
 * 3. Year close (`close:<entitlement>`), carry lots and their expiry, commute and exit payout.
 * 4. Approved requests take `TAKEN` lines under the id the request's own write would use.
 *
 * Every line has a stable source key, so the arithmetic can run as often as it likes.
 */

const LIMIT = 5_000;
/** The leave service needs only the data surface; hooks and automations hand it theirs. */
type Api = Readonly<{ readonly db: AutomationApi['db'] }>;
type Employment = WorkspaceRow<'employments'>;
type Employee = WorkspaceRow<'employees'>;
type LeaveType = WorkspaceRow<'leave_types'>;
type Child = WorkspaceRow<'employee_children'>;
type Entitlement = WorkspaceRow<'leave_entitlements'>;
type EmploymentTerm = WorkspaceRow<'employment_terms'>;
type Entry = WorkspaceRow<'leave_entries'>;
type NewEntry = {
	readonly id?: string;
	readonly leave_entitlement_id: string;
	readonly kind: Entry['kind'];
	readonly effective_on: string;
	readonly days: number;
	readonly expires_on?: string | null;
	readonly reason: string;
	readonly source_key: string;
	readonly source_request_id?: string | null;
};

function requireComplete(rows: readonly unknown[], label: string): void {
	if (rows.length >= LIMIT)
		refuse(`The ${label} read reached its ${LIMIT}-row reconciliation ceiling.`);
}

function calendarDate(year: number, monthIndex: number, day: number): string {
	return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

export function leaveYearOf(date: string): number {
	return Number(date.slice(0, 4));
}

/** The leave year is the calendar year. */
function leaveYearWindow(year: number): { start: string; end: string } {
	return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/** The band in force at this many completed months of service: the highest `band_from` at or below it. */
function entitlementDays(type: Pick<LeaveType, 'entitlement'>, serviceMonths: number): number {
	return (
		type.entitlement.layers
			.filter((band) => band.band_from <= serviceMonths)
			.toSorted((left, right) => right.band_from - left.band_from)[0]?.days ?? 0
	);
}

function monthEndFrom(start: string, offset: number): string {
	const year = Number(start.slice(0, 4));
	const monthIndex = Number(start.slice(5, 7)) - 1 + offset;
	return calendarDate(year, monthIndex + 1, 0);
}

/**
 * The award schedule of one entitlement, through `asOf`.
 *
 * UPFRONT is one opening line on the opening date. MONTHLY is one line per month end from the
 * opening date, each the difference between two cumulative half-day-rounded shares of the target,
 * so a band change mid-year moves only the lines after it. UNLIMITED awards nothing.
 */
export function entitlementEntries(options: {
	readonly entitlementId: string;
	readonly type: Pick<LeaveType, 'accrual'>;
	readonly target: number;
	readonly yearStart: string;
	readonly yearEnd: string;
	readonly openingDate: string;
	readonly asOf: string;
}): NewEntry[] {
	if (options.target <= 0 || options.type.accrual.kind === 'UNLIMITED') return [];
	if (options.type.accrual.kind === 'UPFRONT')
		return options.openingDate > options.asOf
			? []
			: [
					{
						leave_entitlement_id: options.entitlementId,
						kind: 'OPENING_ENTITLEMENT',
						effective_on: options.openingDate,
						days: options.target,
						reason: 'Yearly entitlement',
						source_key: 'opening'
					}
				];
	const entries: NewEntry[] = [];
	let months = 0;
	let awarded = 0;
	for (let month = 0; month < 12; month += 1) {
		const effective = monthEndFrom(options.yearStart, month);
		if (effective < options.openingDate || effective > options.yearEnd) continue;
		months += 1;
		const cumulative = roundHalfDay((options.target * months) / 12);
		const days = cumulative - awarded;
		awarded = cumulative;
		if (days === 0 || effective > options.asOf) continue;
		entries.push({
			leave_entitlement_id: options.entitlementId,
			kind: 'ACCRUAL',
			effective_on: effective,
			days,
			reason: `Scheduled monthly accrual ${month + 1}/12`,
			source_key: `accrual:${month + 1}`
		});
	}
	return entries;
}

/** The whole-year award the schedule sums to, whatever the date. */
function scheduledTotal(options: Parameters<typeof entitlementEntries>[0]): number {
	return entitlementEntries({ ...options, asOf: options.yearEnd }).reduce(
		(total, entry) => total + entry.days,
		0
	);
}

/** Creates the entitlement row for one leave year when it is missing, with its schedule through `asOf`. */
function ensureEntitlement(options: {
	readonly api: Api;
	readonly employment: Employment;
	readonly type: LeaveType;
	readonly year: number;
	readonly openingDate: string;
	readonly serviceMonths: number;
	readonly asOf: string;
	readonly existing: readonly Entitlement[];
}): Effect.Effect<{ entitlement: Entitlement; created: boolean }> {
	return Effect.gen(function* () {
		const found = options.existing.find(
			(row) => row.leave_year === options.year && row.leave_code === options.type.code
		);
		if (found != null) return { entitlement: found, created: false };
		const window = leaveYearWindow(options.year);
		const target = entitlementDays(options.type, options.serviceMonths);
		const schedule = {
			entitlementId: '',
			type: options.type,
			target,
			yearStart: window.start,
			yearEnd: window.end,
			openingDate: options.openingDate,
			asOf: options.asOf
		};
		yield* options.api.db.leave_entitlements.mutate([
			{
				employment_id: options.employment.id,
				leave_type_id: options.type.id,
				leave_year: options.year,
				starts_on: options.openingDate,
				ends_on: window.end,
				status: 'OPEN',
				entitlement_days: options.type.accrual.kind === 'UNLIMITED' ? 0 : scheduledTotal(schedule),
				accrual_kind: options.type.accrual.kind,
				settlement:
					options.type.accrual.kind === 'UNLIMITED'
						? { settlement: 'FORFEIT' }
						: options.type.accrual.settlement,
				exit_settlement: options.type.exit_settlement,
				leave_code: options.type.code,
				leave_name: options.type.name
			}
		]);
		const entitlement = yield* options.api.db.leave_entitlements.findFirst({
			where: {
				employment_id: { eq: options.employment.id },
				leave_code: { eq: options.type.code },
				leave_year: { eq: options.year }
			}
		});
		if (entitlement == null) refuse('The generated leave entitlement could not be read back.');
		const entries = entitlementEntries({ ...schedule, entitlementId: entitlement.id });
		if (entries.length > 0) yield* options.api.db.leave_entries.mutate(entries);
		return { entitlement, created: true };
	});
}

/**
 * The award lines of an OPEN entitlement, restated from the catalogue as it stands.
 *
 * Posts the schedule lines through `asOf` that are missing (a MONTHLY row earns its next line
 * here), then, when the type changed after the row was generated, one `ADJUSTMENT` for the
 * difference between the new target-to-date and the awards already posted. Both are keyed, so
 * the same edit never posts twice.
 */
function reconcileAwards(options: {
	readonly api: Api;
	readonly entitlement: Entitlement;
	readonly entries: readonly Entry[];
	readonly employment: Employment;
	readonly type: LeaveType;
	readonly asOf: string;
}): Effect.Effect<number> {
	return Effect.gen(function* () {
		const { entitlement, type } = options;
		if (entitlement.status !== 'OPEN' || type.accrual.kind === 'UNLIMITED') return 0;
		const window = leaveYearWindow(entitlement.leave_year);
		const openingDate = dateKey(entitlement.starts_on);
		const target = entitlementDays(
			type,
			completedMonths(dateKey(options.employment.hire_date), openingDate)
		);
		const schedule = entitlementEntries({
			entitlementId: entitlement.id,
			type,
			target,
			yearStart: window.start,
			yearEnd: window.end,
			openingDate,
			asOf: options.asOf
		});
		const posted = new Set(options.entries.map((entry) => entry.source_key));
		const missing = schedule.filter((entry) => !posted.has(entry.source_key));
		if (missing.length > 0) yield* options.api.db.leave_entries.mutate(missing);
		// The row was generated from the catalogue as it stood when it was created; only a later
		// edit can move its target. Both stamps are the runtime's own, in one format.
		const updatedAt = type.updated_at == null ? '' : String(type.updated_at);
		const createdAt = entitlement.created_at == null ? '' : String(entitlement.created_at);
		if (updatedAt === '' || (createdAt !== '' && updatedAt <= createdAt)) return missing.length;
		const sourceKey = `adjust:${updatedAt}`;
		if (posted.has(sourceKey)) return missing.length;
		const targetToDate = schedule.reduce((total, entry) => total + entry.days, 0);
		const awarded = awardedLeaveDays(options.entries, options.asOf);
		const delta = targetToDate - awarded;
		if (Math.abs(delta) < 1e-9) return missing.length;
		yield* options.api.db.leave_entries.mutate([
			{
				leave_entitlement_id: entitlement.id,
				kind: 'ADJUSTMENT',
				effective_on: options.asOf,
				days: delta,
				reason: `Leave type ${type.code} changed: entitlement to date is now ${targetToDate}, ${awarded} was posted`,
				source_key: sourceKey
			}
		]);
		return missing.length + 1;
	});
}

/**
 * The one carried lot an entitlement can hold expires once: whatever of it was not taken by its
 * expiry date lapses. Days taken up to that date consume the lot first, so a later restore that
 * changes what was taken appends the delta under a versioned key rather than rewriting history.
 */
export function expireCarry(
	api: Api,
	entitlement: Entitlement,
	entries: readonly Entry[],
	asOf: string
) {
	return Effect.gen(function* () {
		const lot = entries.find((entry) => entry.kind === 'CARRY_FORWARD');
		if (lot == null || lot.expires_on == null || dateKey(lot.expires_on) > asOf) return 0;
		const sourceKey = `expire:${lot.id}`;
		const takenBeforeExpiry = Math.max(
			0,
			-entries
				.filter(
					(entry) =>
						(entry.kind === 'TAKEN' || entry.kind === 'RESTORED') &&
						dateKey(entry.effective_on) <= dateKey(lot.expires_on)
				)
				.reduce((total, entry) => total + decodeNumber(entry.days), 0)
		);
		const remaining = Math.max(0, decodeNumber(lot.days) - takenBeforeExpiry);
		const priorExpiries = entries.filter(
			(entry) =>
				entry.kind === 'EXPIRED' &&
				(entry.source_key === sourceKey || entry.source_key.startsWith(`${sourceKey}:v`))
		);
		const alreadyExpired = Math.max(
			0,
			-priorExpiries.reduce((total, entry) => total + decodeNumber(entry.days), 0)
		);
		const delta = remaining - alreadyExpired;
		if (delta <= 1e-9) return 0;
		const key =
			priorExpiries.length === 0 ? sourceKey : `${sourceKey}:v${priorExpiries.length + 1}`;
		yield* api.db.leave_entries.mutate([
			{
				id: leaveEntryIdFor({ leave_entitlement_id: entitlement.id, source_key: key }),
				leave_entitlement_id: entitlement.id,
				kind: 'EXPIRED',
				effective_on: dateKey(lot.expires_on),
				days: -delta,
				reason: 'Carried-forward leave not taken by its expiry date lapsed',
				source_key: key
			} as NewEntry
		]);
		return 1;
	});
}

/**
 * A leave year closes once, on its end date, by the rule sealed into the entitlement.
 *
 *   CARRY   — up to the limit moves to the next year's entitlement as one lot with its expiry
 *             date; the rest lapses. With no next row (the employment ended) everything lapses.
 *   COMMUTE — the balance becomes money at the statute's daily rate from the terms in force on
 *             the closing date: one COMMUTED line, priced by payroll when it prints it.
 *   FORFEIT — the balance lapses.
 *
 * Every line is keyed `close:<entitlement>`, so a rerun restates and never doubles; a request
 * still pending approval holds the close until it is decided.
 */
export function closeLeaveYear(options: {
	readonly api: Api;
	readonly previous: Entitlement;
	readonly next: Entitlement | null;
	readonly entries: readonly Entry[];
	readonly pending: readonly { readonly approval_id?: string | null }[];
	readonly asOf: string;
}) {
	return Effect.gen(function* () {
		const { previous, next } = options;
		if (dateKey(previous.ends_on) >= options.asOf || previous.status === 'CLOSED') return 0;
		if (options.pending.some((request) => request.approval_id != null)) return 0;
		const key = `close:${previous.id}`;
		const closing = (suffix: string) => `${key}:${suffix}`;
		if (options.entries.some((entry) => entry.source_key.startsWith(`${key}:`))) {
			yield* options.api.db.leave_entitlements.mutate([{ id: previous.id, status: 'CLOSED' }]);
			return 0;
		}
		const endsOn = dateKey(previous.ends_on);
		const balance = Math.max(0, leaveBalance(options.entries, endsOn));
		const rule = previous.settlement;
		const line = (
			suffix: string,
			values: Omit<NewEntry, 'leave_entitlement_id' | 'source_key' | 'id'>
		) =>
			({
				id: leaveEntryIdFor({ leave_entitlement_id: previous.id, source_key: closing(suffix) }),
				leave_entitlement_id: previous.id,
				source_key: closing(suffix),
				...values
			}) as NewEntry;
		const movements: NewEntry[] = [];
		if (balance > 1e-9) {
			if (rule.settlement === 'CARRY' && next != null) {
				const carried =
					rule.limit_days == null ? balance : Math.min(balance, decodeNumber(rule.limit_days));
				const lapse = balance - carried;
				if (carried > 1e-9) {
					movements.push(
						line('out', {
							kind: 'CARRY_TRANSFER_OUT',
							effective_on: endsOn,
							days: -carried,
							reason: `Carried into leave year ${next.leave_year}`
						}),
						{
							id: leaveEntryIdFor({
								leave_entitlement_id: next.id,
								source_key: `carry:${previous.id}`
							}),
							leave_entitlement_id: next.id,
							kind: 'CARRY_FORWARD',
							effective_on: dateKey(next.starts_on),
							days: carried,
							expires_on:
								decodeNumber(rule.expiry_months) === 0
									? null
									: monthEndFrom(dateKey(next.starts_on), decodeNumber(rule.expiry_months) - 1),
							reason: `Carried from leave year ${previous.leave_year}`,
							source_key: `carry:${previous.id}`
						} as NewEntry
					);
				}
				if (lapse > 1e-9)
					movements.push(
						line('forfeit', {
							kind: 'EXPIRED',
							effective_on: endsOn,
							days: -lapse,
							reason: `Above the carry-forward limit of ${decodeNumber(rule.limit_days)} days`
						})
					);
			} else if (rule.settlement === 'COMMUTE') {
				// The days leave the entitlement here; payroll prices the line at the terms in force
				// on this date and the statute's basis when it prints it.
				movements.push(
					line('commute', {
						kind: 'COMMUTED',
						effective_on: endsOn,
						days: -balance,
						reason: `Commuted ${balance} unused days to cash (${rule.pay_basis})`
					})
				);
			} else {
				movements.push(
					line('forfeit', {
						kind: 'EXPIRED',
						effective_on: endsOn,
						days: -balance,
						reason:
							rule.settlement === 'CARRY'
								? 'No following leave year to carry into'
								: 'Unused leave lapsed at year end'
					})
				);
			}
		}
		if (movements.length > 0) yield* options.api.db.leave_entries.mutate(movements);
		yield* options.api.db.leave_entitlements.mutate([{ id: previous.id, status: 'CLOSED' }]);
		return movements.length;
	});
}

/**
 * An employment's end closes every open entitlement on the exit date: the balance is paid out or
 * lapses by the sealed exit rule, with the statute's misconduct exception read from the
 * employment's `exit_reason`.
 */
export function closeOnExit(options: {
	readonly api: Api;
	readonly employment: Employment;
	readonly entitlement: Entitlement;
	readonly entries: readonly Entry[];
	readonly exitDate: string;
}) {
	return Effect.gen(function* () {
		const { entitlement } = options;
		const key = `exit:${entitlement.id}`;
		let posted = 0;
		if (!options.entries.some((entry) => entry.source_key === key)) {
			const balance = Math.max(0, leaveBalance(options.entries, options.exitDate));
			if (balance > 1e-9) {
				const rule = entitlement.exit_settlement;
				const misconduct = options.employment.exit_reason === 'MISCONDUCT';
				const paysOut = rule.exit === 'PAY_OUT' && !(rule.misconduct_forfeits && misconduct);
				const id = leaveEntryIdFor({ leave_entitlement_id: entitlement.id, source_key: key });
				yield* options.api.db.leave_entries.mutate([
					paysOut && rule.exit === 'PAY_OUT'
						? ({
								id,
								leave_entitlement_id: entitlement.id,
								kind: 'ENCASHED',
								effective_on: options.exitDate,
								days: -balance,
								reason: `Paid out on exit: ${balance} unused days (${rule.pay_basis})`,
								source_key: key
							} as NewEntry)
						: ({
								id,
								leave_entitlement_id: entitlement.id,
								kind: 'EXPIRED',
								effective_on: options.exitDate,
								days: -balance,
								reason:
									rule.exit === 'PAY_OUT'
										? 'Payout forfeited: dismissal for misconduct'
										: 'Unused leave lapsed on employment exit',
								source_key: key
							} as NewEntry)
				]);
				posted += 1;
			}
		}
		yield* options.api.db.leave_entitlements.mutate([{ id: entitlement.id, status: 'CLOSED' }]);
		return posted;
	});
}

/**
 * The ledger line each approved request of this employment takes, on the entitlement the request
 * names or, when it arrived without one (a seeded fact, an import), on the entitlement its
 * employment, leave type and start date name by formula. The request's own write posts the same
 * line under the same id, so whichever write comes first creates it and the other restates it;
 * nothing is charged twice.
 */
export function chargeApprovedRequests(
	api: Api,
	employment: Employment,
	entitlements: readonly Entitlement[]
): Effect.Effect<number> {
	return Effect.gen(function* () {
		const requests = yield* api.db.leave_requests.findMany({
			where: { employment_id: { eq: employment.id }, approval_id: { isNull: true } },
			limit: LIMIT
		});
		requireComplete(requests, 'employment leave requests');
		if (requests.length === 0) return 0;
		const typeIds = [...new Set(requests.map((request) => request.leave_type_id))];
		const types = yield* api.db.leave_types.findMany({
			where: { id: { in: typeIds } },
			limit: LIMIT
		});
		const codeOf = new Map(types.map((type) => [type.id, type.code]));
		const lines: NewEntry[] = [];
		for (const request of requests) {
			const start = dateKey(request.event.range.start.date);
			const entitlementId =
				request.leave_entitlement_id ??
				leaveEntitlementIdFor({
					employment_id: employment.id,
					leave_code: codeOf.get(request.leave_type_id) ?? '',
					leave_year: leaveYearOf(start)
				});
			if (!entitlements.some((row) => row.id === entitlementId)) continue;
			const sourceKey = requestSourceKey(request.id);
			const existing = yield* api.db.leave_entries.findFirst({
				where: { leave_entitlement_id: { eq: entitlementId }, source_key: { eq: sourceKey } }
			});
			if (existing != null) continue;
			lines.push({
				id: leaveEntryIdFor({ leave_entitlement_id: entitlementId, source_key: sourceKey }),
				leave_entitlement_id: entitlementId,
				kind: 'TAKEN',
				effective_on: start,
				days: -Math.abs(decodeNumber(request.event.chargeable_days)),
				reason: 'Approved leave request',
				source_key: sourceKey,
				source_request_id: request.id
			} as NewEntry);
		}
		if (lines.length > 0) yield* api.db.leave_entries.mutate(lines);
		return lines.length;
	});
}

/** The person as the eligibility expressions see them on one date. */
function personOn(options: {
	readonly employee: Employee;
	readonly employment: Employment;
	readonly terms: readonly EmploymentTerm[];
	readonly children: readonly Child[];
	readonly date: string;
}) {
	return personContext({
		employee: options.employee,
		employment: options.employment,
		terms: options.terms.find((row) => coversDate(row.effective_range, options.date)) ?? null,
		children: options.children,
		asOf: options.date
	});
}

export function reconcileEmploymentLeave(api: Api, employmentId: string, asOf: string) {
	return Effect.gen(function* () {
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: employmentId }, approval_id: { isNull: true } }
		});
		if (employment == null) return { entitlements_created: 0, entries_posted: 0 };
		const [company, employee, terms, children, versionRows, stored] = yield* Effect.all(
			[
				api.db.companies.findFirst({
					where: { id: { eq: employment.company_id }, approval_id: { isNull: true } }
				}),
				api.db.employees.findFirst({ where: { id: { eq: employment.employee_id } } }),
				api.db.employment_terms.findMany({
					where: { employment_id: { eq: employment.id }, approval_id: { isNull: true } },
					limit: LIMIT
				}),
				api.db.employee_children.findMany({
					where: { employment_id: { eq: employment.id }, approval_id: { isNull: true } },
					limit: LIMIT
				}),
				api.db.jurisdiction_settings.findMany({
					where: { approval_id: { isNull: true } },
					limit: LIMIT
				}),
				api.db.leave_entitlements.findMany({
					where: { employment_id: { eq: employment.id }, approval_id: { isNull: true } },
					limit: LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		if (company == null || employee == null) return { entitlements_created: 0, entries_posted: 0 };
		requireComplete(terms, 'employment terms');
		requireComplete(children, 'employee children');
		requireComplete(versionRows, 'jurisdiction settings versions');
		requireComplete(stored, 'employment leave entitlements');
		// The lineage the company binds to, every version of it: the catalogue is read once for all
		// of them and the version in force on each year's rule date says which rows that year uses.
		// Entitlements sealed under an earlier version keep pointing at that version's rows.
		const code = String(company.settings_code);
		const versions = versionRows.filter((row) => row.code === code);
		const types =
			versions.length === 0
				? []
				: yield* api.db.leave_types.findMany({
						where: {
							settings_id: { in: versions.map((row) => row.id) },
							approval_id: { isNull: true }
						},
						limit: LIMIT
					});
		requireComplete(types, 'lineage leave types');
		const currentYear = leaveYearOf(asOf);
		const hireDate = dateKey(employment.hire_date);
		let created = 0;
		let posted = 0;
		const entitlements = [...stored];
		const person = (date: string) => personOn({ employee, employment, terms, children, date });

		// The previous leave year is opened too: its ledger is what carries into the current year,
		// and a request dated in it must find its row. Nothing older is ever generated or read.
		for (const year of [currentYear - 1, currentYear, currentYear + 1]) {
			const window = leaveYearWindow(year);
			if (hireDate > window.end) continue;
			if (employment.exit_date != null && dateKey(employment.exit_date) < window.start) continue;
			const ruleDate = window.start < hireDate ? hireDate : window.start;
			const governing = settingsInForce(versions, code, ruleDate);
			if (governing == null) continue;
			for (const type of types) {
				if (type.settings_id !== governing.id) continue;
				// Eligible on the rule date: the row opens on it. Eligible only since then, in the year
				// running now: the row opens today, with the band (UPFRONT) or the months left (MONTHLY).
				const openingDate = isEligible(type.eligibility, person(ruleDate))
					? ruleDate
					: year === currentYear && isEligible(type.eligibility, person(asOf))
						? asOf
						: null;
				if (openingDate == null) continue;
				const serviceMonths = completedMonths(hireDate, openingDate);
				if (type.accrual.kind !== 'UNLIMITED' && entitlementDays(type, serviceMonths) <= 0)
					continue;
				const ensured = yield* ensureEntitlement({
					api,
					employment,
					type,
					year,
					openingDate,
					serviceMonths,
					asOf,
					existing: entitlements
				});
				if (ensured.created) {
					created += 1;
					entitlements.push(ensured.entitlement);
				}
			}
		}

		posted += yield* chargeApprovedRequests(api, employment, entitlements);

		const typeById = new Map(types.map((type) => [type.id, type]));
		for (const entitlement of entitlements) {
			let entries = yield* api.db.leave_entries.findMany({
				where: { leave_entitlement_id: { eq: entitlement.id }, approval_id: { isNull: true } },
				limit: LIMIT
			});
			requireComplete(entries, 'leave entitlement entries');
			const reread = () =>
				api.db.leave_entries.findMany({
					where: { leave_entitlement_id: { eq: entitlement.id }, approval_id: { isNull: true } },
					limit: LIMIT
				});
			const type = typeById.get(entitlement.leave_type_id);
			if (type != null && entitlement.status === 'OPEN') {
				const awards = yield* reconcileAwards({
					api,
					entitlement,
					entries,
					employment,
					type,
					asOf
				});
				posted += awards;
				if (awards > 0) entries = yield* reread();
			}
			const expired = yield* expireCarry(api, entitlement, entries, asOf);
			posted += expired;
			if (expired > 0) entries = yield* reread();
			const exitDate = employment.exit_date == null ? '' : dateKey(employment.exit_date);
			if (
				exitDate !== '' &&
				exitDate <= asOf &&
				entitlement.status === 'OPEN' &&
				dateKey(entitlement.starts_on) <= exitDate &&
				dateKey(entitlement.ends_on) >= exitDate
			) {
				posted += yield* closeOnExit({ api, employment, entitlement, entries, exitDate });
				continue;
			}
			if (entitlement.status !== 'OPEN' || dateKey(entitlement.ends_on) >= asOf) continue;
			const next =
				entitlements.find(
					(candidate) =>
						candidate.leave_year === entitlement.leave_year + 1 &&
						candidate.leave_code === entitlement.leave_code
				) ?? null;
			const pending = yield* api.db.leave_requests.findPending({
				where: { leave_entitlement_id: { eq: entitlement.id } },
				limit: LIMIT
			});
			posted += yield* closeLeaveYear({
				api,
				previous: entitlement,
				next,
				entries,
				pending,
				asOf
			});
		}
		return { entitlements_created: created, entries_posted: posted };
	});
}
