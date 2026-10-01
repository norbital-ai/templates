import { refuse } from '../refuse.js';
import { fromMinorUnits, roundToStep, toMinorUnits } from '../payroll/run/rounding.js';
import type { LeaveActivity } from './pending.js';
import type { LeaveAllocation } from '../datatypes/leave_allocations.js';
import type { LeaveCharge } from '../datatypes/leave_charges.js';
import {
	addDays,
	daysBetween,
	monthDay,
	monthsEnd,
	weekStart
} from '../../lib/payroll/run/dates.js';
import { coversDate } from '../../lib/payroll/run/effective.js';
import { dateKey } from '../iso-day.js';
import { caseSite, caseTypesOf, evidenceOf } from '../benefit-cases/benefit.js';
import { pointNumber, type HalfDayRange } from '../half-day.js';
import { resolveHolidays } from '../holiday-calendar.js';
import { personCondition } from '../scheduled/entries.js';
import { patternAnchor, patternRosterCodeId, termPatternRow } from '../scheduling/work-pattern.js';
import { rosterCodeKind, workWindow, workWindowHalves } from '../scheduling/roster-code.js';
import type { RosterCodeVariant } from '../datatypes/roster_code_variant.js';
import { payrollWindows, lockStateForDate } from '../scheduling/lock.js';
import {
	allocateLeaveDays,
	assertLeaveBalanceIntegrity,
	leaveBalanceAt,
	reverseLeaveAllocations
} from './balance.js';
import { assertLeaveWindow, grantedDays, leaveWindowOf, type LeaveWindow } from './entitlement.js';
import { leavePool, leaveRules, type LeaveContext } from './context.js';
import { hourlyLeaveBasis } from './hourly-requirement.js';
import { evaluatePersonNumber, isEligible } from '../../lib/payroll/run/eligibility.js';
import {
	emptyActivityFields,
	leaveActivityOf,
	leaveEventOf,
	type LeaveActivityKind,
	type LeaveEntryActivity
} from './activity-fields.js';
import * as Predicate from 'effect/Predicate';

export type LeaveSubmission = LeaveEntryActivity & {
	readonly employment_id: string;
	readonly catalogue_id: string;
	readonly reference: string;
};

type FlatFields = Required<Omit<LeaveEntryActivity, 'charges'>>;

/** The half-day points a flat time-off range states; null when the range is incomplete. */
export function timeOffRangeOf(fields: LeaveEntryActivity): HalfDayRange | null {
	if (fields.from_date == null || fields.to_date == null) return null;
	return {
		start: { date: fields.from_date, half: fields.half_day_start ? 'SECOND' : 'FIRST' },
		end: { date: fields.to_date, half: fields.half_day_end ? 'FIRST' : 'SECOND' }
	};
}

/** Actual approval dates consume history; annual availability remains a recomputable projection. */
/** Approved reversals cancel coverage, while held reversals leave the original reservation intact. */
export function activeTimeOff(entries: readonly LeaveActivity[]) {
	const reversed = new Set(
		entries.flatMap((row) =>
			row.approval_id == null && row.as_adjustment_entry === true && row.reversal_of_id != null
				? [row.reversal_of_id]
				: []
		)
	);
	return entries.filter(
		(row) => leaveActivityOf(row) === 'TIME_OFF' && row.charges.length > 0 && !reversed.has(row.id)
	);
}

export function measureLeaveDay(
	context: LeaveContext,
	rules: ReturnType<typeof leaveRules>,
	date: string,
	entries: readonly LeaveActivity[],
	/** Read the roster through a public holiday: the day a no-pay range encloses and charges (s.88(2)). */
	throughHoliday = false
) {
	const settings = rules.settingsOn(date);
	const calendarDay = rules.catalogueAt(date)?.entitlement.calendar_days === true;
	const resolved = resolveHolidays(
		context.holidays,
		rules.company.id,
		date,
		date,
		() =>
			context.terms.find(
				(row) => row.employment_id === rules.employment.id && coversDate(row.effective_range, date)
			)?.worksite,
		personCondition(rules.personOn)
	);
	const evidence = {
		company_id: rules.company.id,
		date,
		holiday_id: resolved.get(date)?.id ?? null
	};
	if (date < rules.hire)
		return { eligible: false as const, reason: 'BEFORE_HIRE' as const, evidence };
	if (rules.exit != null && date > rules.exit)
		return { eligible: false as const, reason: 'AFTER_EXIT' as const, evidence };
	// The lock is this person's payslip, not their run. A colleague still held no longer keeps the
	// day open, and a colleague already paid no longer closes it.
	const paid = lockStateForDate(
		payrollWindows(
			context.runs.filter((row) => row.company_id === rules.company.id),
			context.payslips
		),
		date,
		rules.employment.id
	);
	if (paid.kind === 'SETTLED')
		return {
			eligible: false as const,
			reason: 'PAID_PAYROLL' as const,
			period: paid.period,
			evidence
		};
	if (resolved.has(date) && !throughHoliday && !calendarDay)
		return { eligible: false as const, reason: 'HOLIDAY' as const, evidence };
	const term = rules.terms.find((row) => coversDate(row.effective_range, date));
	if (!term) return { eligible: false as const, reason: 'NO_SCHEDULE' as const, evidence };
	const override = context.workDays.find(
		(row) => row.employment_id === rules.employment.id && dateKey(row.work_date) === date
	);
	const namedPattern = context.patterns.find((row) => row.id === term.shift_pattern_id);
	if (namedPattern != null && !coversDate(namedPattern.effective_range, date) && !calendarDay)
		return { eligible: false as const, reason: 'NO_SCHEDULE' as const, evidence };
	const patternRow = termPatternRow(term, new Map(context.patterns.map((row) => [row.id, row])));
	const codeId =
		override?.shift_definition_id ??
		patternRosterCodeId(patternRow?.pattern ?? null, date, patternAnchor(patternRow));
	const shift = context.shifts.find(
		(row) => row.id === codeId && row.company_id === rules.company.id
	);
	if ((!shift || !coversDate(shift.effective_range, date)) && !calendarDay)
		return { eligible: false as const, reason: 'MISSING_ROSTER_CODE' as const, evidence };
	if (shift != null && rosterCodeKind(shift.variant) !== 'WORK' && !calendarDay)
		return { eligible: false as const, reason: 'REST_OR_OFF' as const, evidence };
	if (!rules.eligibleOn(date))
		return { eligible: false as const, reason: 'INELIGIBLE' as const, evidence };
	const occupied = new Set<'FIRST' | 'SECOND'>();
	for (const entry of activeTimeOff(
		entries.filter((row) => row.employment_id === rules.employment.id)
	)) {
		if (!entry.charges.some((charge) => charge.date === date)) continue;
		const range = timeOffRangeOf(entry);
		if (range == null) continue;
		for (const half of ['FIRST', 'SECOND'] as const) {
			const point = pointNumber({ date, half });
			if (point >= pointNumber(range.start) && point <= pointNumber(range.end)) occupied.add(half);
		}
	}
	return {
		eligible: true as const,
		evidence,
		occupied,
		term,
		shift: shift != null && coversDate(shift.effective_range, date) ? shift : null,
		workDay: override ?? null,
		catalogue: rules.catalogueOn(date),
		labels: workWindowHalves(shift?.variant)
	};
}

function activityDateOf(entry: LeaveActivity): string | null {
	if (leaveActivityOf(entry) === 'TIME_OFF') return entry.from_date ?? null;
	return entry.effective_on ?? null;
}

/** Complete entry planning is pure over the guarded preparation reads, including batch reservations. */
export function planLeaveActivity(
	context: LeaveContext,
	input: LeaveSubmission,
	id: string,
	entries: readonly LeaveActivity[] = context.entries
) {
	// The event the entry answers to, as its declared facts record it (`leave_catalogue.event_facts`).
	const event = leaveEventOf(input);
	const rules = leaveRules(
		context,
		input.employment_id,
		input.catalogue_id,
		event.kind == null &&
			event.relationship == null &&
			event.child_index == null &&
			event.wife_prior_living_biological_children == null
			? undefined
			: {
					kind: event.kind,
					relationship: event.relationship,
					child_index: event.child_index,
					wife_prior_living_biological_children: event.wife_prior_living_biological_children,
					date: event.date
				}
	);
	if (!input.reference.trim()) refuse('A leave entry needs a unique supporting reference.');
	const pools = leavePool(context, input.employment_id, rules, entries);
	const sameLeave = pools.own;
	if (
		entries.some(
			(row) => row.employment_id === input.employment_id && row.reference === input.reference
		)
	)
		refuse('A leave entry with this reference already exists or is awaiting approval.');
	let fields: FlatFields = {
		...emptyActivityFields(),
		from_date: input.from_date ?? null,
		to_date: input.to_date ?? null,
		half_day_start: input.half_day_start ?? null,
		half_day_end: input.half_day_end ?? null,
		no_pay_origin: input.no_pay_origin ?? null,
		days: input.days ?? null,
		hours: input.hours ?? null,
		encash_days: input.encash_days ?? null,
		encash_hours: input.encash_hours ?? null,
		as_adjustment_entry: input.as_adjustment_entry ?? false,
		reversal_of_id: input.reversal_of_id ?? null,
		effective_on: input.effective_on ?? null,
		due_on: input.due_on ?? null,
		destination_from: input.destination_from ?? null,
		destination_to: input.destination_to ?? null,
		available_from: input.available_from ?? null,
		expires_on: input.expires_on ?? null,
		reason: input.reason ?? null,
		facts: input.facts ?? {}
	};
	const charges: LeaveCharge[] = [];
	const allocations: LeaveAllocation[] = [];
	const pooled: { window: LeaveWindow; date: string; days: number }[] = [];
	let certificateRequired = false;
	/**
	 * The share of a charged day that counts in the pool this row draws from: all of it, or only
	 * what lies beyond the row's own `consumes_after_days` in the leave year (TW menstrual leave:
	 * three days a year outside the sick quota). Counted over the row's own approved days in the
	 * window plus this entry's earlier charges.
	 */
	let poolExemptSpent = 0;
	const poolShare = (date: string, days: number): number => {
		const rule = rules.catalogueOn(date).entitlement;
		const exempt = rule.consumes_after_days;
		if (exempt == null) return days;
		// The exemption is a year's, whatever window the row itself keeps (a monthly grant):
		// UPFRONT reads the leave year the same `year_start_month` and anchor already give.
		const year = leaveWindowOf(date, { ...rule, availability: 'UPFRONT' }, rules.hire);
		const own = activeTimeOff(sameLeave)
			.flatMap((row) => row.charges)
			.filter((row) => row.date >= year.start && row.date <= year.end)
			.reduce((sum, row) => sum + row.days, 0);
		const left = Math.max(0, exempt - own - poolExemptSpent);
		const kept = Math.min(days, left);
		poolExemptSpent += kept;
		return days - kept;
	};
	const debit = (
		window: LeaveWindow,
		date: string,
		days: number,
		basis: 'available' | 'earned'
	) => {
		assertLeaveWindow(window, rules.catalogueOn(date).entitlement, rules.hire);
		allocations.push(
			...allocateLeaveDays({
				entries: [...sameLeave, { id, allocations, approval_id: 'planning' }],
				window,
				date,
				days,
				entitlementAt: rules.entitlementAt,
				carryFrom: rules.carryFrom,
				basis
			})
		);
		// The same day also counts inside the pool this row draws from; a rolling pool was judged
		// over its window instead (`judgePoolRolling`).
		if (
			pools.pool != null &&
			pools.pool.rules.catalogueOn(date).entitlement.rolling_months == null
		) {
			const poolWindow = leaveWindowOf(
				date,
				pools.pool.rules.catalogueOn(date).entitlement,
				pools.pool.rules.hire
			);
			const pooledDays = poolShare(date, days);
			if (pooledDays > 0)
				allocations.push(
					...allocateLeaveDays({
						entries: [
							...pools.pool.entries,
							{ id, allocations, approval_id: 'planning', leave_code: rules.selected.code }
						],
						window: poolWindow,
						date,
						days: pooledDays,
						entitlementAt: pools.pool.rules.entitlementAt,
						carryFrom: pools.pool.rules.carryFrom,
						basis,
						pool: pools.pool.code
					})
				);
		}
	};
	/** The person's active time off of this code under their other employments here. */
	const priorTimeOff = () => {
		const employeeId = context.employments.find(
			(row) => row.id === input.employment_id
		)?.employee_id;
		return activeTimeOff(
			// repository-health:allow R3b -- a prior entry carries the fields `activeTimeOff` reads, not a whole activity
			(context.priorEntries ?? []).filter(
				(row) => row.employee_id === employeeId && row.leave_code === rules.selected.code
			) as unknown as LeaveActivity[]
		);
	};
	/** Lifetime statutory day caps count the comparable full-time days represented by saved hours. */
	const equivalentDays = (charge: LeaveCharge): number => {
		if (charge.hours == null) return charge.days;
		const term = context.terms.find((row) => row.id === charge.employment_term_id);
		if (term == null)
			refuse('An earlier hourly leave charge needs its dated employment terms for a lifetime cap.');
		const basis = hourlyLeaveBasis(
			rules.catalogueOn(charge.date).entitlement,
			term,
			context.patterns.find((row) => row.id === term.shift_pattern_id)?.pattern ?? null,
			new Map(context.shifts.map((row) => [row.id, row]))
		);
		if (basis == null) refuse('An hourly leave charge has no comparable full-time basis.');
		return charge.hours / basis.grantHoursPerDay;
	};
	/** The days already charged in a window over a set of entries. */
	const chargedIn = (rows: readonly LeaveActivity[], from: string, to: string): number =>
		rows
			.flatMap((row) => row.charges)
			.filter((row) => row.date >= from && row.date <= to)
			.reduce((sum, row) => sum + row.days, 0);
	/** The first day of the `months`-month window ending on `date`. */
	const rollingFrom = (date: string, months: number): string =>
		addDays(
			monthDay(
				Number.parseInt(date.slice(0, 4), 10),
				Number.parseInt(date.slice(5, 7), 10) - 1 - months,
				Number.parseInt(date.slice(8, 10), 10)
			),
			1
		);
	/**
	 * A row that draws from a rolling-window pool (TW sick leave inside the year-within-two of
	 * hospitalised sickness) is judged against that window over the pool's own and its consumers'
	 * charges, not allocated on a leave year the pool does not keep.
	 */
	const judgePoolRolling = (charged: readonly LeaveCharge[]): boolean => {
		const pool = pools.pool;
		const first = charged[0];
		if (pool == null || first == null) return false;
		const poolRule = pool.rules.catalogueOn(first.date).entitlement;
		if (poolRule.rolling_months == null) return false;
		// ponytail: a consumer's earlier days count in a rolling pool whole — no version pairs
		// `consumes_after_days` with a rolling pool; split them by allocation if one does.
		const pooledOf = new Map<string, number>();
		for (const charge of charged) pooledOf.set(charge.date, poolShare(charge.date, charge.days));
		poolExemptSpent = 0;
		for (const charge of charged) {
			const from = rollingFrom(charge.date, poolRule.rolling_months);
			const already = chargedIn(activeTimeOff(pool.entries), from, charge.date);
			const within = charged
				.filter((row) => row.date >= from && row.date <= charge.date)
				.reduce((sum, row) => sum + (pooledOf.get(row.date) ?? row.days), 0);
			const granted = grantedDays(poolRule, pool.rules.personOn(charge.date));
			if (already + within > granted + 1e-9)
				refuse(
					`${pool.code} allows ${granted} days in any ${poolRule.rolling_months} months, and ${rules.selected.code} counts inside it; ${already} are already taken in the ${poolRule.rolling_months} months before ${charge.date}.`
				);
		}
		return true;
	};
	/**
	 * Per-child lifetime caps (`child_lifetime`): every day of this leave, taken here, under the
	 * person's other employments here and now asked for, is placed on one child's cap whose predicate
	 * holds on the first or last day of that day's leave year. The days fit when such a placement
	 * exists — a transport problem (leave years to caps), answered by maximum flow.
	 */
	const judgeChildLifetime = (
		caps: NonNullable<ReturnType<typeof rules.catalogueOn>['entitlement']['child_lifetime']>,
		rule: ReturnType<typeof rules.catalogueOn>['entitlement'],
		charged: readonly LeaveCharge[]
	): void => {
		const own = activeTimeOff(sameLeave).filter((row) => row.leave_code === rules.selected.code);
		const earlier = [...own, ...priorTimeOff()].flatMap((row) => row.charges);
		const taken = earlier.reduce((sum, row) => sum + equivalentDays(row), 0);
		const years = new Map<string, { window: LeaveWindow; days: number }>();
		for (const charge of [...earlier, ...charged]) {
			const window = leaveWindowOf(charge.date, rule, rules.hire);
			const year = years.get(window.start) ?? { window, days: 0 };
			year.days += equivalentDays(charge);
			years.set(window.start, year);
		}
		const first = charged[0]!.date;
		const buckets = rules.children.flatMap((_, child) =>
			caps.map((cap) => ({
				room: Predicate.isString(cap.days)
					? Math.max(0, evaluatePersonNumber(cap.days, rules.childPersonOn(first, child)))
					: cap.days,
				holds: (window: LeaveWindow) =>
					[window.start, window.end].some((date) =>
						isEligible(cap.eligibility, rules.childPersonOn(date, child))
					)
			}))
		);
		const supply = [...years.values()];
		const reach = supply.map(({ window }) => buckets.map((bucket) => bucket.holds(window)));
		const added = charged.reduce((sum, row) => sum + equivalentDays(row), 0);
		const granted = buckets
			.filter((_, index) => reach.some((row) => row[index]))
			.reduce((sum, bucket) => sum + bucket.room, 0);
		if (
			placeable(
				supply.map((year) => year.days),
				buckets.map((bucket) => bucket.room),
				reach
			) +
				1e-9 <
			taken + added
		)
			refuse(
				`${rules.selected.code} is granted for ${granted} days in a lifetime; ${taken} are already taken and this would add ${added}.`
			);
	};
	/**
	 * A lifetime cap in days (`lifetime_days`, SG GPCL: 42 a child) is counted over every leave
	 * year and every employment of the person here.
	 */
	const judgeLifetimeDays = (charged: readonly LeaveCharge[]): void => {
		const first = charged[0];
		if (first == null) return;
		const rule = rules.catalogueOn(first.date).entitlement;
		if (rule.child_lifetime != null && rule.child_lifetime.length > 0) {
			judgeChildLifetime(rule.child_lifetime, rule, charged);
			return;
		}
		if (rule.lifetime_days == null) return;
		const person = rules.personOn(first.date);
		const cap = Predicate.isString(rule.lifetime_days)
			? Math.max(0, evaluatePersonNumber(rule.lifetime_days, person))
			: rule.lifetime_days;
		const own = activeTimeOff(sameLeave).filter((row) => row.leave_code === rules.selected.code);
		const taken = [...own, ...priorTimeOff()]
			.flatMap((row) => row.charges)
			.reduce((sum, row) => sum + equivalentDays(row), 0);
		const added = charged.reduce((sum, row) => sum + equivalentDays(row), 0);
		if (taken + added > cap + 1e-9)
			refuse(
				`${rules.selected.code} is granted for ${cap} days in a lifetime; ${taken} are already taken and this would add ${added}.`
			);
	};
	/**
	 * A weekly cap (`weekly_days`, TW 勞基法 §16(2): two days of job-search leave a week) is counted
	 * over each Monday-to-Sunday week: this leave's approved and pending days, and this entry's.
	 */
	const judgeWeekly = (charged: readonly LeaveCharge[]): void => {
		const own = activeTimeOff(sameLeave)
			.filter((row) => row.leave_code === rules.selected.code)
			.flatMap((row) => row.charges);
		for (const charge of charged) {
			const cap = rules.catalogueOn(charge.date).entitlement.weekly_days;
			if (cap == null) continue;
			const monday = weekStart(charge.date);
			const sunday = addDays(monday, 6);
			const inWeek = (rows: readonly LeaveCharge[]) =>
				rows
					.filter((row) => row.date >= monday && row.date <= sunday)
					.reduce((sum, row) => sum + row.days, 0);
			const already = inWeek(own);
			if (already + inWeek(charged) > cap + 1e-9)
				refuse(
					`${rules.selected.code} allows ${cap} days a week; ${already} are already taken in the week of ${monday}.`
				);
		}
	};
	/**
	 * A grant that is not an annual pool is judged on the entry itself: a PER_EVENT row against
	 * the days its bands grant for this event and the events a lifetime allows; a rolling-window
	 * row against the days already charged in the months before each charge.
	 */
	const judgeUnpooled = (charged: readonly LeaveCharge[], quantity: number): boolean => {
		const first = charged[0];
		if (first == null) return false;
		const rule = rules.catalogueOn(first.date).entitlement;
		if (rule.availability === 'PER_EVENT') {
			// A leave code the version declares a benefit case for grants what its event's case facts
			// decide (`event.case.facts`): an extension counts once the case proves it.
			const caseType = caseTypesOf(rules.settingsOn(first.date)).find(
				(row) => row.case_type === rules.selected.code
			);
			const benefitCase =
				caseType == null || event.date == null
					? undefined
					: context.benefitCases?.find(
							(row) =>
								row.employment_id === input.employment_id &&
								row.case_type === caseType.case_type &&
								row.event_kind === event.kind &&
								dateKey(row.event_on) === event.date
						);
			const person = rules.personOn(first.date, {
				kind: event.kind,
				relationship: event.relationship,
				child_index: event.child_index,
				wife_prior_living_biological_children: event.wife_prior_living_biological_children,
				date: event.date,
				case:
					caseType == null || benefitCase == null
						? null
						: {
								facts: caseSite(
									caseType,
									benefitCase,
									evidenceOf(context.benefitEvidence ?? [], benefitCase.id)
								).case.facts
							}
			});
			const granted = grantedDays(rule, person);
			// The grant is the event's, not the entry's: a second entry for the same event — the
			// twin's, or the rest of a grant filed in two blocks — draws on what the first left.
			// Twins are one birth (MSF: multiple births carry one entitlement), so the event is its
			// kind, relationship and date, not the child; an entry that names no date is its own event.
			const sameEvent = (row: LeaveActivity) =>
				event.date != null &&
				leaveEventOf(row).kind === event.kind &&
				(caseType != null || leaveEventOf(row).relationship === event.relationship) &&
				leaveEventOf(row).date === event.date;
			const eventCharges = activeTimeOff(sameLeave)
				.filter(
					(row) =>
						row.leave_code === rules.selected.code &&
						row.employment_id === input.employment_id &&
						sameEvent(row)
				)
				.flatMap((row) => row.charges);
			if (rule.calendar_months === true) {
				// The grant is a span of calendar months from the event's first leave day; the days
				// the roster charges inside it are the leave, rest days and holidays included in it.
				const opening = [...charged, ...eventCharges].map((row) => row.date).toSorted()[0]!;
				const last = monthsEnd(opening, granted);
				const late = charged.find((row) => row.date > last);
				if (late != null)
					refuse(
						`${rules.selected.code} grants ${granted} months for this event, ${opening} through ${last}; ${late.date} falls after them.`
					);
			} else {
				const alreadyForEvent = eventCharges.reduce((sum, row) => sum + row.days, 0);
				if (alreadyForEvent + quantity > granted + 1e-9)
					refuse(
						`${rules.selected.code} grants ${granted} days for this event; ${alreadyForEvent} are already taken and this would add ${quantity}.`
					);
			}
			// Counted over the person: this employment's entries and their other employments' here.
			const taken =
				activeTimeOff(sameLeave).filter(
					(row) =>
						row.leave_code === rules.selected.code && row.employment_id === input.employment_id
				).length + priorTimeOff().length;
			if (rule.lifetime_events != null && taken >= rule.lifetime_events)
				refuse(
					`${rules.selected.code} is granted for ${rule.lifetime_events} events in a lifetime; this would be event ${taken + 1}.`
				);
			return true;
		}
		// An unmetered leave granted a fixed number of times in the employment (ID religious duty,
		// once with the same employer): the events are counted, the days are not.
		if (rule.availability === 'UNLIMITED' && rule.lifetime_events != null) {
			const taken =
				activeTimeOff(sameLeave).filter(
					(row) =>
						row.leave_code === rules.selected.code && row.employment_id === input.employment_id
				).length + priorTimeOff().length;
			if (taken >= rule.lifetime_events)
				refuse(
					`${rules.selected.code} is granted for ${rule.lifetime_events} events in a lifetime; this would be event ${taken + 1}.`
				);
			return true;
		}
		if (
			rule.child_years === true &&
			isEligible(rule.child_years_when ?? '', rules.personOn(first.date))
		) {
			// Every day, earlier or asked for, on the pool of a child whose year from its birth date
			// holds it: a transport problem (days to child-years), answered by maximum flow.
			const own = activeTimeOff(sameLeave).filter((row) => row.leave_code === rules.selected.code);
			const earlier = [...own, ...priorTimeOff()].flatMap((row) => row.charges);
			const room = new Map<string, number>();
			/** The child-years holding a day: each child's year from the last birthday on or before it. */
			const yearsOf = (date: string): string[] =>
				rules.children.flatMap((row, child) => {
					const born = dateKey(row.child_birthdate);
					if (born == null || born > date) return [];
					const [m, d] = [born.slice(5, 7), born.slice(8, 10)].map(Number) as [number, number];
					const y = Number.parseInt(date.slice(0, 4), 10);
					const start =
						monthDay(y, m - 1, d) <= date ? monthDay(y, m - 1, d) : monthDay(y - 1, m - 1, d);
					const key = `${child}/${start}`;
					// Read from the hire when the child's year opened before it: the terms (the worksite a
					// band names) begin there, and the child's age is the same on every day of its year.
					const read = start < rules.hire ? rules.hire : start;
					if (!room.has(key)) room.set(key, grantedDays(rule, rules.childPersonOn(read, child)));
					return [key];
				});
			const reach = [...earlier, ...charged].map((row) => yearsOf(row.date));
			const keys = [...room.keys()];
			const placed = (count: number) =>
				placeable(
					[...earlier, ...charged].slice(0, count).map((row) => row.days),
					keys.map((key) => room.get(key)!),
					reach.slice(0, count).map((row) => keys.map((key) => row.includes(key)))
				);
			const before = placed(earlier.length);
			if (placed(reach.length) - before + 1e-9 < quantity)
				refuse(
					`${rules.selected.code} grants its days in each year from a child's birth date; ${before} are already taken and this would add ${quantity}.`
				);
			return true;
		}
		if (rule.rolling_months != null) {
			for (const charge of charged) {
				const from = rollingFrom(charge.date, rule.rolling_months);
				const already = chargedIn(activeTimeOff(sameLeave), from, charge.date);
				const within = charged
					.filter((row) => row.date >= from && row.date <= charge.date)
					.reduce((sum, row) => sum + row.days, 0);
				const granted = grantedDays(rule, rules.personOn(charge.date));
				if (already + within > granted + 1e-9)
					refuse(
						`${rules.selected.code} allows ${granted} days in any ${rule.rolling_months} months; ${already} are already taken in the ${rule.rolling_months} months before ${charge.date}.`
					);
			}
			return true;
		}
		return false;
	};
	const activity: LeaveActivityKind = leaveActivityOf(fields);
	switch (activity) {
		case 'TIME_OFF': {
			const range = timeOffRangeOf(fields);
			if (range == null) refuse('Time off needs a start and end date.');
			if (rules.selected.requires_no_pay_origin === true && fields.no_pay_origin == null)
				refuse(`${rules.selected.code} needs its employee-request origin recorded.`);
			if (rules.selected.requires_no_pay_origin === true && fields.no_pay_origin === 'OTHER')
				refuse(
					`${rules.selected.code} without an employee request needs its lawful pay and service basis assessed.`
				);
			if (
				event.date == null &&
				daysBetween(range.start.date, range.end.date).some(
					(date) => rules.catalogueOn(date).entitlement.availability === 'PER_EVENT'
				)
			)
				refuse(
					`Per-event leave requires the dated event that grants it: ${rules.selected.code} entry ${input.reference} names no event date.`
				);
			if (pointNumber(range.end) < pointNumber(range.start))
				refuse('Leave must end after it starts.');
			if (range.start.date < rules.hire || (rules.exit != null && range.end.date > rules.exit))
				refuse('Time off must fall within the employment dates.');
			const dates = daysBetween(range.start.date, range.end.date);
			if (
				(range.start.half !== 'FIRST' || range.end.half !== 'SECOND') &&
				dates.some((date) => rules.catalogueOn(date).entitlement.calendar_days === true)
			)
				refuse(
					`${rules.selected.code} counts whole calendar days; a half-day leave cannot be approved.`
				);
			// SG EA s.88(2): a public holiday enclosed by no-pay leave the employee asked for is not
			// paid — where the version says so, a no-pay row charges the holiday too, read through
			// the roster as the working day it would have been. The first and last day of the range
			// are never such a holiday: the leave must stand on both sides of it.
			const holidayUnpaid =
				rules.selected.is_npl === true &&
				fields.no_pay_origin === 'EMPLOYEE_REQUESTED' &&
				rules.settingsOn(range.start.date).payroll.holiday_in_no_pay_leave_unpaid === true;
			for (const date of dates) {
				const enclosed = holidayUnpaid && date !== range.start.date && date !== range.end.date;
				const day = measureLeaveDay(context, rules, date, entries, enclosed);
				if (!day.eligible) {
					if (day.reason === 'HOLIDAY' || day.reason === 'REST_OR_OFF') {
						if (rules.catalogueOn(date).entitlement.calendar_days === true)
							refuse(
								`${rules.selected.code} counts ${date} as a calendar leave day, but this HRMS cannot yet charge a holiday or rest day. Approve a supported leave span only after calendar-day charging is available.`
							);
						continue;
					}
					refuse(`Leave on ${date} cannot be approved: ${day.reason}.`);
				}
				let halves = 0;
				for (const half of ['FIRST', 'SECOND'] as const) {
					const point = pointNumber({ date, half });
					if (point < pointNumber(range.start) || point > pointNumber(range.end)) continue;
					if (day.occupied.has(half))
						refuse(`Leave overlaps an approved or pending ${half.toLowerCase()} half on ${date}.`);
					halves += 1;
				}
				// TW Leave Regulations art. 7(2): the hour is a unit only where the catalogue says so.
				const hourlyBasis = hourlyLeaveBasis(
					day.catalogue.entitlement,
					day.term,
					context.patterns.find((row) => row.id === day.term.shift_pattern_id)?.pattern ?? null,
					new Map(context.shifts.map((row) => [row.id, row]))
				);
				if (fields.hours != null && day.catalogue.unit !== 'HOUR' && hourlyBasis == null)
					refuse(`${day.catalogue.code} is taken by the day or half day, not by the hour.`);
				if (fields.hours != null && day.shift == null)
					refuse(`${day.catalogue.code} needs a working shift to measure hours on ${date}.`);
				const paidHours =
					day.shift == null ? 0 : (workWindow(day.shift.variant)?.paid_minutes ?? 0) / 60;
				if (hourlyBasis != null && !(paidHours > 0))
					refuse(`${day.catalogue.code} needs scheduled paid hours on ${date}.`);
				const chargedHours =
					hourlyBasis == null ? null : (fields.hours ?? (paidHours * halves) / 2);
				if (
					chargedHours != null &&
					(!Number.isFinite(chargedHours) ||
						chargedHours <= 0 ||
						chargedHours > (paidHours * halves) / 2 + 1e-9 ||
						(fields.hours != null && range.start.date !== range.end.date))
				)
					refuse('Hourly leave must fit the selected scheduled time on one day.');
				const days =
					chargedHours != null
						? chargedHours / paidHours
						: day.catalogue.unit === 'HOUR' && fields.hours != null
							? hourlyShare(
									fields.hours,
									range,
									day.shift!.variant,
									day.catalogue.entitlement.hour_share_step
								)
							: halves === 2
								? 1
								: 0.5;
				charges.push({
					date,
					days,
					...(chargedHours == null ? {} : { hours: chargedHours }),
					catalogue_id: day.catalogue.id,
					employment_term_id: day.term.id,
					holiday_id: day.evidence.holiday_id,
					shift_definition_id: day.shift?.id ?? null,
					work_day_id: day.workDay?.id ?? null
				});
				pooled.push({
					window: leaveWindowOf(date, day.catalogue.entitlement, rules.hire),
					date,
					days: chargedHours ?? days
				});
			}
			if (charges.length === 0) refuse('The range contains no eligible scheduled work time.');
			if (event.date != null) {
				const eventDates = [
					...charges.map((charge) => charge.date),
					...activeTimeOff(sameLeave)
						.filter((row) => leaveEventOf(row).date === event.date)
						.flatMap((row) => row.charges.map((charge) => charge.date))
				];
				for (const charge of charges) {
					const rule = rules.catalogueOn(charge.date).entitlement;
					const on = rule.transition_review_on;
					if (
						rule.availability === 'PER_EVENT' &&
						on != null &&
						eventDates.some((date) => date < on) &&
						eventDates.some((date) => date >= on)
					)
						refuse(`${rules.selected.code} across ${on} requires transition review.`);
				}
			}
			const quantity = charges.reduce((sum, row) => sum + row.days, 0);
			judgeLifetimeDays(charges);
			judgeWeekly(charges);
			judgePoolRolling(charges);
			if (!judgeUnpooled(charges, quantity))
				for (const debitOf of pooled)
					debit(debitOf.window, debitOf.date, debitOf.days, 'available');
			certificateRequired = charges.some((row) => {
				const threshold = context.catalogues.find(
					(catalogue) => catalogue.id === row.catalogue_id
				)?.evidence_after_days;
				return threshold != null && quantity > threshold;
			});
			fields = {
				...fields,
				from_date: range.start.date,
				to_date: range.end.date,
				half_day_start: range.start.half === 'SECOND',
				half_day_end: range.end.half === 'FIRST',
				days: quantity,
				effective_on: range.start.date
			};
			break;
		}
		case 'ENCASHMENT': {
			if (fields.from_date == null || fields.to_date == null)
				refuse('Encashment needs a source window.');
			const source: LeaveWindow = { start: fields.from_date, end: fields.to_date };
			if (fields.encash_days != null && fields.encash_hours != null)
				refuse('An encashment has one quantity, either days or hours.');
			const quantity = fields.encash_hours ?? fields.encash_days;
			if (quantity == null || !Number.isFinite(quantity) || quantity <= 0)
				refuse('An encashment converts a positive leave quantity.');
			if (
				fields.effective_on == null ||
				fields.due_on == null ||
				fields.effective_on < source.start ||
				fields.due_on < fields.effective_on
			)
				refuse('Encashment needs effective and due dates in order after the source window begins.');
			const catalogue = context.catalogues.find((row) => row.id === input.catalogue_id);
			if (catalogue == null) refuse('Encashment names a leave row that is not available.');
			if (!catalogue.can_encash)
				refuse(`${catalogue.code} is not encashable in this settings version.`);
			const date = [
				fields.effective_on,
				source.end,
				...(rules.exit == null ? [] : [rules.exit])
			].toSorted()[0]!;
			if (date < source.start) refuse('The source window falls after this employment ended.');
			if (date < rules.hire) refuse('Encashment cannot consume leave before employment began.');
			const hourlyUnit = rules.entitlementAt(source, date).unit === 'HOUR';
			if (hourlyUnit !== (fields.encash_hours != null))
				refuse('Encashment must use the same day or hour unit as its leave balance.');
			if (hourlyUnit && (rules.exit == null || fields.effective_on !== rules.exit))
				refuse('Part-time hourly leave cash-out requires a recorded employment departure.');
			// Leave carries no pricing: the days are the entry's own quantity and payroll prices them
			// using the dated leave cash-out rule when the entry settles.
			debit(source, date, quantity, 'earned');
			fields = { ...fields, days: hourlyUnit ? null : quantity };
			break;
		}
		case 'CARRY_FORWARD': {
			if (
				fields.from_date == null ||
				fields.to_date == null ||
				fields.destination_from == null ||
				fields.destination_to == null ||
				fields.available_from == null ||
				fields.expires_on == null
			)
				refuse('Carry-forward needs source and destination windows with validity dates.');
			const source: LeaveWindow = { start: fields.from_date, end: fields.to_date };
			const destination: LeaveWindow = {
				start: fields.destination_from,
				end: fields.destination_to
			};
			assertLeaveWindow(
				destination,
				rules.catalogueOn(fields.available_from).entitlement,
				rules.hire
			);
			if (
				destination.start <= source.end ||
				fields.available_from < destination.start ||
				fields.expires_on > destination.end ||
				fields.available_from > fields.expires_on
			)
				refuse(
					'Carry-forward needs a later destination window and validity dates inside that window.'
				);
			const sourceUnit = rules.entitlementAt(source, source.end).unit;
			const destinationUnit = rules.entitlementAt(destination, fields.available_from).unit;
			if (sourceUnit !== destinationUnit)
				refuse('A carry-forward cannot move between day and hour leave balances.');
			const quantity = sourceUnit === 'HOUR' ? fields.hours : fields.days;
			if (
				(sourceUnit === 'HOUR' ? fields.days != null : fields.hours != null) ||
				quantity == null ||
				!Number.isFinite(quantity) ||
				quantity <= 0
			)
				refuse('A carry-forward needs a positive quantity in its leave balance unit.');
			debit(source, source.end, quantity, 'earned');
			break;
		}
		case 'ADJUSTMENT': {
			if (fields.from_date == null || fields.to_date == null)
				refuse('A leave adjustment needs its stated window.');
			const window: LeaveWindow = { start: fields.from_date, end: fields.to_date };
			if (fields.effective_on == null)
				refuse('A leave adjustment must fall inside its stated window.');
			assertLeaveWindow(window, rules.catalogueOn(fields.effective_on).entitlement, rules.hire);
			if (!fields.reason?.trim()) refuse('A leave adjustment needs a reason.');
			if (fields.effective_on < window.start || fields.effective_on > window.end)
				refuse('A leave adjustment must fall inside its stated window.');
			const unit = rules.entitlementAt(window, fields.effective_on).unit;
			const quantity = unit === 'HOUR' ? fields.hours : fields.days;
			if (
				(unit === 'HOUR' ? fields.days != null : fields.hours != null) ||
				quantity == null ||
				!Number.isFinite(quantity) ||
				quantity === 0
			)
				refuse('A leave adjustment needs a signed quantity in its leave balance unit.');
			if (quantity < 0) debit(window, fields.effective_on, -quantity, 'available');
			else
				allocations.push({
					window,
					date: fields.effective_on,
					days: unit === 'HOUR' ? 0 : quantity,
					...(unit === 'HOUR' ? { hours: quantity } : {}),
					credit_entry_id: null
				});
			break;
		}
		case 'REVERSAL': {
			if (
				(input.charges?.length ?? 0) > 0 ||
				fields.encash_days != null ||
				fields.encash_hours != null ||
				fields.destination_from != null ||
				fields.destination_to != null
			)
				refuse('A reversal cannot also carry charges, encashed days or a carry destination.');
			const originalId = fields.reversal_of_id;
			const original = sameLeave.find((row) => row.id === originalId && row.approval_id == null);
			if (!original)
				refuse('A reversal must reference an approved entry for this employment and leave type.');
			if (
				sameLeave.some(
					(row) => row.as_adjustment_entry === true && row.reversal_of_id === originalId
				)
			)
				refuse('This leave entry is already reversed or has a pending reversal.');
			if (!fields.reason?.trim()) refuse('A reversal needs a reason.');
			const originalDate = activityDateOf(original);
			if (
				fields.effective_on == null ||
				(originalDate != null && fields.effective_on < originalDate)
			)
				refuse('A reversal cannot precede its original activity.');
			let currency: string | null = null;
			let total = 0n;
			if (original.payslip_id != null) {
				// This person's own payslip. Payment is per slip, so a colleague still waiting on a
				// correction no longer holds this reversal — the run reading DRAFT because of them
				// used to refuse a reversal whose money had in fact been paid.
				const payslip = context.payslips.find((row) => row.id === original.payslip_id);
				if (payslip == null || payslip.paid_at == null)
					refuse('Delete or settle the draft payroll holding this leave before reversing it.');
				// The settled lines are the frozen evidence, so the
				// reversal negates the gross it reads back off the payslip the entry is pinned to.
				for (const line of payslip.adjustments) {
					if (line.family !== 'LEAVE' || line.source_id !== original.id) continue;
					if (currency != null && currency !== payslip.currency)
						refuse('Leave captures use inconsistent currencies.');
					currency = payslip.currency;
					total += toMinorUnits(
						line.bucket === 'ABSENCE' ? -line.amount : line.amount,
						payslip.currency
					);
				}
			}
			const gross =
				currency == null || total === 0n
					? null
					: { value: fromMinorUnits(-total, currency), currency };
			if (gross != null && (fields.due_on == null || fields.due_on < fields.effective_on))
				refuse('A paid leave correction needs a due date on or after its effective date.');
			allocations.push(...reverseLeaveAllocations(original));
			const originalActivity = leaveActivityOf(original);
			const days =
				originalActivity === 'TIME_OFF'
					? original.days
					: originalActivity === 'REVERSAL'
						? null
						: original.days == null
							? null
							: Math.abs(original.days);
			fields = {
				...fields,
				days,
				hours:
					originalActivity === 'TIME_OFF'
						? (original.hours ?? null)
						: original.hours == null
							? null
							: Math.abs(original.hours),
				due_on: gross == null ? null : fields.due_on
			};
			break;
		}
	}
	const windowsFor = (pool: string | null) => [
		...new Map(
			allocations
				.filter((row) => (row.pool ?? null) === pool)
				.map((row) => [row.window.start, row.window])
		).values()
	];
	const affectedWindows = (
		pool: string | null,
		entries: readonly { readonly allocations: readonly LeaveAllocation[] }[],
		leaveRule: typeof rules
	) => {
		const windows = windowsFor(pool);
		const known = entries.flatMap((entry) => entry.allocations.map((row) => row.window));
		const successors = windows.flatMap((source) =>
			leaveRule.catalogueAt(source.end)?.entitlement.auto_carry_one_year === true
				? known.filter((window) => window.start === addDays(source.end, 1))
				: []
		);
		return [
			...new Map([...windows, ...successors].map((window) => [window.start, window])).values()
		];
	};
	const proposed = { id, ...fields, allocations, approval_id: null };
	const ownEntries = [...sameLeave, proposed];
	// Only a debit can overdraw. A row that gives days back (a time-off reversal) is not judged on
	// an overdraft other entries already hold: the repair of a broken entry must stay open.
	const debits = allocations.some((row) => row.days < 0 || (row.hours ?? 0) < 0);
	if (debits)
		assertLeaveBalanceIntegrity(
			ownEntries,
			affectedWindows(null, ownEntries, rules),
			rules.entitlementAt,
			undefined,
			rules.carryFrom
		);
	if (debits && pools.pool != null) {
		const poolEntries = [...pools.pool.entries, { ...proposed, leave_code: rules.selected.code }];
		assertLeaveBalanceIntegrity(
			poolEntries,
			affectedWindows(pools.pool.code, poolEntries, pools.pool.rules),
			pools.pool.rules.entitlementAt,
			pools.pool.code,
			pools.pool.rules.carryFrom
		);
	}
	// A full requested no-pay day shortens the service of every leave that counts it net
	// (`entitlement.replans_on_no_pay`): that leave's balances are re-planned without it.
	const replanned =
		activity === 'TIME_OFF' &&
		rules.selected.is_npl === true &&
		fields.no_pay_origin === 'EMPLOYEE_REQUESTED' &&
		fields.half_day_start !== true &&
		fields.half_day_end !== true &&
		charges.every((charge) => charge.days >= 1 - 1e-9)
			? context.catalogues.filter(
					(row) =>
						row.settings_id === rules.settingsOn(fields.from_date!).id &&
						row.entitlement.replans_on_no_pay === true
				)
			: [];
	for (const annual of replanned) {
		const annualEntries = entries.filter(
			(row) => row.employment_id === input.employment_id && row.leave_code === annual.code
		);
		const annualRules = leaveRules(
			{
				...context,
				projected: true,
				entries: [
					...entries,
					{
						...proposed,
						employment_id: input.employment_id,
						catalogue_id: rules.selected.id,
						leave_code: rules.selected.code,
						reference: input.reference,
						charges,
						payslip_id: null
					}
				]
			},
			input.employment_id,
			annual.id
		);
		const windows = [
			leaveWindowOf(fields.from_date!, annual.entitlement, rules.hire),
			leaveWindowOf(fields.to_date!, annual.entitlement, rules.hire),
			...annualEntries.flatMap((row) => row.allocations.map((allocation) => allocation.window))
		];
		for (const window of new Map(windows.map((row) => [row.start, row])).values()) {
			const balance = leaveBalanceAt({
				entries: annualEntries,
				window,
				date: window.end,
				entitlementAt: annualRules.entitlementAt,
				carryFrom: annualRules.carryFrom
			});
			if ((balance.balance ?? 0) < -1e-9 || (balance.available ?? 0) < -1e-9)
				refuse(`${rules.selected.code} reduces the ${annual.code} balance below existing usage.`);
		}
	}
	return {
		employment_id: input.employment_id,
		catalogue_id: rules.selected.id,
		leave_code: rules.selected.code,
		reference: input.reference,
		...fields,
		summary: leaveSummary(activity, fields),
		charges,
		allocations,
		// A planned entry is not settled: the payroll stamps the pin when it consumes the row.
		payslip_id: null,
		certificateRequired
	};
}

/**
 * The share of a day some hours of leave are: the hours over the shift's paid hours, to the
 * row's `hour_share_step` (and never less than one step; absent is the exact share), never more
 * than the day. One day at a time: hourly leave over a range is refused, because the hours name
 * one shift, and a shift without paid hours has no day to share.
 */
function hourlyShare(
	hours: number,
	range: HalfDayRange,
	variant: RosterCodeVariant,
	step: number | null | undefined
): number {
	if (range.start.date !== range.end.date)
		refuse('Leave by the hour is taken one day at a time: name the day and its hours.');
	if (!Number.isFinite(hours) || hours <= 0) refuse('Leave by the hour needs the hours.');
	const paidMinutes = workWindow(variant)?.paid_minutes ?? 0;
	if (!(paidMinutes > 0)) refuse('Leave by the hour needs a shift with paid hours.');
	const share = hours / (paidMinutes / 60);
	return Math.min(
		1,
		step == null ? share : Math.max(step, roundToStep(share, { step, mode: 'HALF_UP' }))
	);
}

/** The record label the ledger and pickers read: the activity and the day it turns on. */
function leaveSummary(kind: LeaveActivityKind, fields: LeaveEntryActivity): string {
	return `${kind} · ${fields.from_date ?? fields.effective_on ?? ''}`;
}

/**
 * The most of `supply[i]` that can be placed on caps `room[j]` along the edges `reach[i][j]`:
 * augmenting paths over source → supply → cap → sink.
 */
function placeable(
	supply: readonly number[],
	room: readonly number[],
	reach: readonly (readonly boolean[])[]
): number {
	const left = [...supply];
	const free = [...room];
	const flow = supply.map(() => room.map(() => 0));
	let total = 0;
	for (;;) {
		// Breadth-first from every supply with days left; a cap node may send back along its flow.
		const fromSupply = new Map<number, number>(); // cap → supply it was reached from
		const fromCap = new Map<number, number>(); // supply → cap it was reached from
		const queue: ['s' | 'c', number][] = [];
		left.forEach((days, i) => {
			if (days > 1e-9) {
				fromCap.set(i, -1);
				queue.push(['s', i]);
			}
		});
		let sink = -1;
		while (queue.length > 0 && sink < 0) {
			const [kind, node] = queue.shift()!;
			if (kind === 's') {
				for (let j = 0; j < room.length; j += 1)
					if (reach[node]![j] && !fromSupply.has(j)) {
						fromSupply.set(j, node);
						if (free[j]! > 1e-9) {
							sink = j;
							break;
						}
						queue.push(['c', j]);
					}
			} else
				for (let i = 0; i < supply.length; i += 1)
					if (flow[i]![node]! > 1e-9 && !fromCap.has(i)) {
						fromCap.set(i, node);
						queue.push(['s', i]);
					}
		}
		if (sink < 0) return total;
		// Walk back to the origin: forward edges (i, j) carry any amount; the backward step from a
		// supply to the cap it was reached from gives up flow already placed there.
		const path: [number, number][] = [];
		for (let j = sink; j >= 0;) {
			const i = fromSupply.get(j)!;
			path.push([i, j]);
			j = fromCap.get(i)!;
		}
		const origin = path.at(-1)![0];
		let push = Math.min(free[sink]!, left[origin]!);
		for (let k = 0; k + 1 < path.length; k += 1)
			push = Math.min(push, flow[path[k]![0]]![path[k + 1]![1]]!);
		for (let k = 0; k < path.length; k += 1) {
			const [i, j] = path[k]!;
			flow[i]![j]! += push;
			if (k + 1 < path.length) flow[i]![path[k + 1]![1]]! -= push;
		}
		free[sink]! -= push;
		left[origin]! -= push;
		total += push;
	}
}
