import { datePeriod, eachDay } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { awardedMinutes, holidaysForDay, overlapSpans, scheduled } from './attendance.js';
import { dateWeekday, intervalSpans } from './time_evidence.js';

const WEEKDAYS = [
	'SUNDAY',
	'MONDAY',
	'TUESDAY',
	'WEDNESDAY',
	'THURSDAY',
	'FRIDAY',
	'SATURDAY'
] as const;
import { calculatePayroll, isWorkingDay, offDaysFor, type ProjectedDay } from './engine.js';
import type { JsonObject } from './contracts.js';
import type { PayWindow } from './pay_cycle.js';
import { idOf, objectValue, queryRows, type Reader } from './reads.js';
import { PlainDate } from '@norbital-ai/std/date';
import { Refusal, isJsonObject } from './foundation.js';
import { breakdownOf, type PayslipBreakdown } from './payslip_breakdown.js';
import { accountsOf, totalsScope, viewOf } from '../ledger/core.js';
import { claimLeft, claimWanted, startedOn } from '../ledger/service.js';

/** One payslip row the run's create transform attaches as a child. */

export interface CalculatedPayslip {
	readonly employee_id: string;
	readonly employment_id: string;
	readonly entity_id: string;
	readonly basic_earnings: number;
	readonly gross_earnings: number;
	readonly net_pay: number;
	readonly total_deductions: number;
	readonly employer_cost: number;
	readonly period: string;
	readonly ordinary_wages: number;
	readonly additional_wages: number;
	readonly employee_statutory: number;
	readonly employer_statutory: number;
	readonly tax_withheld: number;
	readonly breakdown: PayslipBreakdown;
}

const covers = (range: unknown, from: string, to: string): boolean => {
	if (!isJsonObject(range)) return false;
	const start = range.from,
		end = range.to;
	return (
		typeof start === 'string' &&
		start <= to &&
		(end === null || end === undefined || (typeof end === 'string' && end >= from))
	);
};

/** A run's frame: the attendance it prices, how far back open entries reach, and an off-cycle run's entries. */
export interface RunFrame {
	readonly attendance: PayWindow;
	readonly since: string;
	/** An off-cycle run: the entries it pays. Only their people get a payslip. */
	readonly pays?: ReadonlySet<string>;
}

const CATALOG = ['id', 'code', 'subtotal_id', 'lookup', 'eligibility', 'conversion'];
const CODE_OF_CATALOG = { fields: ['code'] };

/**
 * Everything a run needs, read once before any payslip: the window's rows and nothing outside it.
 * It is one request, so one statement, and neither the calculation nor the attachments read again.
 */
const refOf = (value: unknown) => String(isJsonObject(value) ? value.id : value);

/**
 * A claim on a limited row pays what it posted: the ledger, not the entry, knows what was left when it came in. One with
 * no movement found nothing left or is on its way, so it pays what posting it would.
 */
const claimsAsPosted = Effect.fn('payroll.claimsAsPosted')(function* (
	read: Reader,
	data: Readonly<Record<string, readonly JsonObject[]>>
) {
	// by code: an entry keeps the row it was raised on, and a later run reads that code in its own version
	const limited = new Map(
		(data.claim_catalog ?? [])
			.filter((row) => objectValue(row.lookup).annual_limit != null)
			.map((row) => [String(row.code), { code: String(row.code), lookup: objectValue(row.lookup) }])
	);
	const codeOf = (row: JsonObject) => String(objectValue(row.catalog_id).code);
	const claims = (data.claim_catalog_entry ?? []).filter((row) => limited.has(codeOf(row)));
	if (claims.length === 0) return data;
	const { ledger_entry: rows = [] } = yield* queryRows(read, {
		ledger_entry: {
			where: { source: { in: claims.map((row) => `claim_catalog_entry:${String(row.id)}`) } },
			fields: ['source', 'operation', 'amount'],
			limit: 10000
		}
	});
	const posted = new Map<string, number>();
	for (const row of rows)
		posted.set(
			String(row.source),
			(posted.get(String(row.source)) ?? 0) +
				(row.operation === 'DEDUCT' ? -1 : 1) * Number(row.amount ?? 0)
		);
	const contract = new Map((data.employee_contract ?? []).map((row) => [String(row.id), row]));
	const balance = new Map(
		(data.employee_balance ?? []).map((row) => [String(row.employee_id), row])
	);
	const scope = String(data.jurisdiction_settings?.[0]?.code);
	const drawn = new Map<string, number>();
	return {
		...data,
		claim_catalog_entry: (data.claim_catalog_entry ?? []).map((row) => {
			const amount = posted.get(`claim_catalog_entry:${String(row.id)}`);
			if (amount !== undefined) return { ...row, quantity: Math.abs(amount) };
			const catalog = limited.get(codeOf(row));
			const employment = contract.get(refOf(row.employment_id));
			if (catalog === undefined || employment === undefined || row.reverses != null) return row;
			const employee = String(employment.employee_id);
			const accounts = accountsOf(balance.get(employee)?.account);
			const keyOf = (period: string) => `${employee}/${catalog.code}/${period}`;
			const [wanted] = claimWanted(
				row,
				catalog,
				{ scope, started: startedOn(employment), events: [] },
				undefined,
				(period) => claimLeft(accounts, catalog, period) - (drawn.get(keyOf(period)) ?? 0)
			);
			if (wanted === undefined) return row;
			drawn.set(keyOf(wanted.period), (drawn.get(keyOf(wanted.period)) ?? 0) + wanted.amount);
			return { ...row, quantity: wanted.amount };
		})
	};
});

export const loadRun = Effect.fn('payroll.loadRun')(function* (
	read: Reader,
	run: JsonObject,
	{ attendance, since, pays }: RunFrame
) {
	const coverage = objectValue(run.salary_coverage);
	const companyId = String(run.entity_id);
	const settingsId = String(run.settings_id);
	const [opens] = [since, attendance.from, String(coverage.from)].sort();
	const closes = [attendance.to, String(coverage.to)].sort().at(-1);
	const own = { entity_id: { eq: companyId } };
	const inVersion = { where: { settings_id: { eq: settingsId } }, limit: 10000 };
	const contract = {
		...own,
		status: { eq: 'SEALED' },
		effective_range: { overlaps: { from: opens ?? since, to: closes ?? attendance.to } }
	};
	const openIn = (field: string) =>
		pays === undefined
			? { ...own, payroll_run_id: { isNull: true }, [field]: { gte: since, lte: attendance.to } }
			: { id: { in: [...pays] } };
	const data = yield* queryRows(read, {
		jurisdiction_settings: {
			where: { id: { eq: settingsId } },
			fields: [
				'id',
				'code',
				'status',
				'timezone',
				'tax_year_start_month',
				'lookup',
				'conversions',
				'ledger'
			],
			limit: 1
		},
		subtotal: { ...inVersion, fields: ['id', 'code', 'name', 'previous_id', 'calculation'] },
		allowance_catalog: {
			...inVersion,
			fields: [...CATALOG, 'party', 'prorate', 'include_in_rate']
		},
		overtime_catalog: { ...inVersion, fields: [...CATALOG, 'direction'] },
		statutory_contribution_catalog: {
			...inVersion,
			fields: [
				'id',
				'code',
				'kind',
				'lookup',
				'subtotal_id',
				'employer_cost_subtotal_id',
				'eligibility',
				'depends_on',
				'employee_amount',
				'employer_amount'
			]
		},
		leave_catalog: { ...inVersion, fields: [...CATALOG, 'direction', 'pay_treatment'] },
		claim_catalog: { ...inVersion, fields: [...CATALOG, 'direction', 'party'] },
		adhoc_catalog: {
			...inVersion,
			fields: [...CATALOG, 'direction', 'party', 'off_cycle_eligible']
		},
		loan_catalog: {
			...inVersion,
			fields: ['id', 'code', 'subtotal_id']
		},
		work_event_catalog: { limit: 10000 },
		work_event: { where: own, limit: 10000 },
		shift_definition: { where: own, limit: 10000 },
		shift_pattern: { where: own, limit: 10000 },
		holiday: { where: own, limit: 10000 },
		entity: { where: { id: { eq: companyId } }, fields: ['payment_schedule'], limit: 1 },
		entity_profile_version: { where: { ...own, status: { eq: 'SEALED' } }, limit: 10000 },
		employee_contract: { where: contract, limit: 10000 },
		employee_profile: { where: { employee_contract: { some: contract } }, limit: 10000 },
		employee_balance: {
			where: { employee_id: { is: { employee_contract: { some: contract } } } },
			limit: 10000
		},
		// a leave stays answerable after its first run: its later days fall in later windows
		leave_catalog_entry: { where: own, limit: 10000 },
		'leave_catalog_entry.catalog_id': CODE_OF_CATALOG,
		'leave_catalog_entry.leave_catalog_entry_day': {
			fields: ['leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
			limit: 10000
		},
		claim_catalog_entry: { where: openIn('incurred_on'), limit: 10000 },
		'claim_catalog_entry.catalog_id': CODE_OF_CATALOG,
		adhoc_catalog_entry: { where: openIn('incurred_on'), limit: 10000 },
		'adhoc_catalog_entry.catalog_id': CODE_OF_CATALOG,
		loan_catalog_entry: { where: own, limit: 10000 },
		'loan_catalog_entry.catalog_id': CODE_OF_CATALOG,
		loan_catalog_entry_repayment: { where: openIn('paid_on'), limit: 10000 },
		workplace_case_catalog_entry: {
			where: { ...own, payroll_run_id: { isNull: true } },
			fields: ['id', 'opened_on', 'closed_on'],
			limit: 10000
		},
		roster_entry: {
			where: {
				employment_id: { is: { entity_id: { eq: companyId } } },
				work_date: { gte: since, lte: attendance.to }
			},
			fields: [
				'employment_id',
				'payroll_run_id',
				'work_date',
				'shift_definition_id',
				'actual_worked_intervals',
				'planned_overtime_intervals'
			],
			limit: 10000
		},
		statutory_change: {
			where: {
				applied_version_id: { isNull: true },
				finding_id: { is: { status: { eq: 'CONFIRMED' } } }
			},
			fields: ['jurisdiction_code', 'effective_from'],
			limit: 10000
		}
	});
	return yield* claimsAsPosted(read, data);
});

export type RunData = Readonly<Record<string, readonly JsonObject[]>>;

/** The rows a run seals, all from what `loadRun` read. One `attaches` write stamps them together. */
export const attachmentsOf = (data: RunData, { attendance: cover, pays }: RunFrame) => {
	const idsOf = <C extends string>(model: C, keep: (row: JsonObject) => boolean = () => true) =>
		(data[model] ?? []).filter(keep).map((row) => idOf(model, row.id));
	const due = (date: unknown) => typeof date === 'string' && date <= cover.to;
	if (pays !== undefined)
		return {
			leave: [],
			claim: idsOf('claim_catalog_entry'),
			adhoc: idsOf('adhoc_catalog_entry'),
			repayment: [],
			case: [],
			roster_entry: []
		};
	const within = (date: unknown) => typeof date === 'string' && date >= cover.from && due(date);
	const leaveDue = (row: JsonObject) => {
		const slots = (Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : [])
			.filter(isJsonObject)
			.filter((child) => child.payroll_run_id == null);
		return row.reverses != null
			? slots.length > 0
			: slots.some((child) => within(child.incurred_on));
	};
	return {
		leave: idsOf('leave_catalog_entry', leaveDue),
		claim: idsOf('claim_catalog_entry', (row) => due(row.incurred_on)),
		adhoc: idsOf('adhoc_catalog_entry', (row) => due(row.incurred_on)),
		repayment: idsOf('loan_catalog_entry_repayment', (row) => due(row.paid_on)),
		case: idsOf(
			'workplace_case_catalog_entry',
			(row) =>
				String(row.opened_on) <= cover.to &&
				(row.closed_on == null || String(row.closed_on) >= cover.from)
		),
		roster_entry: idsOf('roster_entry', (row) => row.payroll_run_id == null && due(row.work_date))
	};
};

/** One run's payslips from what `loadRun` read: pure calculation, one pass per person. */
export const calculateRun = Effect.fn('payroll.calculateRun')(function* (
	data: RunData,
	run: JsonObject,
	frame: RunFrame
) {
	const coverage = run.salary_coverage;
	if (
		!isJsonObject(coverage) ||
		typeof coverage.from !== 'string' ||
		typeof coverage.to !== 'string'
	)
		return yield* Effect.fail(
			new Refusal({ message: 'Payroll needs a complete salary coverage.' })
		);
	const from = coverage.from,
		to = coverage.to;
	// a run prices only what falls in its period, the same dates `attaches` posts: nothing dated elsewhere pays or deducts
	const { from: start, to: end } = frame.attendance;
	const companyId = String(run.entity_id);
	const settings = (data.jurisdiction_settings ?? [])[0];
	if (settings === undefined || settings['status'] !== 'SEALED')
		return yield* Effect.fail(new Refusal({ message: 'The run needs a sealed jurisdiction.' }));
	const employerVersion = (data.entity_profile_version ?? []).find((row) =>
		covers(row.effective_range, from, to)
	);
	if (employerVersion === undefined)
		return yield* Effect.fail(
			new Refusal({ message: 'No employer version covers the salary period.' })
		);
	const entityRecord = (data.entity ?? [])[0];
	const employer: JsonObject = {
		...employerVersion,
		...(entityRecord === undefined
			? {}
			: {
					payment_schedule: entityRecord.payment_schedule
				})
	};
	const covering = (data.employee_contract ?? []).filter((row) =>
		covers(row.effective_range, from, to)
	);
	if (covering.length === 0) return { payslips: [] };
	// one payslip a person: a renewal inside the period pays on the contract in force at its end
	const startOf = (row: JsonObject) => String(objectValue(row.effective_range).from ?? '');
	const contracts = [
		...new Map(
			[...covering]
				.toSorted((left, right) => startOf(left).localeCompare(startOf(right)))
				.map((row) => [String(row.employee_id), row])
		).values()
	];

	const { since, pays } = frame;
	// what was entered after an earlier run closed is paid here, a cycle late
	const due = (row: JsonObject, date: unknown): boolean =>
		pays?.has(String(row.id)) ??
		(typeof date === 'string' &&
			date <= end &&
			(date >= start || (row.payroll_run_id == null && date >= since)));
	const employeeIds = [...new Set(contracts.map((row) => String(row.employee_id)))];
	// every contract of the person answers for its entries by their dates, a run pays on the one in force
	const answering = (data.employee_contract ?? []).filter((row) =>
		employeeIds.includes(String(row.employee_id))
	);
	const profiles = new Map((data.employee_profile ?? []).map((row) => [String(row.id), row]));
	const balances = new Map(
		(data.employee_balance ?? []).map((row) => [String(row.employee_id), row])
	);

	const workRows = (data.roster_entry ?? []).filter((row) => due(row, row.work_date));
	const closedSpans = (value: unknown) =>
		intervalSpans(
			Array.isArray(value) ? value.filter((row) => isJsonObject(row) && row.end != null) : []
		);
	const stamped = (spans: readonly { start: number; end: number }[]) =>
		spans.map(({ start, end }) => ({
			start: new Date(start).toISOString(),
			end: new Date(end).toISOString()
		}));
	const fullAward = Number(employer.overtime_full_award_percent ?? 100);
	const shifts = new Map((data.shift_definition ?? []).map((row) => [row.id, row]));
	const patterns = new Map((data.shift_pattern ?? []).map((row) => [row.id, row]));
	/** A contract's planned day with no roster entry: its pattern's day, else its ordinary week (undefined: no shift). */
	const plannedWork = (terms: JsonObject, date: string): boolean | undefined => {
		const pattern = patterns.get(terms.shift_pattern_id);
		if (pattern === undefined) return isWorkingDay(date, offDaysFor(terms, employer));
		const cycle = objectValue(pattern.pattern);
		const weekly = isJsonObject(cycle.days) ? cycle.days : null;
		const rotation = Array.isArray(cycle.cycle) ? cycle.cycle : null;
		const from = String(objectValue(pattern.effective_range).from ?? '');
		let shiftId: string | null = null;
		if (weekly !== null) {
			const weekday = WEEKDAYS[dateWeekday(date)] ?? 'SUNDAY';
			shiftId = String(weekly[weekday] ?? '');
		} else if (rotation !== null && rotation.length > 0 && from !== '') {
			const span = Math.round(
				(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
			);
			shiftId = String(
				objectValue(rotation[((span % rotation.length) + rotation.length) % rotation.length])
					.shift_definition_id
			);
		}
		const shift = shiftId == null ? undefined : shifts.get(shiftId);
		return shift === undefined ? undefined : objectValue(shift.variant).day_type === 'WORK';
	};
	const zone = String(settings.timezone);
	const planOf = (row: JsonObject) => {
		const shift = shifts.get(row.shift_definition_id);
		return scheduled(row, { zone, ...(shift === undefined ? {} : { shift }) });
	};
	const scheduledHours = ({ spans, untimed }: ReturnType<typeof planOf>) =>
		spans.reduce((total, span) => total + (span.end - span.start) / 3_600_000, untimed);
	const rosterDayTypes = new Map<string, Record<string, string>>();
	for (const row of workRows) {
		const owner = String(row.employment_id);
		const days = rosterDayTypes.get(owner) ?? {};
		days[String(row.work_date)] = planOf(row).day_type;
		rosterDayTypes.set(owner, days);
	}
	// a holiday given only to those off on the date it replaces reads that date's plan, rostered or not: a six-day week
	// works its Saturday, so the weekday in lieu of a Saturday holiday is not its holiday
	const replaced = [
		...new Set(
			(data.holiday ?? []).flatMap((row) =>
				typeof row.replaces === 'string' ? [row.replaces] : []
			)
		)
	];
	for (const [owner, days] of rosterDayTypes) {
		const own = answering.find((row) => String(row.id) === owner);
		if (own === undefined) continue;
		for (const date of replaced) {
			if (days[date] !== undefined) continue;
			const row =
				answering.find(
					(contract) =>
						contract.employee_id === own.employee_id && covers(contract.effective_range, date, date)
				) ?? own;
			const work = plannedWork(objectValue(row.terms), date);
			if (work !== undefined) days[date] = work ? 'WORK' : 'OFF';
		}
	}
	const workDays = new Map<string, JsonObject[]>();
	for (const row of workRows) {
		const owner = String(row.employment_id);
		if (owner === undefined) continue;
		const days = workDays.get(owner) ?? [];
		const date = String(row.work_date);
		const holidays = holidaysForDay(date, {
			holidays: data.holiday ?? [],
			roster_day_types: rosterDayTypes.get(owner) ?? {},
			roster_days: []
		});
		// a makeup workday never masks the holiday it makes up for: every other kind earns its premium
		const holiday = holidays.find((row) => row.kind !== 'MAKEUP_WORKDAY') ?? holidays[0];
		const plan = planOf(row);
		// the clock proves the person came and awards the plan; it never adds time of its own
		const clock = closedSpans(row.actual_worked_intervals);
		const planned = closedSpans(row.planned_overtime_intervals);
		const overtime = awardedMinutes(planned, clock, fullAward) / 60;
		const worked = clock.length === 0 ? 0 : scheduledHours(plan) + overtime;
		days.push({
			date,
			day_type: plan.day_type,
			scheduled_hours: scheduledHours(plan),
			holiday_kind: typeof holiday?.kind === 'string' ? holiday.kind : '',
			worked: worked > 0,
			worked_hours: worked,
			overtime_hours: overtime,
			intervals: stamped(overlapSpans(clock, [...plan.spans, ...planned])),
			overtime_intervals: stamped(overlapSpans(planned, clock))
		});
		workDays.set(owner, days);
	}

	const within = (date: unknown): boolean =>
		typeof date === 'string' && date >= start && date <= end;
	const leaveWithin = (rows: readonly JsonObject[]): readonly JsonObject[] =>
		rows.flatMap((row) => {
			const days = (Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : [])
				.filter(isJsonObject)
				.flatMap((child) =>
					child.payroll_run_id == null &&
					(row.reverses != null || row.encashment === true || within(child.incurred_on))
						? [{ date: String(child.incurred_on), part: String(child.part) }]
						: []
				);
			// a cash-out is a balance settled, not leave taken on its placeholder dates: every slot prices.
			// a sealed entry still answers for its dates in later runs: only its own period's days are here
			return days.length === 0 ? [] : [{ ...row, days, payroll_run_id: null }];
		});

	// an entry keeps the catalogue row it was raised on; a run reads it as that code in its own version
	const inRunVersion = (
		entries: readonly JsonObject[],
		own: readonly JsonObject[] = []
	): readonly JsonObject[] => {
		const current = new Map(own.map((row) => [row.code, row.id]));
		return entries.map((row) => {
			const raised = objectValue(row.catalog_id);
			return { ...row, catalog_id: current.get(raised.code) ?? raised.id ?? null };
		});
	};

	/** What a person's contracts project over the salary and attendance periods. */
	const projectionDays = eachDay(datePeriod(start < from ? start : from, end > to ? end : to)).map(
		String
	);
	const projectedDays = (
		rows: readonly JsonObject[],
		roster: ReadonlyMap<string, JsonObject>
	): readonly ProjectedDay[] | undefined => {
		const days: ProjectedDay[] = [];
		const ordered = rows.toSorted((left, right) =>
			String(objectValue(left.effective_range).from).localeCompare(
				String(objectValue(right.effective_range).from)
			)
		);
		for (const date of projectionDays) {
			// a day outside the employment is still one of the period's: the share leaves it unpaid
			const row =
				rows.find((contract) => covers(contract.effective_range, date, date)) ??
				ordered.findLast(
					(contract) => String(objectValue(contract.effective_range).from) <= date
				) ??
				ordered[0];
			if (row === undefined) continue;
			const terms = objectValue(row.terms);
			// a roster day changes the plan; a day with no roster entry follows the contract's pattern or ordinary week
			const rostered = roster.get(`${String(row.id)}:${date}`);
			const rosteredShift =
				rostered === undefined ? undefined : shifts.get(String(rostered.shift_definition_id));
			if (rosteredShift !== undefined) {
				days.push({ date, work: objectValue(rosteredShift.variant).day_type === 'WORK' });
				continue;
			}
			const work = plannedWork(terms, date);
			if (work === undefined) continue;
			days.push({ date, work });
		}
		return days;
	};

	const paid: CalculatedPayslip[] = [];
	for (const contract of contracts) {
		const employmentId = String(contract.id),
			employeeId = String(contract.employee_id);
		const employee = profiles.get(employeeId),
			balance = balances.get(employeeId);
		if (employee === undefined) continue;
		const own = new Set(
			answering.filter((row) => row.employee_id === employeeId).map((row) => String(row.id))
		);
		// a reversal's refund is priced on the entry it undoes, so that entry travels with the run for its days
		const heldLeave = data.leave_catalog_entry ?? [];
		const undoneIds = new Set(
			heldLeave.flatMap((row) =>
				row.reverses != null && typeof row.reverses === 'string' ? [row.reverses] : []
			)
		);
		const entries = (rows: readonly JsonObject[] | undefined) =>
			(rows ?? []).filter(
				(row) =>
					undoneIds.has(String(row.id)) ||
					(own.has(String(row.employment_id)) && (pays?.has(String(row.id)) ?? true))
			);
		const reversals = heldLeave
			.filter((row) => undoneIds.has(String(row.id)))
			.map((row) => ({
				...row,
				days: (Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : [])
					.filter(isJsonObject)
					.map((child) => ({
						date: PlainDate(String(child.incurred_on)),
						part: String(child.part)
					}))
			}));
		if (
			pays !== undefined &&
			[data.adhoc_catalog_entry, data.claim_catalog_entry].every(
				(rows) => entries(rows).length === 0
			)
		)
			continue;
		const contractsOfEmployee = answering.filter((row) => row.employee_id === employeeId);
		const contractIds = new Set(contractsOfEmployee.map((row) => String(row.id)));
		const roster = new Map(
			(data.roster_entry ?? [])
				.filter(
					(row) =>
						contractIds.has(String(row.employment_id)) &&
						typeof row.work_date === 'string' &&
						typeof row.shift_definition_id === 'string'
				)
				.map((row) => [`${String(row.employment_id)}:${String(row.work_date)}`, row])
		);
		const projected = projectedDays(contractsOfEmployee, roster);
		const workCatalog = new Map(
			(data.work_event_catalog ?? []).map((row) => [String(row.id), row])
		);
		const workEvents = (data.work_event ?? []).flatMap((row) => {
			if (row.employment_id != null && String(row.employment_id) !== employmentId) return [];
			const catalog = workCatalog.get(String(row.catalog_id));
			if (catalog === undefined) return [];
			return [
				{
					code: String(catalog.code),
					from: String(row.from),
					to: row.to == null ? null : String(row.to),
					location: row.location ?? null
				}
			];
		});
		const result = yield* Effect.try({
			try: () =>
				calculatePayroll({
					run,
					settings,
					subtotals: data.subtotal ?? [],
					allowance: data.allowance_catalog ?? [],
					overtime: data.overtime_catalog ?? [],
					statutory: data.statutory_contribution_catalog ?? [],
					leave_catalog: data.leave_catalog ?? [],
					claim_catalog: data.claim_catalog ?? [],
					adhoc_catalog: data.adhoc_catalog ?? [],
					loan_catalog: data.loan_catalog ?? [],
					employee,
					employment: contract,
					employer,
					balance: {
						account: viewOf(
							accountsOf(balance?.account),
							totalsScope(settings, companyId),
							Number(settings.tax_year_start_month ?? 1),
							String(run.pay_date ?? objectValue(run.salary_coverage).to)
						)
					},
					reversals,
					entries: {
						leave_catalog_entry: inRunVersion(
							leaveWithin(entries(data.leave_catalog_entry)),
							data.leave_catalog
						),
						claim_catalog_entry: inRunVersion(
							entries(data.claim_catalog_entry).filter((row) => due(row, row.incurred_on)),
							data.claim_catalog
						),
						adhoc_catalog_entry: inRunVersion(
							entries(data.adhoc_catalog_entry).filter((row) => due(row, row.incurred_on)),
							data.adhoc_catalog
						),
						loan_catalog_entry: inRunVersion(entries(data.loan_catalog_entry), data.loan_catalog),
						loan_catalog_entry_repayment: entries(data.loan_catalog_entry_repayment).filter((row) =>
							due(row, row.paid_on)
						)
					},
					work: { days: [...own].flatMap((id) => workDays.get(id) ?? []) },
					work_events: workEvents,
					...(projected === undefined ? {} : { projected_days: projected }),
					employed: answering
						.filter((row) => row.employee_id === employeeId)
						.map((row) => {
							const { from, to } = objectValue(row.effective_range);
							return { from: String(from), to: to == null ? null : String(to) };
						})
				}),
			catch: (cause) =>
				cause instanceof Refusal
					? cause
					: new Refusal({ message: cause instanceof Error ? cause.message : 'Payroll failed.' })
		});
		const deductions = result.lines
			.filter((line) => line.party === 'EMPLOYEE' && line.direction === 'DEDUCT')
			.reduce((total, line) => total + line.amount, 0);
		const money = (value: number) => Math.round(value * 1e12) / 1e12;
		const subtotalValue = (code: unknown): number => {
			if (typeof code !== 'string') return 0;
			return result.subtotals.find((row) => row.code === code)?.value ?? 0;
		};
		const ordinary = subtotalValue('ORDINARY_WAGES');
		const additionalTotal = subtotalValue('ADDITIONAL_WAGES');
		const additional = Math.max(0, additionalTotal - ordinary);
		const contributions = result.statutory.filter((row) => row.kind === 'CONTRIBUTION');
		const employeeStatutory = contributions.reduce((total, row) => total + row.employee, 0);
		const employerStatutory = contributions.reduce((total, row) => total + row.employer, 0);
		const taxWithheld = result.statutory
			.filter((row) => row.kind === 'TAX')
			.reduce((total, row) => total + row.employee, 0);
		paid.push({
			employee_id: employeeId,
			employment_id: employmentId,
			entity_id: companyId,
			basic_earnings: money(result.subtotals[0]?.value ?? 0),
			gross_earnings: money(result.net_pay + deductions),
			net_pay: money(result.net_pay),
			total_deductions: money(Math.max(0, deductions)),
			employer_cost: money(result.employer_cost),
			period: String(run.period ?? coverage.from.slice(0, 7)),
			// a deduction entry can exceed the period's pay; reported wages stop at zero
			ordinary_wages: money(Math.max(0, ordinary)),
			additional_wages: money(additional),
			employee_statutory: money(Math.max(0, employeeStatutory)),
			employer_statutory: money(employerStatutory),
			tax_withheld: money(Math.max(0, taxWithheld)),
			breakdown: breakdownOf(result)
		});
	}
	return { payslips: paid };
});
