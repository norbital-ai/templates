import { Effect, Schema } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { completedMonths } from '../payroll_runs/lib/dates.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import { isEligible } from '../payroll_runs/lib/eligibility.js';
import { dateKey } from '../../lib/iso-day.js';
import { profileAt, targetEntitlement } from '../../lib/leave/reconcile.js';
import { leaveAccountCalculationValueSchema } from '../../datatypes/leave_account_calculation/+definition.js';
import { leaveSettlementValueSchema } from '../../datatypes/leave_settlement/+definition.js';
import { leaveExitSettlementValueSchema } from '../../datatypes/leave_exit_settlement/+definition.js';
import type { Hooks } from './$types.js';

const LIMIT = 5_000;
const PENDING_LIMIT = 2_000;

/**
 * What a caller may send: one record for both kinds, because the runtime derives the partial
 * shape of an update from this declaration and a union has none. The `before` hook below is what
 * tells a reviewed qualifying-event allocation from a generated yearly account and refuses either
 * when its own fields are missing.
 */
const accountInput = Schema.Struct({
	employment_id: Schema.String.check(Schema.isUUID()),
	leave_type_id: Schema.String.check(Schema.isUUID()),
	account_kind: Schema.Literals(['EVENT', 'YEAR']),
	event_reference: Schema.String,
	starts_on: Schema.String,
	ends_on: Schema.String,
	// A reviewed qualifying-event allocation.
	qualifying_date: Schema.optionalKey(Schema.String),
	statutory_cohort_date: Schema.optionalKey(Schema.String),
	allocation_units: Schema.optionalKey(Schema.Finite),
	weekly_index: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	eligibility_evidence: Schema.optionalKey(Schema.String),
	// A generated yearly account, written by the leave reconciler.
	leave_code: Schema.optionalKey(Schema.String),
	leave_name: Schema.optionalKey(Schema.String),
	opening_plan_id: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
	opening_statutory_profile_id: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
	leave_year: Schema.optionalKey(Schema.Int),
	status: Schema.optionalKey(Schema.Literals(['OPEN', 'CLOSED'])),
	entitlement_days: Schema.optionalKey(Schema.Finite),
	accrual_kind: Schema.optionalKey(Schema.Literals(['UPFRONT', 'MONTHLY', 'UNLIMITED'])),
	settlement: Schema.optionalKey(leaveSettlementValueSchema),
	settlement_source: Schema.optionalKey(Schema.Literals(['STATUTE', 'COMPANY'])),
	exit_settlement: Schema.optionalKey(leaveExitSettlementValueSchema),
	exit_settlement_source: Schema.optionalKey(Schema.Literals(['STATUTE', 'COMPANY'])),
	calculation: Schema.optionalKey(leaveAccountCalculationValueSchema)
});

function addMonths(date: string, months: number): string {
	const year = Number(date.slice(0, 4));
	const month = Number(date.slice(5, 7)) - 1;
	const day = Number(date.slice(8, 10));
	const target = new Date(Date.UTC(year, month + months + 1, 0));
	return new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, target.getUTCDate()))
	)
		.toISOString()
		.slice(0, 10);
}

export function eventAllocationDays(units: number, weeklyIndex: number): number {
	const value = units * weeklyIndex;
	const epsilon = Number.EPSILON * Math.max(1, Math.abs(value)) * 4;
	return Math.floor((value + epsilon) * 2) / 2;
}

/** Event accounts are the reviewed allocation fact; yearly accounts remain system-generated. */
export default {
	input: accountInput,
	mutate: {
		perRecord: {
			before: {
				description:
					'Validates and seals reviewed qualifying-event entitlements; generated yearly accounts are immutable except for close.',
				handler: ({ input, existing, recordId, api }) =>
					Effect.gen(function* () {
						if (existing != null) {
							const changed = Object.keys(input).filter(
								(field) => field !== 'id' && field !== 'status' && field !== 'row_version'
							);
							if (changed.length > 0)
								refuse('A leave account calculation is sealed. Post an adjustment entry instead.');
							if (
								input.status != null &&
								!(existing.status === 'OPEN' && input.status === 'CLOSED')
							)
								refuse('A leave account may only move from OPEN to CLOSED.');
							return input;
						}
						if (input.account_kind !== 'EVENT') return input;
						if (input.employment_id == null || input.leave_type_id == null)
							refuse('An event entitlement needs an employment and event-based leave type.');
						if (
							input.qualifying_date == null ||
							input.starts_on == null ||
							input.ends_on == null ||
							input.allocation_units == null
						)
							refuse(
								'An event entitlement states its qualifying date, availability window and allocation.'
							);
						const reference = input.event_reference?.trim().toUpperCase();
						const evidence = input.eligibility_evidence?.trim();
						const qualifying = dateKey(input.qualifying_date);
						const statutoryCohort = dateKey(input.statutory_cohort_date ?? input.qualifying_date);
						const starts = dateKey(input.starts_on);
						const ends = dateKey(input.ends_on);
						const allocationUnits = decodeNumber(input.allocation_units);
						if (!reference || !evidence)
							refuse('State the qualifying event reference and verified allocation evidence.');
						if (
							!qualifying ||
							!statutoryCohort ||
							!starts ||
							!ends ||
							starts < qualifying ||
							starts > ends
						)
							refuse(
								'The event, statutory cohort and availability window must be valid dates, with availability starting on or after the event.'
							);
						if (
							!Number.isFinite(allocationUnits) ||
							allocationUnits <= 0 ||
							!Number.isInteger(allocationUnits * 2)
						)
							refuse('Allocate a positive number of profile units in half-unit increments.');

						const [employment, leaveType] = yield* Effect.all([
							api.db.employments.findFirst({
								where: { id: { eq: input.employment_id }, approval_id: { isNull: true } }
							}),
							api.db.leave_types.findFirst({ where: { id: { eq: input.leave_type_id } } })
						]);
						if (
							employment == null ||
							leaveType == null ||
							employment.company_id !== leaveType.company_id
						)
							refuse('The event entitlement must use an employment and leave type in one company.');
						if (leaveType.account_basis !== 'EVENT')
							refuse('Only an event-based leave type can create a qualifying-event account.');
						if (qualifying < dateKey(employment.hire_date))
							refuse('The qualifying event cannot predate this employment.');
						if (employment.exit_date != null && starts > dateKey(employment.exit_date))
							refuse('The event entitlement cannot start after employment ended.');

						const [plan, company, employee, terms, children] = yield* Effect.all([
							api.db.leave_plans.findFirst({
								where: { id: { eq: leaveType.leave_plan_id }, approval_id: { isNull: true } }
							}),
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
							})
						]);
						if (
							plan == null ||
							(plan.lifecycle !== 'ACTIVE' && plan.lifecycle !== 'RETIRED') ||
							!coversDate(plan.effective_range, qualifying)
						)
							refuse(
								'The event entitlement must use the sealed plan version covering its qualifying date.'
							);
						if (company == null || employee == null)
							refuse('The event entitlement company is incomplete.');
						if (terms.length >= LIMIT || children.length >= LIMIT)
							refuse('The event entitlement evidence read reached its safety ceiling.');
						const anchor = yield* api.db.jurisdictions.findFirst({
							where: { id: { eq: company.jurisdiction_id }, approval_id: { isNull: true } },
							columns: { code: true }
						});
						const profiles =
							anchor == null
								? []
								: yield* api.db.jurisdictions.findMany({
										where: {
											code: { eq: anchor.code },
											lifecycle: { eq: 'SEALED' },
											approval_id: { isNull: true }
										},
										limit: LIMIT
									});
						if (profiles.length >= LIMIT)
							refuse('The statutory profile family is too large to verify.');
						const profile =
							anchor == null ? null : profileAt(profiles, anchor.code, statutoryCohort);
						if (profile == null) refuse('No sealed statutory profile covers the qualifying event.');
						const statutoryMember =
							leaveType.statutory_kind == null
								? null
								: (profile.statutory_leave.find(
										(member) => member.kind === leaveType.statutory_kind
									) ?? null);
						if (leaveType.statutory_kind != null && statutoryMember?.account_basis !== 'EVENT')
							refuse('The selected statutory leave kind is not defined as qualifying-event leave.');
						const allocationUnit: 'DAYS' | 'WEEKS' =
							(statutoryMember?.event?.unit ?? leaveType.event_unit) === 'WEEKS' ? 'WEEKS' : 'DAYS';
						if (
							statutoryMember != null &&
							(statutoryMember.event?.unit ?? 'DAYS') !== (leaveType.event_unit ?? 'DAYS')
						)
							refuse('The company event type must use the statutory profile allocation unit.');
						const weeklyIndex =
							input.weekly_index == null ? null : decodeNumber(input.weekly_index);
						if (
							allocationUnit === 'WEEKS' &&
							(weeklyIndex == null ||
								!Number.isFinite(weeklyIndex) ||
								weeklyIndex <= 0 ||
								weeklyIndex > (statutoryMember?.event?.weekly_index_cap ?? Infinity))
						)
							refuse(
								`State a verified weekly index no greater than ${statutoryMember?.event?.weekly_index_cap}.`
							);
						if (allocationUnit === 'DAYS' && weeklyIndex != null)
							refuse('A day-based event allocation does not use a weekly index.');
						const term = terms.find((candidate) =>
							coversDate(candidate.effective_range, qualifying)
						);
						const eligibilitySubject = {
							employment_type: term?.employment_type ?? null,
							work_classification: term?.work_classification ?? null,
							department: term?.department ?? null,
							payroll_group: term?.payroll_group ?? null,
							gender: employee.gender ?? null,
							service_months: completedMonths(dateKey(employment.hire_date), qualifying)
						};
						const companyEligible = isEligible(leaveType.eligibility, eligibilitySubject);
						const statutoryEligible = isEligible(
							statutoryMember?.eligibility ?? [],
							eligibilitySubject
						);
						const target = targetEntitlement({
							profile,
							type: leaveType,
							children,
							employment,
							asOf: qualifying,
							companyEligible,
							statutoryEligible
						});
						if (target.target <= 0 || allocationUnits > target.target)
							refuse(
								`The verified allocation must not exceed the ${target.target}-${allocationUnit.toLowerCase()} policy maximum.`
							);
						const days =
							allocationUnit === 'WEEKS'
								? eventAllocationDays(allocationUnits, weeklyIndex ?? 0)
								: allocationUnits;
						const windowMonths = Math.max(
							leaveType.event_window_months ?? 0,
							statutoryMember?.event?.window_months ?? 0
						);
						if (windowMonths <= 0 || ends >= addMonths(qualifying, windowMonths))
							refuse(
								`The event account must end inside its ${windowMonths}-month statutory or policy window.`
							);

						if (statutoryMember?.event?.allocation === 'HOUSEHOLD') {
							const [committed, pending] = yield* Effect.all([
								api.db.leave_accounts.findMany({
									where: {
										account_kind: { eq: 'EVENT' },
										event_reference: { eq: reference },
										approval_id: { isNull: true }
									},
									limit: LIMIT
								}),
								api.db.leave_accounts.findPending({
									where: {
										account_kind: { eq: 'EVENT' },
										event_reference: { eq: reference }
									},
									limit: PENDING_LIMIT
								})
							]);
							if (committed.length >= LIMIT || pending.length >= PENDING_LIMIT)
								refuse('The household event allocation read reached its safety ceiling.');
							const candidates = [...committed, ...pending].filter(
								(account) => account.id !== recordId
							);
							const leaveTypeIds = [
								...new Set(
									candidates.flatMap((account) =>
										account.leave_type_id == null ? [] : [account.leave_type_id]
									)
								)
							];
							const candidateTypes =
								leaveTypeIds.length === 0
									? []
									: yield* api.db.leave_types.findMany({
											where: { id: { in: leaveTypeIds } },
											columns: { id: true, statutory_kind: true },
											limit: LIMIT
										});
							if (candidateTypes.length >= LIMIT)
								refuse('The household event leave-type read reached its safety ceiling.');
							const kindByTypeId = new Map(
								candidateTypes.map((candidate) => [candidate.id, candidate.statutory_kind])
							);
							// Bolt fingerprints these committed and pending reads, then rechecks them under
							// ordered table locks in the account transaction. Concurrent allocations for one
							// household cannot both commit from the same observed total.
							const allocated = candidates
								.filter(
									(account) =>
										account.leave_type_id != null &&
										account.opening_statutory_profile_id === profile.id &&
										kindByTypeId.get(account.leave_type_id) === leaveType.statutory_kind
								)
								.reduce((total, account) => total + decodeNumber(account.allocation_units), 0);
							if (allocated + allocationUnits > target.target)
								refuse(
									`This household already allocated ${allocated} ${allocationUnit.toLowerCase()}; the ${target.target}-${allocationUnit.toLowerCase()} maximum would be exceeded.`
								);
						}

						return {
							...input,
							account_kind: 'EVENT',
							event_reference: reference,
							qualifying_date: qualifying,
							statutory_cohort_date: statutoryCohort,
							eligibility_evidence: evidence,
							allocation_units: allocationUnits,
							weekly_index: weeklyIndex,
							starts_on: starts,
							ends_on: ends,
							leave_code: leaveType.code,
							leave_name: leaveType.name,
							opening_plan_id: plan.id,
							opening_statutory_profile_id: profile.id,
							leave_year: Number(qualifying.slice(0, 4)),
							status: 'OPEN',
							entitlement_days: days,
							accrual_kind: 'EVENT',
							// A verified event allocation lapses at its window and on exit; nothing carries or pays.
							settlement: { settlement: 'FORFEIT' },
							settlement_source: 'COMPANY',
							exit_settlement: { exit: 'FORFEIT' },
							exit_settlement_source: 'COMPANY',
							calculation: {
								calculated_on: qualifying,
								service_months: target.serviceMonths,
								statutory_days:
									allocationUnit === 'WEEKS'
										? eventAllocationDays(target.statutory, weeklyIndex ?? 0)
										: target.statutory,
								company_days:
									allocationUnit === 'WEEKS'
										? eventAllocationDays(target.company, weeklyIndex ?? 0)
										: target.company,
								selected_days: days,
								statutory_cohort_date: statutoryCohort,
								allocation_unit: allocationUnit,
								allocation_units: allocationUnits,
								weekly_index: weeklyIndex,
								formula_version: 'LEAVE_ACCOUNT_V1'
							}
						};
					})
			},
			after: {
				description:
					"A qualifying-event account opens its allocation: the employment's leave ledger is regenerated once the account commits.",
				handler: ({ record, changes, api }): Effect.Effect<void> =>
					Effect.gen(function* () {
						// Yearly accounts are the reconciler's own writes; only a person's verified
						// qualifying-event allocation is a new fact for the ledger to open.
						if (record.approval_id != null || record.account_kind !== 'EVENT') return;
						if (Object.keys(changes).length === 0) return;
						yield* api.automations.run('leave_ledger_refresh', {
							employment_ids: [record.employment_id]
						});
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Sealed leave accounts are permanent audit evidence.',
				handler: () => refuse('Leave accounts cannot be deleted.')
			}
		}
	}
} satisfies Hooks;
