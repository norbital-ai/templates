import { defineCommandHandler, refuse } from '@norbital-ai/bolt/authoring';
import { Effect, Number as EffectNumber, Schema } from 'effect';
import type { Api } from './$types.js';
import {
	closingBalance,
	leaveYearOf,
	policyCarryExpiry,
	resolveEntitlementAt,
	yearWindow,
	type BalanceInput,
	type ChildFact,
	type LedgerRow
} from '../collections/payroll_runs/lib/leave.js';
import { dateKey, type IsoDate } from '../collections/payroll_runs/lib/dates.js';
import { coversDate } from '../collections/payroll_runs/lib/effective.js';
import { sealedProfileCovering, statutoryProfileLineage } from '../lib/statutory_profile.js';
import { decodeNumber } from '@norbital-ai/std/json';

/**
 * One posted carry-forward per employment and banked leave type, written once and never recomputed.
 *
 * Shaped like `open_roster_month` was: bounded reads, whole validation, one atomic write, counts
 * and refusals back in operator terms. HR Manager runs it from the Leave surface; there is no
 * draft state, no approval and no schedule. A posted year can be deleted by the HR Manager while
 * the following year is unprocessed; that is the undo.
 */
export const PROCESS_LEAVE_YEAR_QUERY_LIMIT = 2_000;

const ProcessLeaveYearInput = Schema.Struct({
	company_id: Schema.String.check(Schema.isUUID()),
	leave_year: Schema.Int
});

function requireCompletePage(rows: readonly unknown[], label: string, year: number): void {
	if (rows.length < PROCESS_LEAVE_YEAR_QUERY_LIMIT) return;
	refuse(
		`Cannot process leave year ${year}: the ${label} read reached its ${PROCESS_LEAVE_YEAR_QUERY_LIMIT.toLocaleString()}-row safety ceiling, so the closing cannot be trusted.`
	);
}

type NegativeClosing = {
	readonly employment_id: string;
	readonly employee_number: string;
	readonly leave_type_id: string;
	readonly leave_type_code: string;
	readonly closing: number;
};

const processLeaveYear = Effect.fn('ProcessLeaveYear.process')(function* (
	input: Schema.Schema.Type<typeof ProcessLeaveYearInput>,
	api: Api
) {
	const company = yield* api.db.companies.findFirst({
		where: { id: { eq: input.company_id } },
		columns: { id: true, name: true, jurisdiction_id: true, leave_year_start_month: true }
	});
	if (company == null)
		refuse(`Cannot process leave year ${input.leave_year}: the selected company was not found.`);
	const startMonth = decodeNumber(company.leave_year_start_month);
	const previousYear = input.leave_year - 1;
	const previousWindow = yearWindow(previousYear, startMonth);
	const previousEnd = previousWindow.end;
	const yearStart = yearWindow(input.leave_year, startMonth).start;

	const employments = yield* api.db.employments.findMany({
		where: { company_id: { eq: company.id } },
		columns: {
			id: true,
			company_id: true,
			employee_number: true,
			hire_date: true,
			exit_date: true,
			effective_range: true
		},
		limit: PROCESS_LEAVE_YEAR_QUERY_LIMIT
	});
	requireCompletePage(employments, 'employment', input.leave_year);
	const hireDates = employments.flatMap((employment) => {
		const hire = dateKey(employment.hire_date);
		return hire == null ? [] : [hire];
	});
	const earliestHire = hireDates.toSorted()[0] ?? null;
	const activeEmployments = employments.filter((employment) =>
		coversDate(employment.effective_range, previousEnd)
	);

	const employmentIds = employments.map((employment) => employment.id);
	const [leaveTypes, requestRows, childRows] =
		employmentIds.length === 0
			? ([[], [], []] as const)
			: yield* Effect.all(
					[
						api.db.leave_types.findMany({
							where: { company_id: { eq: company.id } },
							limit: PROCESS_LEAVE_YEAR_QUERY_LIMIT
						}),
						api.db.leave_requests.findMany({
							where: { employment_id: { in: employmentIds } },
							columns: {
								id: true,
								employment_id: true,
								leave_type_id: true,
								kind: true,
								event: true,
								approval_id: true
							},
							limit: PROCESS_LEAVE_YEAR_QUERY_LIMIT
						}),
						api.db.employee_children.findMany({
							where: { employment_id: { in: employmentIds } },
							limit: PROCESS_LEAVE_YEAR_QUERY_LIMIT
						})
					],
					{ concurrency: 'unbounded' }
				);
	requireCompletePage(leaveTypes, 'leave-type', input.leave_year);
	requireCompletePage(requestRows, 'leave-request', input.leave_year);
	requireCompletePage(childRows, 'child-fact', input.leave_year);

	const postedForYear = (year: number) =>
		requestRows.filter(
			(row) =>
				row.approval_id == null &&
				row.event?.kind === 'CARRY_FORWARD' &&
				(typeof row.event.leave_year === 'number'
					? row.event.leave_year
					: leaveYearOf(dateKey(row.event.effective_on) ?? previousEnd, startMonth)) === year
		);
	const existing = postedForYear(input.leave_year);
	if (existing.length > 0) {
		const totals = existing.reduce(
			(running, row) => ({
				carried:
					running.carried +
					(row.event?.kind === 'CARRY_FORWARD' && typeof row.event.movement_days === 'number'
						? row.event.movement_days
						: 0),
				forfeited:
					running.forfeited +
					(row.event?.kind === 'CARRY_FORWARD' && typeof row.event.forfeited_days === 'number'
						? row.event.forfeited_days
						: 0)
			}),
			{ carried: 0, forfeited: 0 }
		);
		const employeeNumberById = new Map(
			employments.map((employment) => [employment.id, employment.employee_number])
		);
		const leaveCodeById = new Map(leaveTypes.map((type) => [type.id, type.code]));
		return {
			state: 'existing' as const,
			company_id: company.id,
			leave_year: input.leave_year,
			rows_written: existing.length,
			total_carried_days: totals.carried,
			total_forfeited_days: totals.forfeited,
			negative_closings: existing.flatMap((row): readonly NegativeClosing[] => {
				const closing =
					row.event?.kind === 'CARRY_FORWARD' && typeof row.event.closing?.closing === 'number'
						? row.event.closing.closing
						: null;
				if (closing == null || closing >= 0) return [];
				return [
					{
						employment_id: row.employment_id,
						employee_number: employeeNumberById.get(row.employment_id) ?? row.employment_id,
						leave_type_id: row.leave_type_id,
						leave_type_code: leaveCodeById.get(row.leave_type_id) ?? row.leave_type_id,
						closing
					}
				];
			})
		};
	}

	// Order: the previous year is processed first, unless it predates the company's earliest hire.
	// An employment hired during the previous year is exempt: its closing reads a zero base, never
	// a provisional level, so nothing it is owed waits on that year's processing.
	if (earliestHire != null && previousYear >= leaveYearOf(earliestHire, startMonth)) {
		const postedPrevious = new Set(postedForYear(previousYear).map((row) => row.employment_id));
		const unprocessed = activeEmployments.filter(
			(employment) =>
				leaveYearOf(dateKey(employment.hire_date) ?? previousEnd, startMonth) < previousYear &&
				!postedPrevious.has(employment.id)
		);
		if (unprocessed.length > 0) {
			refuse(
				`Cannot process leave year ${input.leave_year} before ${previousYear}: ` +
					`${unprocessed.length} employment(s) active on ${previousEnd} have no posted ${previousYear} carry-forward. ` +
					`Process ${previousYear} first.`
			);
		}
	}

	const anchor =
		company.jurisdiction_id == null
			? undefined
			: yield* api.db.jurisdictions.findFirst({
					where: { id: { eq: company.jurisdiction_id } },
					columns: { code: true }
				});
	if (anchor == null)
		refuse(
			`Cannot process leave year ${input.leave_year}: ${company.name} states no jurisdiction anchor, so the statutory floor cannot resolve.`
		);
	const sealedProfiles = yield* api.db.jurisdictions.findMany({
		where: {
			code: { eq: anchor.code },
			lifecycle: { eq: 'SEALED' },
			approval_id: { isNull: true }
		},
		limit: PROCESS_LEAVE_YEAR_QUERY_LIMIT
	});
	requireCompletePage(sealedProfiles, 'sealed-profile', input.leave_year);
	const profile = sealedProfileCovering(sealedProfiles, anchor.code, previousEnd);
	if (profile == null)
		refuse(
			`Cannot process leave year ${input.leave_year}: no sealed statutory profile covers ${previousEnd}, so the statutory leave floor cannot resolve. Seal a version of the law family first.`
		);

	// The banked leave types of the profile sealed for the previous year's last day. Per-event
	// types have no bank and types with no carry policy carry nothing, so neither gets a row.
	const bankedTypes = leaveTypes.filter(
		(type) =>
			statutoryProfileLineage(sealedProfiles, profile).some(
				(entry) => entry.id === type.statutory_profile_id
			) &&
			type.accrual != null &&
			type.accrual.kind !== 'PER_EVENT' &&
			type.accrual.carry != null
	);

	const ledgerByEmployment = new Map<string, LedgerRow[]>();
	for (const row of requestRows) {
		if (row.approval_id != null) continue;
		const event = row.event;
		if (event == null) continue;
		const bucket = ledgerByEmployment.get(row.employment_id) ?? [];
		if (event.kind === 'TIME_OFF') {
			bucket.push({
				id: row.id,
				leave_type_id: row.leave_type_id,
				entry_date: event.range.start.date,
				through_date: event.range.end.date,
				kind: 'TAKEN',
				days: -Math.abs(decodeNumber(event.chargeable_days ?? 0)),
				source_id: row.id,
				approval_id: null
			});
		} else if (event.kind === 'BALANCE_ADJUSTMENT') {
			bucket.push({
				id: row.id,
				leave_type_id: row.leave_type_id,
				entry_date: event.effective_on,
				kind: 'ADJUSTMENT',
				days: decodeNumber(event.movement_days),
				source_id: event.source_id,
				approval_id: null
			});
		} else if (event.kind === 'ENCASHMENT') {
			bucket.push({
				id: row.id,
				leave_type_id: row.leave_type_id,
				entry_date: event.effective_on,
				kind: 'ENCASHMENT',
				days: decodeNumber(event.movement_days),
				source_id: event.source_id,
				approval_id: null
			});
		} else if (event.kind === 'CARRY_FORWARD') {
			bucket.push({
				id: row.id,
				leave_type_id: row.leave_type_id,
				entry_date: event.effective_on,
				kind: 'CARRY_FORWARD',
				days: decodeNumber(event.movement_days),
				source_id: null,
				approval_id: null,
				leave_year: event.leave_year,
				expires_on: event.expires_on
			});
		}
		ledgerByEmployment.set(row.employment_id, bucket);
	}
	const childrenByEmployment = new Map<string, ChildFact[]>();
	for (const child of childRows) {
		const bucket = childrenByEmployment.get(child.employment_id) ?? [];
		bucket.push(child);
		childrenByEmployment.set(child.employment_id, bucket);
	}

	const mutations: Array<{
		employment_id: string;
		leave_type_id: string;
		event: {
			kind: 'CARRY_FORWARD';
			leave_year: number;
			effective_on: string;
			movement_days: number;
			expires_on: string | null;
			forfeited_days: number;
			closing: {
				entitlement: number;
				carried_in: number;
				accrued: number;
				adjusted: number;
				taken: number;
				encashed: number;
				expired: number;
				closing: number;
			};
			statutory_profile_id: string;
		};
	}> = [];
	const negativeClosings: NegativeClosing[] = [];
	for (const employment of activeEmployments) {
		const hireDate = dateKey(employment.hire_date);
		if (hireDate == null)
			refuse(`Employment ${employment.employee_number} has no hire date to close the year from.`);
		const exitDate = employment.exit_date == null ? null : (dateKey(employment.exit_date) ?? null);
		const ledger = ledgerByEmployment.get(employment.id) ?? [];
		const children = childrenByEmployment.get(employment.id) ?? [];
		for (const type of bankedTypes) {
			const carry = type.accrual?.kind === 'PER_EVENT' ? null : type.accrual?.carry;
			if (carry == null) continue;
			const balanceInput: BalanceInput = {
				leaveType: type,
				entitlementAt: (serviceMonths, asOf) =>
					resolveEntitlementAt({
						leaveType: type,
						profiles: sealedProfiles,
						jurisdictionCode: anchor.code,
						children,
						serviceMonths,
						employmentId: employment.id,
						asOf
					}),
				hireDate,
				exitDate,
				leaveYearStartMonth: startMonth,
				ledger,
				basis: 'SETTLED'
			};
			const closing = closingBalance(balanceInput, previousYear);
			// A negative closing posts a carry of zero with the negative in `closing`: nothing is
			// forgiven silently and nothing is carried. The person is reported, not hidden.
			const movement =
				closing.closing < 0
					? 0
					: EffectNumber.clamp({ minimum: 0, maximum: decodeNumber(carry.limit_days) })(
							closing.closing
						);
			const forfeited = Math.max(0, closing.closing - movement);
			if (closing.closing < 0) {
				negativeClosings.push({
					employment_id: employment.id,
					employee_number: employment.employee_number,
					leave_type_id: type.id,
					leave_type_code: type.code,
					closing: closing.closing
				});
			}
			mutations.push({
				employment_id: employment.id,
				leave_type_id: type.id,
				event: {
					kind: 'CARRY_FORWARD',
					leave_year: input.leave_year,
					effective_on: yearStart as IsoDate,
					movement_days: movement,
					expires_on: policyCarryExpiry(balanceInput, input.leave_year),
					forfeited_days: forfeited,
					closing: {
						entitlement: closing.entitlement,
						carried_in: closing.carried_in,
						accrued: closing.accrued,
						adjusted: closing.adjusted,
						taken: closing.taken,
						encashed: closing.encashed,
						expired: closing.expired,
						closing: closing.closing
					},
					statutory_profile_id: profile.id
				}
			});
		}
	}

	// One authored graph mutation is the commit boundary. Zero-day rows are written like any
	// other: their existence, not an inference, is what says the year is processed.
	if (mutations.length > 0) yield* api.db.leave_requests.mutate(mutations);
	const totalCarried = mutations.reduce((total, row) => total + row.event.movement_days, 0);
	const totalForfeited = mutations.reduce((total, row) => total + row.event.forfeited_days, 0);
	return {
		state: 'created' as const,
		company_id: company.id,
		leave_year: input.leave_year,
		rows_written: mutations.length,
		total_carried_days: totalCarried,
		total_forfeited_days: totalForfeited,
		negative_closings: negativeClosings
	};
});

export default defineCommandHandler({
	description:
		'Closes one company leave year: posts the capped carry-forward each active employment opens the next year with, with its expiry and forfeit, in one atomic write. Ordered and idempotent.',
	schema: ProcessLeaveYearInput,
	handler: processLeaveYear
});
