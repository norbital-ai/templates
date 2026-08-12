import { refuse } from '@norbital-ai/pod/authoring';
import { completedMonths } from '../payroll_runs/lib/dates.js';
import { leaveBalance, resolveEntitlement } from '../payroll_runs/lib/leave.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import { patternRosterCodeId } from '../../lib/scheduling/work-pattern.js';
import { rosterCodeKind } from '../../lib/scheduling/roster-code.js';
import type { LeaveEvent } from '../../custom-types/leave_event/+definition.js';
import type { Hooks } from './$types.js';

type Half = 'FIRST' | 'SECOND';
type Point = { readonly date: string; readonly half: Half };
type TimeOffEvent = Extract<LeaveEvent, { kind: 'TIME_OFF' }>;

const LIMIT = 20_000;
const DAY_MS = 86_400_000;

function dateKey(value: string | Date): string {
	return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function pointNumber(point: Point): number {
	return (
		Math.floor(Date.parse(`${point.date}T00:00:00.000Z`) / DAY_MS) * 2 +
		(point.half === 'SECOND' ? 1 : 0)
	);
}

function pointAt(number: number): Point {
	const day = Math.floor(number / 2);
	return {
		date: new Date(day * DAY_MS).toISOString().slice(0, 10),
		half: number % 2 === 0 ? 'FIRST' : 'SECOND'
	};
}

function rangeOf(event: TimeOffEvent): { start: Point; end: Point } {
	return event.range;
}

function assertRange(range: { start: Point; end: Point }): void {
	if (pointNumber(range.end) < pointNumber(range.start)) {
		refuse('Leave must end after it starts. Select one continuous range on the calendar.');
	}
}

type HookApi = Parameters<NonNullable<NonNullable<Hooks['create']>['before']>['handler']>[0]['api'];

async function normalizedTimeOff(options: {
	readonly api: HookApi;
	readonly employmentId: string;
	readonly leaveTypeId: string;
	readonly event: TimeOffEvent;
	readonly excludeId?: string;
}): Promise<TimeOffEvent> {
	const { api, employmentId, leaveTypeId, event, excludeId } = options;
	const range = rangeOf(event);
	assertRange(range);

	const employment = await api.db.query.employments.findFirst({
		where: { norbital_id: { eq: employmentId } }
	});
	if (employment == null) refuse('The leave request must reference an employment on file.');
	if (range.start.date < dateKey(employment.hire_date)) {
		refuse('Leave cannot start before the employment hire date.');
	}
	if (employment.exit_date != null && range.end.date > dateKey(employment.exit_date)) {
		refuse('Leave cannot end after the employment exit date.');
	}

	const [company, leaveType, holidays, terms, rosterEntries, existingRequests] = await Promise.all([
		api.db.query.companies.findFirst({ where: { norbital_id: { eq: employment.company_id } } }),
		api.db.query.leave_types.findFirst({
			where: { norbital_id: { eq: leaveTypeId }, company_id: { eq: employment.company_id } }
		}),
		api.db.query.company_holidays.findMany({
			where: {
				company_id: { eq: employment.company_id },
				date: { gte: range.start.date, lte: range.end.date }
			},
			limit: LIMIT
		}),
		api.db.query.employment_terms.findMany({
			where: { employment_id: { eq: employmentId } },
			limit: LIMIT
		}),
		api.db.query.roster_entries.findMany({
			where: {
				employment_id: { eq: employmentId },
				work_date: { gte: range.start.date, lte: range.end.date }
			},
			limit: LIMIT
		}),
		api.db.query.leave_requests.findMany({
			where: {
				employment_id: { eq: employmentId },
				kind: { eq: 'TIME_OFF' },
				from_date: { lte: range.end.date },
				to_date: { gte: range.start.date }
			},
			limit: LIMIT
		})
	]);
	if (company == null) refuse('The employing entity no longer exists.');
	if (leaveType == null) refuse('That leave type does not belong to the employing entity.');
	if (!coversDate(leaveType.effective_range, range.start.date)) {
		refuse('That leave type is not effective when the selected range starts.');
	}

	for (const request of existingRequests) {
		if (request.norbital_id === excludeId) continue;
		const other = rangeOf(request.event as TimeOffEvent);
		if (
			pointNumber(other.start) <= pointNumber(range.end) &&
			pointNumber(other.end) >= pointNumber(range.start)
		) {
			refuse(
				`The selected half-day range overlaps another leave request beginning ${other.start.date}.`
			);
		}
	}

	const shiftIds = [
		...new Set(
			[
				...rosterEntries.map((entry) => entry.shift_definition_id),
				...terms.flatMap((term) => {
					const pattern = term.work_pattern;
					if (pattern?.type !== 'PATTERNED') return [];
					return pattern.phases.flatMap((phase) =>
						phase.day_cycle.map((day) => day.roster_code_id)
					);
				})
			].filter((id): id is string => typeof id === 'string')
		)
	];
	const rosterCodes = await api.db.query.shift_definitions.findMany({
		where: { norbital_id: { in: shiftIds } },
		limit: LIMIT
	});
	const rosterCodeById = new Map(rosterCodes.map((code) => [code.norbital_id, code]));
	const rosterByDate = new Map(rosterEntries.map((entry) => [dateKey(entry.work_date), entry]));
	const holidayDates = new Set(holidays.map((holiday) => dateKey(holiday.date)));

	const eligible = (date: string): boolean => {
		if (holidayDates.has(date)) return false;
		const term = terms.find((candidate) => coversDate(candidate.effective_range, date));
		if (term == null) refuse(`No employment terms cover ${date}, so leave cannot be measured.`);
		const rosterCodeId =
			rosterByDate.get(date)?.shift_definition_id ?? patternRosterCodeId(term.work_pattern, date);
		if (rosterCodeId == null) return false;
		const code = rosterCodeById.get(rosterCodeId);
		if (code == null) refuse(`The schedule on ${date} names a roster code that no longer exists.`);
		return rosterCodeKind(code.variant) === 'WORK';
	};

	let chargedHalfDays = 0;
	for (let number = pointNumber(range.start); number <= pointNumber(range.end); number += 1) {
		if (eligible(pointAt(number).date)) chargedHalfDays += 1;
	}
	if (chargedHalfDays === 0) {
		refuse(
			'The selected range contains no scheduled work half-days after holidays and rest/off days are excluded.'
		);
	}

	if (leaveType.accrual?.kind !== 'PER_EVENT') {
		const allLedger = await api.db.query.leave_requests.findMany({
			where: { employment_id: { eq: employmentId }, leave_type_id: { eq: leaveTypeId } },
			limit: LIMIT
		});
		const projectedLedger = allLedger
			.filter((row) => row.norbital_id !== excludeId && row.from_date != null)
			.map((row) => ({
				norbital_id: row.norbital_id,
				leave_type_id: row.leave_type_id,
				entry_date: row.from_date!,
				kind: row.kind,
				days: row.kind === 'TIME_OFF' ? -Math.abs(Number(row.days)) : Number(row.days),
				source_id: null,
				norbital_approval_id: row.norbital_approval_id
			}));
		const entitlementAtMonths = (serviceMonths: number) =>
			resolveEntitlement({
				leaveType,
				serviceMonths,
				employmentId,
				asOf: range.end.date
			});
		const available = leaveBalance(
			{
				leaveType,
				entitlementAtMonths,
				hireDate: dateKey(employment.hire_date),
				exitDate: employment.exit_date == null ? null : dateKey(employment.exit_date),
				leaveYearStartMonth: Number(company.leave_year_start_month),
				ledger: projectedLedger,
				basis: 'PROJECTED'
			},
			range.end.date
		);
		const requestedDays = chargedHalfDays / 2;
		if (requestedDays > available + 1e-9) {
			refuse(
				`This range charges ${requestedDays} day(s), but only ${Math.max(0, available)} day(s) are available.`
			);
		}
		// Resolve once here as a loud policy check even when no accrued balance exists yet.
		entitlementAtMonths(completedMonths(dateKey(employment.hire_date), range.end.date));
	}

	return {
		...event,
		range,
		chargeable_days: chargedHalfDays / 2
	};
}

export default {
	create: {
		before: {
			description:
				'Normalizes one half-day-stepped leave range, excludes observed holidays and scheduled rest/off days, refuses overlaps and requests beyond the projected balance.',
			handler: async ({ input, api }) => {
				if (input.event == null || input.event.kind !== 'TIME_OFF') return input;
				return {
					...input,
					event: await normalizedTimeOff({
						api,
						employmentId: input.employment_id,
						leaveTypeId: input.leave_type_id,
						event: input.event as TimeOffEvent
					})
				};
			}
		}
	},
	update: {
		before: {
			description:
				'Re-checks the complete patched leave request so changing the person, leave type or range cannot bypass schedule exclusions, overlap protection or balance limits.',
			handler: async ({ input, existing, api }) => {
				const event = input.event ?? existing.event;
				if (event == null || event.kind !== 'TIME_OFF') return input;
				return {
					...input,
					event: await normalizedTimeOff({
						api,
						employmentId: input.employment_id ?? existing.employment_id,
						leaveTypeId: input.leave_type_id ?? existing.leave_type_id,
						event: event as TimeOffEvent,
						excludeId: existing.norbital_id
					})
				};
			}
		}
	}
} satisfies Hooks;
