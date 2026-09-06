import { Effect } from 'effect';
import { refuse, type AutomationApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceRow } from '../../collections/leave_requests/$types.js';
import { decodeNumber } from '@norbital-ai/std/json';
import {
	addDays,
	completedMonths,
	completedYears
} from '../../collections/payroll_runs/lib/dates.js';
import { coversDate, readRange } from '../../collections/payroll_runs/lib/effective.js';
import { isEligible } from '../../collections/payroll_runs/lib/eligibility.js';
import { roundHalfDay } from '../../collections/payroll_runs/lib/rounding.js';
import { dateKey } from '../iso-day.js';
import { awardedLeaveDays, leaveAccountBalance } from './ledger.js';
import { leaveAccountIdFor, leaveEntryIdFor, requestSourceKey } from './identity.js';
import type { LeaveSettlement } from '../../datatypes/leave_settlement/+definition.js';
import type { LeaveExitSettlement } from '../../datatypes/leave_exit_settlement/+definition.js';

const FORFEIT_SETTLEMENT = { settlement: 'FORFEIT' } as const satisfies LeaveSettlement;
const FORFEIT_EXIT = { exit: 'FORFEIT' } as const satisfies LeaveExitSettlement;
type RuleSource = 'STATUTE' | 'COMPANY';

const LIMIT = 5_000;
/** The leave service needs only the data surface; hooks and automations hand it theirs. */
type Api = Readonly<{ readonly db: AutomationApi['db'] }>;
type Employment = WorkspaceRow<'employments'>;
type LeavePlan = WorkspaceRow<'leave_plans'>;
type LeaveType = WorkspaceRow<'leave_types'>;
type Jurisdiction = WorkspaceRow<'jurisdictions'>;
type Child = WorkspaceRow<'employee_children'>;
type Account = WorkspaceRow<'leave_accounts'>;
type EmploymentTerm = WorkspaceRow<'employment_terms'>;
type Entry = WorkspaceRow<'leave_entries'>;
type Transition = 'FULL_AT_EFFECTIVE_DATE' | 'PRORATE_REMAINDER' | 'NEXT_LEAVE_YEAR';
type NewEntry = {
	readonly id?: string;
	readonly leave_account_id: string;
	readonly kind: Entry['kind'];
	readonly effective_on: string;
	readonly days: number;
	readonly expires_on?: string | null;
	readonly reason: string;
	readonly source_key: string;
	readonly source_request_id?: string | null;
	readonly leave_plan_id?: string | null;
	readonly statutory_profile_id?: string | null;
};

function requireComplete(rows: readonly unknown[], label: string): void {
	if (rows.length >= LIMIT)
		refuse(`The ${label} read reached its ${LIMIT}-row reconciliation ceiling.`);
}

function calendarDate(year: number, monthIndex: number, day: number): string {
	return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

export function leaveYearOf(date: string, startMonth: number): number {
	const year = Number(date.slice(0, 4));
	return Number(date.slice(5, 7)) >= startMonth ? year : year - 1;
}

function leaveYearWindow(year: number, startMonth: number): { start: string; end: string } {
	const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
	return { start, end: addDays(`${year + 1}-${String(startMonth).padStart(2, '0')}-01`, -1) };
}

function activeVersionAt<T extends { lifecycle: string; effective_range: unknown }>(
	rows: readonly T[],
	date: string,
	lifecycle: string
): T | null {
	return (
		rows
			.filter((row) => row.lifecycle === lifecycle && coversDate(row.effective_range, date))
			.toSorted((left, right) => {
				const leftStart = readRange(left.effective_range)?.start ?? '';
				const rightStart = readRange(right.effective_range)?.start ?? '';
				return rightStart.localeCompare(leftStart);
			})[0] ?? null
	);
}

function companyDays(type: LeaveType, serviceMonths: number): number {
	return (
		type.entitlement.layers
			.filter((band) => band.band_from <= serviceMonths)
			.toSorted((left, right) => right.band_from - left.band_from)[0]?.days ?? 0
	);
}

function eligibleChildren(children: readonly Child[], ageLimit: number, asOf: string): number {
	const superseded = new Set(
		children.flatMap((child) => (child.supersedes_id == null ? [] : [child.supersedes_id]))
	);
	return children.filter((child) => {
		if (superseded.has(child.id)) return false;
		if (child.effective_range != null && !coversDate(child.effective_range, asOf)) return false;
		const born = dateKey(child.child_birthdate);
		return born !== '' && born <= asOf && completedYears(born, asOf) < ageLimit;
	}).length;
}

function statutoryDays(
	profile: Jurisdiction,
	type: LeaveType,
	children: readonly Child[],
	serviceMonths: number,
	asOf: string,
	eligible = true
): number {
	if (!eligible) return 0;
	if (type.statutory_kind == null) return 0;
	const member = profile.statutory_leave.find(
		(candidate) => candidate.kind === type.statutory_kind
	);
	if (member == null) return 0;
	if ((member.account_basis ?? 'YEAR') !== (type.account_basis ?? 'YEAR')) return 0;
	if (serviceMonths < (member.qualifying_service_months ?? 0)) return 0;
	const base =
		member.ladder
			.filter((band) => band.band_from <= serviceMonths)
			.toSorted((left, right) => right.band_from - left.band_from)[0]?.days ?? 0;
	if (member.per_child == null)
		return member.max_days == null ? base : Math.min(base, member.max_days);
	const count = eligibleChildren(children, member.per_child.age_limit, asOf);
	if (count < member.per_child.min_children) return 0;
	const scaled = base + member.per_child.days * count;
	return member.max_days == null ? scaled : Math.min(scaled, member.max_days);
}

export function targetEntitlement(options: {
	readonly profile: Jurisdiction;
	readonly type: LeaveType;
	readonly children: readonly Child[];
	readonly employment: Employment;
	readonly asOf: string;
	readonly companyEligible?: boolean;
	readonly statutoryEligible?: boolean;
}): { statutory: number; company: number; target: number; serviceMonths: number } {
	const serviceMonths = completedMonths(dateKey(options.employment.hire_date), options.asOf);
	const statutory = statutoryDays(
		options.profile,
		options.type,
		options.children,
		serviceMonths,
		options.asOf,
		options.statutoryEligible
	);
	const company = options.companyEligible === false ? 0 : companyDays(options.type, serviceMonths);
	return { statutory, company, target: Math.max(statutory, company), serviceMonths };
}

/**
 * The year-end rule an account is compiled with, and which side decided it.
 *
 * The statute's kind is binding: a COMMUTE floor commutes, a CARRY floor carries. A company plan
 * may only widen the parameters of the statute's own kind — a higher carry limit (`null` is the
 * whole balance), a longer expiry (`0` is never) — never change the kind. Where the statute says
 * FORFEIT, or has no member for this kind, the company plan decides. A banded CARRY floor
 * protects only employments carrying one of its coverage codes.
 */
export function yearEndRule(
	profile: Jurisdiction,
	type: LeaveType,
	coverage: string | null
): { readonly rule: LeaveSettlement; readonly source: RuleSource } {
	const company: LeaveSettlement =
		type.accrual.kind === 'UNLIMITED' ? FORFEIT_SETTLEMENT : type.accrual.settlement;
	const member =
		type.statutory_kind == null
			? null
			: (profile.statutory_leave.find((row) => row.kind === type.statutory_kind) ?? null);
	const statutory = memberSettlement(member, coverage);
	if (statutory.settlement === 'FORFEIT') return { rule: company, source: 'COMPANY' };
	if (statutory.settlement === 'COMMUTE') return { rule: statutory, source: 'STATUTE' };
	if (company.settlement !== 'CARRY') return { rule: statutory, source: 'STATUTE' };
	const limit = (value: LeaveSettlement & { settlement: 'CARRY' }): number =>
		value.limit_days == null ? Number.POSITIVE_INFINITY : decodeNumber(value.limit_days);
	const expiry = (value: LeaveSettlement & { settlement: 'CARRY' }): number =>
		decodeNumber(value.expiry_months) === 0
			? Number.POSITIVE_INFINITY
			: decodeNumber(value.expiry_months);
	const widened = limit(company) > limit(statutory) || expiry(company) > expiry(statutory);
	if (!widened) return { rule: statutory, source: 'STATUTE' };
	const mergedLimit = Math.max(limit(company), limit(statutory));
	const mergedExpiry = Math.max(expiry(company), expiry(statutory));
	return {
		rule: {
			settlement: 'CARRY',
			limit_days: mergedLimit === Number.POSITIVE_INFINITY ? null : mergedLimit,
			expiry_months: mergedExpiry === Number.POSITIVE_INFINITY ? 0 : mergedExpiry,
			coverage: null
		},
		source: 'COMPANY'
	};
}

/** The exit rule an account is compiled with: the statute's payout binds, else the company plan. */
export function exitRule(
	profile: Jurisdiction,
	type: LeaveType
): { readonly rule: LeaveExitSettlement; readonly source: RuleSource } {
	const member =
		type.statutory_kind == null
			? null
			: (profile.statutory_leave.find((row) => row.kind === type.statutory_kind) ?? null);
	const statutory: LeaveExitSettlement = member?.exit ?? FORFEIT_EXIT;
	if (statutory.exit === 'PAY_OUT') return { rule: statutory, source: 'STATUTE' };
	return { rule: type.exit_settlement, source: 'COMPANY' };
}

/** A statutory floor with a coverage gate protects only employments carrying that code. */
function memberSettlement(
	member: Jurisdiction['statutory_leave'][number] | null,
	coverage: string | null
): LeaveSettlement {
	if (member == null) return FORFEIT_SETTLEMENT;
	const settlement = member.settlement;
	if (settlement.settlement !== 'CARRY' || settlement.coverage == null) return settlement;
	if (coverage != null && settlement.coverage.includes(coverage)) return settlement;
	return FORFEIT_SETTLEMENT;
}

/**
 * The salary facts coverage derivation reads: monthly basic where the terms state one, and
 * whether the work counts as workman labor. Anything else (hourly, daily, piece rates) carries
 * no code — universal floors still protect the employment, banded ones stay silent.
 */
export function coverageInputs(
	terms: {
		pay_frequency?: unknown;
		base_salary?: unknown;
		statutory_work_category?: unknown;
	} | null
): {
	readonly monthlyBasic: number | null;
	readonly workman: boolean;
} {
	if (terms == null) return { monthlyBasic: null, workman: false };
	const salary = terms.base_salary as { value?: unknown } | null;
	const monthlyBasic =
		terms.pay_frequency === 'MONTHLY' && salary != null ? decodeNumber(salary.value) : null;
	return {
		monthlyBasic: monthlyBasic != null && monthlyBasic > 0 ? monthlyBasic : null,
		workman:
			typeof terms.statutory_work_category === 'string' &&
			terms.statutory_work_category.startsWith('MANUAL_LABOUR')
	};
}
export { leaveDailyRate as commuteDailyRate } from './rate.js';

/** First matching band wins; no match (or no bands, or no monthly basic) means no code. */
export function resolveStatutoryCoverage(options: {
	readonly profile: Jurisdiction;
	readonly monthlyBasic: number | null;
	readonly workman: boolean;
}): string | null {
	const bands =
		((options.profile as { statutory_coverage?: unknown }).statutory_coverage as
			| ReadonlyArray<{
					readonly code: string;
					readonly max_monthly_basic: number | null;
					readonly workman_only: boolean | null;
			  }>
			| null
			| undefined) ?? null;
	if (bands == null || options.monthlyBasic == null) return null;
	const basic = options.monthlyBasic;
	return (
		bands.find(
			(band) =>
				(band.max_monthly_basic == null || decodeNumber(band.max_monthly_basic) >= basic) &&
				(band.workman_only == null || band.workman_only === options.workman)
		)?.code ?? null
	);
}

function monthEndFrom(start: string, offset: number): string {
	const year = Number(start.slice(0, 4));
	const monthIndex = Number(start.slice(5, 7)) - 1 + offset;
	return calendarDate(year, monthIndex + 1, 0);
}

function roundStatutory(
	value: number,
	mode: 'HALF_DAY' | 'WHOLE_DAY_HALF_UP' = 'HALF_DAY'
): number {
	return mode === 'WHOLE_DAY_HALF_UP' ? Math.floor(value + 0.5) : roundHalfDay(value);
}

export function entitlementEntries(options: {
	readonly accountId: string;
	readonly type: LeaveType;
	readonly plan: LeavePlan;
	readonly profile: Jurisdiction;
	readonly target: number;
	readonly yearStart: string;
	readonly yearEnd: string;
	readonly hireDate: string;
	readonly openingDate?: string;
	readonly statutoryTarget?: number;
	readonly companyTarget?: number;
	readonly statutoryVesting?: 'UPFRONT' | 'MONTHLY';
	readonly statutoryRounding?: 'HALF_DAY' | 'WHOLE_DAY_HALF_UP';
	readonly statutoryCatchUpMonths?: number;
}): NewEntry[] {
	if (options.target <= 0) return [];
	if (options.type.accrual.kind === 'UNLIMITED') return [];
	const openingDate =
		options.openingDate ??
		(options.hireDate > options.yearStart ? options.hireDate : options.yearStart);
	const statutoryTarget = options.statutoryTarget ?? 0;
	const companyTarget = options.companyTarget ?? options.target;
	const statutoryVesting = options.statutoryVesting ?? 'UPFRONT';
	const companyVesting = options.type.accrual.kind;
	const statutoryCatchUpMonths =
		statutoryVesting === 'MONTHLY' ? Math.min(12, options.statutoryCatchUpMonths ?? 0) : 0;
	const entries: NewEntry[] = [];
	let statutoryMonths = statutoryCatchUpMonths;
	let companyMonths = 0;
	let awarded = Math.max(
		statutoryVesting === 'UPFRONT'
			? statutoryTarget
			: roundStatutory((statutoryTarget * statutoryMonths) / 12, options.statutoryRounding),
		companyVesting === 'UPFRONT' ? companyTarget : 0
	);
	if (awarded > 0)
		entries.push({
			leave_account_id: options.accountId,
			kind: 'OPENING_ENTITLEMENT',
			effective_on: openingDate,
			days: awarded,
			reason: 'Sealed yearly entitlement',
			source_key: 'opening',
			leave_plan_id: options.plan.id,
			statutory_profile_id: options.profile.id
		});
	for (let month = 0; month < 12; month += 1) {
		const effective = monthEndFrom(options.yearStart, month);
		if (effective < openingDate || effective > options.yearEnd) continue;
		if (statutoryVesting === 'MONTHLY') statutoryMonths = Math.min(12, statutoryMonths + 1);
		if (companyVesting === 'MONTHLY') companyMonths += 1;
		const cumulative = Math.max(
			statutoryVesting === 'UPFRONT'
				? statutoryTarget
				: roundStatutory((statutoryTarget * statutoryMonths) / 12, options.statutoryRounding),
			companyVesting === 'UPFRONT'
				? companyTarget
				: roundHalfDay((companyTarget * companyMonths) / 12)
		);
		const days = cumulative - awarded;
		awarded = cumulative;
		if (days === 0) continue;
		entries.push({
			leave_account_id: options.accountId,
			kind: 'ACCRUAL',
			effective_on: effective,
			days,
			reason: `Scheduled monthly accrual ${month + 1}/12`,
			source_key: `accrual:${month + 1}`,
			leave_plan_id: options.plan.id,
			statutory_profile_id: options.profile.id
		});
	}
	return entries;
}

function transitionDelta(
	delta: number,
	transition: Transition,
	effective: string,
	account: Pick<Account, 'starts_on' | 'ends_on'>
): number {
	if (transition === 'NEXT_LEAVE_YEAR' && effective > dateKey(account.starts_on)) return 0;
	if (transition !== 'PRORATE_REMAINDER') return delta;
	const start = Date.parse(`${effective}T00:00:00Z`);
	const end = Date.parse(`${dateKey(account.ends_on)}T00:00:00Z`);
	const yearStart = Date.parse(`${dateKey(account.starts_on)}T00:00:00Z`);
	if (start > end) return 0;
	return roundHalfDay(delta * ((end - start + 86_400_000) / (end - yearStart + 86_400_000)));
}

function transitionRule(value: string): Transition {
	if (value === 'FULL_AT_EFFECTIVE_DATE' || value === 'PRORATE_REMAINDER') return value;
	return 'NEXT_LEAVE_YEAR';
}

function planAt(plans: readonly LeavePlan[], date: string): LeavePlan | null {
	return activeVersionAt(
		plans.filter((row) => row.approval_id == null),
		date,
		'ACTIVE'
	);
}

/** Retire only predecessors whose approved successor is already in force; future plans leave today intact. */
export function retireDueLeavePlanPredecessors(api: Api, asOf: string) {
	return Effect.gen(function* () {
		let after: string | undefined;
		let scanned = 0;
		let retired = 0;
		while (scanned < 50_000) {
			const successors = yield* api.db.leave_plans.findMany({
				where: {
					lifecycle: { eq: 'ACTIVE' },
					supersedes_id: { isNotNull: true },
					approval_id: { isNull: true },
					...(after == null ? {} : { id: { gt: after } })
				},
				columns: { id: true, supersedes_id: true, effective_range: true },
				orderBy: { id: 'asc' },
				limit: 500
			});
			scanned += successors.length;
			for (const successor of successors) after = successor.id;
			const predecessorIds = successors.flatMap((successor) => {
				const starts = readRange(successor.effective_range)?.start;
				return successor.supersedes_id != null && starts != null && starts <= asOf
					? [successor.supersedes_id]
					: [];
			});
			if (predecessorIds.length > 0) {
				const activePredecessors = yield* api.db.leave_plans.findMany({
					where: { id: { in: predecessorIds }, lifecycle: { eq: 'ACTIVE' } },
					columns: { id: true },
					limit: predecessorIds.length
				});
				if (activePredecessors.length > 0) {
					yield* api.db.leave_plans.mutate(
						activePredecessors.map((predecessor) => ({
							id: predecessor.id,
							lifecycle: 'RETIRED' as const
						}))
					);
					retired += activePredecessors.length;
				}
			}
			if (successors.length < 500) return retired;
		}
		return refuse('Leave-plan predecessor retirement exceeds 50,000 active successors.');
	});
}

export function profileAt(
	profiles: readonly Jurisdiction[],
	code: string,
	date: string
): Jurisdiction | null {
	return activeVersionAt(
		profiles.filter((row) => row.code === code && row.approval_id == null),
		date,
		'SEALED'
	);
}

export function requireStatutoryMappings(profile: Jurisdiction, types: readonly LeaveType[]): void {
	const missing = profile.statutory_leave
		.filter((member) => {
			const basis = member.account_basis ?? 'YEAR';
			return !types.some(
				(type) =>
					type.statutory_kind === member.kind &&
					(type.account_basis ?? 'YEAR') === basis &&
					(basis !== 'EVENT' || (type.event_unit ?? 'DAYS') === (member.event?.unit ?? 'DAYS'))
			);
		})
		.map((member) => member.kind);
	if (missing.length > 0)
		refuse(
			`The active leave plan is missing statutory mappings for ${missing.join(', ')}. Add those leave types before reconciliation.`
		);
}

export function ensureAccount(options: {
	readonly api: Api;
	readonly employment: Employment;
	readonly type: LeaveType;
	readonly plan: LeavePlan;
	readonly profile: Jurisdiction;
	readonly children: readonly Child[];
	readonly year: number;
	readonly startMonth: number;
	readonly existing: readonly Account[];
	readonly companyEligible?: boolean;
	readonly statutoryEligible?: boolean;
	/** Coverage code derived for the governing date; null leaves banded floors silent. */
	readonly statutoryCoverage?: string | null;
	readonly midYearOpening?: {
		readonly effectiveOn: string;
		readonly transition: Transition;
	};
	readonly eligibilityOpeningOn?: string;
}): Effect.Effect<{ account: Account; created: boolean }> {
	return Effect.gen(function* () {
		const window = leaveYearWindow(options.year, options.startMonth);
		const existing = options.existing.find(
			(account) =>
				account.account_kind !== 'EVENT' &&
				account.leave_year === options.year &&
				account.leave_code === options.type.code
		);
		// An account row whose entitlement was never generated — a seeded identity shell carrying
		// zero and a zero calculation, with no award on its ledger — is completed here exactly as a
		// new account would be. Entitlements are derived from the plan and the sealed statutory
		// profile; a seed only ever says that the account exists.
		const ungenerated =
			existing != null &&
			decodeNumber(existing.entitlement_days) === 0 &&
			existing.calculation.selected_days === 0;
		if (existing != null && !ungenerated) return { account: existing, created: false };
		if (existing != null) {
			const awards = yield* options.api.db.leave_entries.findMany({
				where: {
					leave_account_id: { eq: existing.id },
					kind: {
						in: ['OPENING_ENTITLEMENT', 'ACCRUAL', 'STATUTORY_ADJUSTMENT', 'POLICY_ADJUSTMENT']
					},
					approval_id: { isNull: true }
				},
				columns: { id: true },
				limit: 1
			});
			if (awards.length > 0) return { account: existing, created: false };
		}
		const hireDate = dateKey(options.employment.hire_date);
		const requestedOpening =
			options.midYearOpening?.effectiveOn ?? options.eligibilityOpeningOn ?? window.start;
		const asOf = hireDate > requestedOpening ? hireDate : requestedOpening;
		const target = targetEntitlement({
			profile: options.profile,
			type: options.type,
			children: options.children,
			employment: options.employment,
			asOf,
			companyEligible: options.companyEligible,
			statutoryEligible: options.statutoryEligible
		});
		const statutoryMember =
			options.type.statutory_kind == null
				? null
				: (options.profile.statutory_leave.find(
						(member) => member.kind === options.type.statutory_kind
					) ?? null);
		const serviceStart = hireDate > window.start ? hireDate : window.start;
		const scheduledEntries: NewEntry[] =
			options.midYearOpening == null
				? entitlementEntries({
						accountId: '',
						type: options.type,
						plan: options.plan,
						profile: options.profile,
						target: target.target,
						yearStart: window.start,
						yearEnd: window.end,
						hireDate,
						openingDate: asOf,
						statutoryTarget: target.statutory,
						companyTarget: target.company,
						statutoryVesting: statutoryMember?.vesting ?? 'UPFRONT',
						statutoryRounding: statutoryMember?.rounding ?? 'HALF_DAY',
						statutoryCatchUpMonths: completedMonths(serviceStart, asOf)
					})
				: [
						{
							leave_account_id: '',
							kind: 'OPENING_ENTITLEMENT',
							effective_on: asOf,
							days: transitionDelta(target.target, options.midYearOpening.transition, asOf, {
								starts_on: window.start,
								ends_on: window.end
							}),
							reason: `Sealed mid-year entitlement; ${options.midYearOpening.transition}`,
							source_key: 'opening',
							leave_plan_id: options.plan.id,
							statutory_profile_id: options.profile.id
						}
					].filter((entry) => entry.days > 0);
		const entitlementDays =
			options.midYearOpening == null && options.eligibilityOpeningOn == null
				? target.target
				: scheduledEntries.reduce((total, entry) => total + entry.days, 0);
		const yearEnd = yearEndRule(options.profile, options.type, options.statutoryCoverage ?? null);
		const exit = exitRule(options.profile, options.type);
		if (existing != null && target.target <= 0) return { account: existing, created: false };
		yield* options.api.db.leave_accounts.mutate([
			{
				...(existing == null ? {} : { id: existing.id }),
				employment_id: options.employment.id,
				leave_type_id: options.type.id,
				account_kind: 'YEAR',
				event_reference: '',
				leave_code: options.type.code,
				leave_name: options.type.name,
				opening_plan_id: options.plan.id,
				opening_statutory_profile_id: options.profile.id,
				leave_year: options.year,
				starts_on: window.start,
				ends_on: window.end,
				status: 'OPEN',
				entitlement_days: entitlementDays,
				accrual_kind: options.type.accrual.kind,
				settlement: yearEnd.rule,
				settlement_source: yearEnd.source,
				exit_settlement: exit.rule,
				exit_settlement_source: exit.source,
				calculation: {
					calculated_on: asOf,
					service_months: target.serviceMonths,
					statutory_days: target.statutory,
					company_days: target.company,
					selected_days: entitlementDays,
					formula_version: 'LEAVE_ACCOUNT_V1'
				}
			}
		]);
		const account = yield* options.api.db.leave_accounts.findFirst({
			where: {
				employment_id: { eq: options.employment.id },
				leave_code: { eq: options.type.code },
				leave_year: { eq: options.year }
			}
		});
		if (account == null) refuse('The generated leave account could not be read back.');
		const entries = scheduledEntries.map((entry) => ({
			...entry,
			leave_account_id: account.id
		}));
		if (entries.length > 0) yield* options.api.db.leave_entries.mutate(entries);
		return { account, created: true };
	});
}

export function reconcileTarget(options: {
	readonly api: Api;
	readonly account: Account;
	readonly entries: readonly Entry[];
	readonly employment: Employment;
	readonly type: LeaveType;
	readonly plan: LeavePlan;
	readonly profile: Jurisdiction;
	readonly children: readonly Child[];
	readonly asOf: string;
	readonly companyEligible?: boolean;
	readonly statutoryEligible?: boolean;
}): Effect.Effect<number> {
	return Effect.gen(function* () {
		if (!coversDate(options.plan.effective_range, options.asOf)) return 0;
		const target = targetEntitlement({
			profile: options.profile,
			type: options.type,
			children: options.children,
			employment: options.employment,
			asOf: options.asOf,
			companyEligible: options.companyEligible,
			statutoryEligible: options.statutoryEligible
		}).target;
		const awarded = awardedLeaveDays(options.entries);
		const planChanged = options.plan.id !== options.account.opening_plan_id;
		const profileChanged = options.profile.id !== options.account.opening_statutory_profile_id;
		if ((!planChanged && !profileChanged) || Math.abs(target - awarded) < 1e-9) return 0;
		const awardEntries = options.entries.filter((entry) =>
			['OPENING_ENTITLEMENT', 'ACCRUAL', 'STATUTORY_ADJUSTMENT', 'POLICY_ADJUSTMENT'].includes(
				entry.kind
			)
		);
		const planApplied = awardEntries.some((entry) => entry.leave_plan_id === options.plan.id);
		const profileApplied = awardEntries.some(
			(entry) => entry.statutory_profile_id === options.profile.id
		);
		const planEffective = readRange(options.plan.effective_range)?.start ?? options.asOf;
		const profileEffective = readRange(options.profile.effective_range)?.start ?? options.asOf;
		const policyChange =
			planChanged &&
			(!profileChanged || profileApplied || (!planApplied && planEffective >= profileEffective));
		const statutoryMember =
			options.type.statutory_kind == null
				? null
				: options.profile.statutory_leave.find(
						(member) => member.kind === options.type.statutory_kind
					);
		const transition = transitionRule(
			policyChange ? options.plan.transition : (statutoryMember?.transition ?? 'NEXT_LEAVE_YEAR')
		);
		const sourceRange = readRange(
			policyChange ? options.plan.effective_range : options.profile.effective_range
		);
		const effective = sourceRange?.start ?? options.asOf;
		const delta = transitionDelta(target - awarded, transition, effective, options.account);
		if (Math.abs(delta) < 1e-9) return 0;
		const sourceKey = `${policyChange ? 'policy' : 'statutory'}:${policyChange ? options.plan.id : options.profile.id}`;
		if (options.entries.some((entry) => entry.source_key === sourceKey)) return 0;
		yield* options.api.db.leave_entries.mutate([
			{
				leave_account_id: options.account.id,
				kind: policyChange ? 'POLICY_ADJUSTMENT' : 'STATUTORY_ADJUSTMENT',
				effective_on: effective,
				days: delta,
				reason: `${policyChange ? 'Company policy' : 'Statutory'} target changed from ${awarded} to ${target}; ${transition}`,
				source_key: sourceKey,
				leave_plan_id: options.plan.id,
				statutory_profile_id: options.profile.id
			}
		]);
		return 1;
	});
}

/**
 * The one carried lot an account can hold expires once: whatever of it was not taken by its
 * expiry date lapses. Days taken up to that date consume the lot first, so a later restore that
 * changes what was taken appends the delta under a versioned key rather than rewriting history.
 */
export function expireCarry(api: Api, account: Account, entries: readonly Entry[], asOf: string) {
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
				id: leaveEntryIdFor({ leave_account_id: account.id, source_key: key }),
				leave_account_id: account.id,
				kind: 'EXPIRED',
				effective_on: dateKey(lot.expires_on),
				days: -delta,
				reason: 'Carried-forward leave not taken by its expiry date lapsed',
				source_key: key,
				leave_plan_id: lot.leave_plan_id,
				statutory_profile_id: lot.statutory_profile_id
			} as NewEntry
		]);
		return 1;
	});
}

/**
 * A leave year closes once, on its end date, by the rule compiled into the account.
 *
 *   CARRY   — up to the limit moves to the next year's account as one lot with its expiry date;
 *             the rest lapses. With no next account (the employment ended) everything lapses.
 *   COMMUTE — the balance becomes money at the statute's daily rate from the terms in force on
 *             the closing date: one COMMUTED line and one payout row.
 *   FORFEIT — the balance lapses.
 *
 * Every line is keyed `close:<account>`, so a rerun restates and never doubles; a request still
 * pending approval holds the close until it is decided.
 */
export function closeLeaveYear(options: {
	readonly api: Api;
	readonly employment: Employment;
	readonly previous: Account;
	readonly next: Account | null;
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
			yield* options.api.db.leave_accounts.mutate([{ id: previous.id, status: 'CLOSED' }]);
			return 0;
		}
		const endsOn = dateKey(previous.ends_on);
		const balance = Math.max(0, leaveAccountBalance(options.entries, endsOn));
		const rule = previous.settlement;
		const line = (
			suffix: string,
			values: Omit<NewEntry, 'leave_account_id' | 'source_key' | 'id'>
		) =>
			({
				id: leaveEntryIdFor({ leave_account_id: previous.id, source_key: closing(suffix) }),
				leave_account_id: previous.id,
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
								leave_account_id: next.id,
								source_key: `carry:${previous.id}`
							}),
							leave_account_id: next.id,
							kind: 'CARRY_FORWARD',
							effective_on: dateKey(next.starts_on),
							days: carried,
							expires_on:
								decodeNumber(rule.expiry_months) === 0
									? null
									: monthEndFrom(dateKey(next.starts_on), decodeNumber(rule.expiry_months) - 1),
							reason: `Carried from leave year ${previous.leave_year}`,
							source_key: `carry:${previous.id}`,
							leave_plan_id: next.opening_plan_id,
							statutory_profile_id: next.opening_statutory_profile_id
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
				// The days leave the account here; payroll prices the line at the terms in force on
				// this date and the statute's basis when it prints it.
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
		yield* options.api.db.leave_accounts.mutate([{ id: previous.id, status: 'CLOSED' }]);
		return movements.length;
	});
}

/**
 * An employment's end closes every open account on the exit date: the balance is paid out or
 * lapses by the account's exit rule, with the statute's misconduct exception read from the
 * employment's `exit_reason`.
 */
export function closeOnExit(options: {
	readonly api: Api;
	readonly employment: Employment;
	readonly account: Account;
	readonly entries: readonly Entry[];
	readonly exitDate: string;
}) {
	return Effect.gen(function* () {
		const { account } = options;
		const key = `exit:${account.id}`;
		let posted = 0;
		if (!options.entries.some((entry) => entry.source_key === key)) {
			const balance = Math.max(0, leaveAccountBalance(options.entries, options.exitDate));
			if (balance > 1e-9) {
				const rule = account.exit_settlement;
				const misconduct = options.employment.exit_reason === 'MISCONDUCT';
				const paysOut = rule.exit === 'PAY_OUT' && !(rule.misconduct_forfeits && misconduct);
				const id = leaveEntryIdFor({ leave_account_id: account.id, source_key: key });
				if (paysOut && rule.exit === 'PAY_OUT') {
					yield* options.api.db.leave_entries.mutate([
						{
							id,
							leave_account_id: account.id,
							kind: 'ENCASHED',
							effective_on: options.exitDate,
							days: -balance,
							reason: `Paid out on exit: ${balance} unused days (${rule.pay_basis})`,
							source_key: key
						} as NewEntry
					]);
				} else {
					yield* options.api.db.leave_entries.mutate([
						{
							id,
							leave_account_id: account.id,
							kind: 'EXPIRED',
							effective_on: options.exitDate,
							days: -balance,
							reason:
								rule.exit === 'PAY_OUT'
									? 'Payout forfeited: dismissal for misconduct'
									: 'Unused leave lapsed on employment exit',
							source_key: key
						} as NewEntry
					]);
				}
				posted += 1;
			}
		}
		yield* options.api.db.leave_accounts.mutate([{ id: account.id, status: 'CLOSED' }]);
		return posted;
	});
}

/**
 * The ledger line each approved request of this employment takes, on the account the request names
 * or, when it arrived without one (a seeded fact, an import), on the account its employment, leave
 * type and start date name by formula. The request's own write posts the same line under the same
 * id, so whichever write comes first creates it and the other restates it; nothing is charged twice.
 */
export function chargeApprovedRequests(
	api: Api,
	employment: Employment,
	accounts: readonly Account[],
	startMonth: number
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
			const accountId =
				request.leave_account_id ??
				leaveAccountIdFor({
					employment_id: employment.id,
					leave_code: codeOf.get(request.leave_type_id) ?? '',
					leave_year: leaveYearOf(start, startMonth)
				});
			if (!accounts.some((account) => account.id === accountId)) continue;
			const sourceKey = requestSourceKey(request.id);
			const existing = yield* api.db.leave_entries.findFirst({
				where: { leave_account_id: { eq: accountId }, source_key: { eq: sourceKey } }
			});
			if (existing != null) continue;
			lines.push({
				id: leaveEntryIdFor({ leave_account_id: accountId, source_key: sourceKey }),
				leave_account_id: accountId,
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

export function reconcileEmploymentLeave(api: Api, employmentId: string, asOf: string) {
	return Effect.gen(function* () {
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: employmentId }, approval_id: { isNull: true } }
		});
		if (employment == null) return { accounts_created: 0, entries_posted: 0 };
		const [company, employee, terms, children, plans, accounts] = yield* Effect.all(
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
				api.db.leave_plans.findMany({
					where: { company_id: { eq: employment.company_id }, approval_id: { isNull: true } },
					limit: LIMIT
				}),
				api.db.leave_accounts.findMany({
					where: { employment_id: { eq: employment.id }, approval_id: { isNull: true } },
					limit: LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		if (company == null || employee == null) return { accounts_created: 0, entries_posted: 0 };
		requireComplete(terms, 'employment terms');
		requireComplete(children, 'employee children');
		requireComplete(plans, 'company leave plans');
		requireComplete(accounts, 'employment leave accounts');
		const anchor = yield* api.db.jurisdictions.findFirst({
			where: { id: { eq: company.jurisdiction_id }, approval_id: { isNull: true } },
			columns: { code: true }
		});
		const jurisdictionCode = anchor?.code;
		if (jurisdictionCode == null) return { accounts_created: 0, entries_posted: 0 };
		const profiles = yield* api.db.jurisdictions.findMany({
			where: {
				code: { eq: jurisdictionCode },
				lifecycle: { eq: 'SEALED' },
				approval_id: { isNull: true }
			},
			limit: LIMIT
		});
		requireComplete(profiles, 'statutory profile family');
		const startMonth = decodeNumber(company.leave_year_start_month);
		const currentYear = leaveYearOf(asOf, startMonth);
		let created = 0;
		let posted = 0;
		const allAccounts = [...accounts];

		// The previous leave year is opened too: its ledger is what carries into the current year, and
		// a request dated in it must find its account. Nothing older is ever generated or read.
		for (const year of [currentYear - 1, currentYear, currentYear + 1]) {
			const window = leaveYearWindow(year, startMonth);
			if (dateKey(employment.hire_date) > window.end) continue;
			if (employment.exit_date != null && dateKey(employment.exit_date) < window.start) continue;
			const ruleDate =
				window.start < dateKey(employment.hire_date) ? dateKey(employment.hire_date) : window.start;
			const plan = planAt(plans, ruleDate);
			const profile = profileAt(profiles, jurisdictionCode, ruleDate);
			if (plan == null || profile == null) continue;
			const types = yield* api.db.leave_types.findMany({
				where: { leave_plan_id: { eq: plan.id }, company_id: { eq: company.id } },
				limit: LIMIT
			});
			requireComplete(types, 'leave types in one plan');
			const term = terms.find((row) => coversDate(row.effective_range, ruleDate));
			for (const type of types) {
				if (type.account_basis === 'EVENT') continue;
				const eligibilitySubject = {
					employment_type: term?.employment_type ?? null,
					work_classification: term?.work_classification ?? null,
					department: term?.department ?? null,
					payroll_group: term?.payroll_group ?? null,
					gender: employee.gender ?? null,
					service_months: completedMonths(dateKey(employment.hire_date), ruleDate)
				};
				const companyEligible = isEligible(type.eligibility, eligibilitySubject);
				const statutoryMember = profile.statutory_leave.find(
					(member) => member.kind === type.statutory_kind
				);
				const statutoryEligible = isEligible(
					statutoryMember?.eligibility ?? [],
					eligibilitySubject
				);
				const statutoryTarget = targetEntitlement({
					profile,
					type,
					children,
					employment,
					asOf: ruleDate,
					companyEligible: false,
					statutoryEligible
				}).statutory;
				if (!companyEligible && statutoryTarget <= 0) continue;
				const ensured = yield* ensureAccount({
					api,
					employment,
					type,
					plan,
					profile,
					children,
					year,
					startMonth,
					existing: allAccounts,
					companyEligible,
					statutoryEligible,
					statutoryCoverage: resolveStatutoryCoverage({
						profile,
						...coverageInputs(term ?? null)
					})
				});
				if (ensured.created) {
					created += 1;
					allAccounts.push(ensured.account);
				}
			}
		}

		const currentWindow = leaveYearWindow(currentYear, startMonth);
		const currentPlan = planAt(plans, asOf);
		const currentProfile = profileAt(profiles, jurisdictionCode, asOf);
		const currentPlanStart =
			currentPlan == null ? null : (readRange(currentPlan.effective_range)?.start ?? null);
		if (
			currentPlan != null &&
			currentProfile != null &&
			currentPlanStart != null &&
			(currentPlanStart <= currentWindow.start || currentPlan.transition !== 'NEXT_LEAVE_YEAR')
		) {
			const currentTypes = yield* api.db.leave_types.findMany({
				where: { leave_plan_id: { eq: currentPlan.id }, company_id: { eq: company.id } },
				limit: LIMIT
			});
			requireComplete(currentTypes, 'leave types in the current plan');
			const currentTerm = terms.find((row) => coversDate(row.effective_range, asOf));
			for (const type of currentTypes) {
				if (type.account_basis === 'EVENT') continue;
				const eligibilitySubject = {
					employment_type: currentTerm?.employment_type ?? null,
					work_classification: currentTerm?.work_classification ?? null,
					department: currentTerm?.department ?? null,
					payroll_group: currentTerm?.payroll_group ?? null,
					gender: employee.gender ?? null,
					service_months: completedMonths(dateKey(employment.hire_date), asOf)
				};
				const companyEligible = isEligible(type.eligibility, eligibilitySubject);
				const statutoryMember = currentProfile.statutory_leave.find(
					(member) => member.kind === type.statutory_kind
				);
				const statutoryEligible = isEligible(
					statutoryMember?.eligibility ?? [],
					eligibilitySubject
				);
				const statutoryTarget = targetEntitlement({
					profile: currentProfile,
					type,
					children,
					employment,
					asOf,
					companyEligible: false,
					statutoryEligible
				}).statutory;
				if (!companyEligible && statutoryTarget <= 0) continue;
				const ensured = yield* ensureAccount({
					api,
					employment,
					type,
					plan: currentPlan,
					profile: currentProfile,
					children,
					year: currentYear,
					startMonth,
					existing: allAccounts,
					companyEligible,
					statutoryEligible,
					statutoryCoverage: resolveStatutoryCoverage({
						profile: currentProfile,
						...coverageInputs(currentTerm ?? null)
					}),
					...(currentPlanStart > currentWindow.start
						? {
								midYearOpening: {
									effectiveOn: currentPlanStart,
									transition: transitionRule(currentPlan.transition)
								}
							}
						: { eligibilityOpeningOn: asOf })
				});
				if (ensured.created) {
					created += 1;
					allAccounts.push(ensured.account);
				}
			}
		}

		posted += yield* chargeApprovedRequests(api, employment, allAccounts, startMonth);

		for (const account of allAccounts) {
			let entries = yield* api.db.leave_entries.findMany({
				where: { leave_account_id: { eq: account.id }, approval_id: { isNull: true } },
				limit: LIMIT
			});
			requireComplete(entries, 'leave account entries');
			const expired = yield* expireCarry(api, account, entries, asOf);
			posted += expired;
			if (expired > 0) {
				entries = yield* api.db.leave_entries.findMany({
					where: { leave_account_id: { eq: account.id }, approval_id: { isNull: true } },
					limit: LIMIT
				});
				requireComplete(entries, 'leave account entries after carry expiry');
			}
			if (
				account.account_kind === 'EVENT' &&
				!entries.some((entry) => entry.source_key === 'event-opening')
			) {
				// A verified qualifying-event allocation opens once, on the account's own terms.
				yield* api.db.leave_entries.mutate([
					{
						id: leaveEntryIdFor({ leave_account_id: account.id, source_key: 'event-opening' }),
						leave_account_id: account.id,
						kind: 'OPENING_ENTITLEMENT',
						effective_on: dateKey(account.starts_on),
						days: decodeNumber(account.entitlement_days),
						reason: `Verified qualifying-event allocation ${account.event_reference ?? ''}`,
						source_key: 'event-opening',
						leave_plan_id: account.opening_plan_id,
						statutory_profile_id: account.opening_statutory_profile_id
					} as NewEntry
				]);
				posted += 1;
				entries = yield* api.db.leave_entries.findMany({
					where: { leave_account_id: { eq: account.id }, approval_id: { isNull: true } },
					limit: LIMIT
				});
			}
			if (
				account.account_kind === 'EVENT' &&
				account.status === 'OPEN' &&
				dateKey(account.ends_on) < asOf
			) {
				const sourceKey = `event-close:${account.id}`;
				if (!entries.some((entry) => entry.source_key === sourceKey)) {
					const balance = Math.max(0, leaveAccountBalance(entries, dateKey(account.ends_on)));
					if (balance > 0) {
						yield* api.db.leave_entries.mutate([
							{
								leave_account_id: account.id,
								kind: 'EXPIRED',
								effective_on: dateKey(account.ends_on),
								days: -balance,
								reason: 'Unused qualifying-event leave expired',
								source_key: sourceKey
							}
						]);
						posted += 1;
					}
				}
				yield* api.db.leave_accounts.mutate([{ id: account.id, status: 'CLOSED' }]);
				continue;
			}
			const exitDate = employment.exit_date == null ? '' : dateKey(employment.exit_date);
			if (
				exitDate !== '' &&
				exitDate <= asOf &&
				account.status === 'OPEN' &&
				dateKey(account.starts_on) <= exitDate &&
				dateKey(account.ends_on) >= exitDate
			) {
				posted += yield* closeOnExit({ api, employment, account, entries, exitDate });
				continue;
			}
			if (account.status !== 'OPEN' || account.account_kind === 'EVENT') continue;
			if (account.leave_year === currentYear) {
				const currentType =
					currentPlan == null
						? null
						: yield* api.db.leave_types.findFirst({
								where: {
									leave_plan_id: { eq: currentPlan.id },
									code: { eq: account.leave_code }
								}
							});
				if (currentPlan != null && currentProfile != null && currentType != null) {
					const currentTerm = terms.find((row) => coversDate(row.effective_range, asOf));
					const eligibilitySubject = {
						employment_type: currentTerm?.employment_type ?? null,
						work_classification: currentTerm?.work_classification ?? null,
						department: currentTerm?.department ?? null,
						payroll_group: currentTerm?.payroll_group ?? null,
						gender: employee.gender ?? null,
						service_months: completedMonths(dateKey(employment.hire_date), asOf)
					};
					const statutoryMember = currentProfile.statutory_leave.find(
						(member) => member.kind === currentType.statutory_kind
					);
					posted += yield* reconcileTarget({
						api,
						account,
						entries,
						employment,
						type: currentType,
						plan: currentPlan,
						profile: currentProfile,
						children,
						asOf,
						companyEligible: isEligible(currentType.eligibility, eligibilitySubject),
						statutoryEligible: isEligible(statutoryMember?.eligibility ?? [], eligibilitySubject)
					});
				}
			}
			const next =
				allAccounts.find(
					(candidate) =>
						candidate.account_kind !== 'EVENT' &&
						candidate.leave_year === account.leave_year + 1 &&
						candidate.leave_code === account.leave_code
				) ?? null;
			if (dateKey(account.ends_on) < asOf) {
				const pending = yield* api.db.leave_requests.findPending({
					where: { leave_account_id: { eq: account.id } },
					limit: LIMIT
				});
				posted += yield* closeLeaveYear({
					api,
					employment,
					previous: account,
					next,
					entries,
					pending,
					asOf
				});
			}
		}
		return { accounts_created: created, entries_posted: posted };
	});
}
