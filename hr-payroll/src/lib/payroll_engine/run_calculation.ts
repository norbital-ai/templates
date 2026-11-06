import { datePeriod, eachDay } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { awardedMinutes, holidaysForDay, overlapSpans, scheduled } from './attendance.js';
import { intervalSpans } from './time_evidence.js';
import { calculatePayroll, type ProjectedDay } from './engine.js';
import type { JsonObject, Unit } from './contracts.js';
import type { PayWindow } from './pay_cycle.js';
import { idOf, objectValue, queryRows, type Reader } from './reads.js';
import { Refusal, isJsonObject } from './foundation.js';
import { breakdownOf, type PayslipBreakdown } from './payslip_breakdown.js';

/** One payslip row the run's create transform attaches as a child. */
export interface CalculatedLedger {
	readonly balance_id: string;
	readonly operation: 'CREATE' | 'REMOVE' | 'ADD' | 'DEDUCT';
	readonly account: string;
	readonly code: string;
	readonly amount: number;
	readonly unit?: Unit;
	readonly effective_on: string;
}

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

const daysBetween = (from: string, to: string): number =>
	Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

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

const CATALOG = [
	'id',
	'code',
	'name',
	'subtotal_id',
	'lookup',
	'eligibility',
	'conversion',
	'incurred_on',
	'direction',
	'party',
	'off_cycle_eligible'
];
const CODE_OF_CATALOG = { fields: ['code'] };

/**
 * Everything a run needs, read once before any payslip: the window's rows and nothing outside it.
 * It is one request, so one statement, and neither the calculation nor the attachments read again.
 */
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
	return yield* queryRows(read, {
		jurisdiction_settings: {
			where: { id: { eq: settingsId } },
			fields: ['id', 'code', 'status', 'timezone', 'tax_year_start_month', 'lookup'],
			limit: 1
		},
		subtotal: { ...inVersion, fields: ['id', 'code', 'name', 'previous_id', 'calculation'] },
		allowance_catalog: { ...inVersion, fields: [...CATALOG, 'prorate'] },
		overtime_catalog: { ...inVersion, fields: CATALOG },
		statutory_contribution_catalog: {
			...inVersion,
			fields: [
				'id',
				'code',
				'name',
				'kind',
				'lookup',
				'subtotal_id',
				'employer_cost_subtotal_id',
				'off_cycle_eligible',
				'eligibility',
				'depends_on',
				'employee_amount',
				'employer_amount'
			]
		},
		leave_catalog: { ...inVersion, fields: [...CATALOG, 'pay_treatment'] },
		claim_catalog: { ...inVersion, fields: CATALOG },
		adhoc_catalog: { ...inVersion, fields: CATALOG },
		loan_catalog: {
			...inVersion,
			fields: ['id', 'code', 'name', 'subtotal_id', 'off_cycle_eligible']
		},
		shift_definition: { where: own, limit: 10000 },
		shift_pattern: { where: own, limit: 10000 },
		holiday: { where: own, limit: 10000 },
		entity_profile_version: { where: { ...own, status: { eq: 'SEALED' } }, limit: 10000 },
		employee_contract: { where: contract, limit: 10000 },
		employee_profile: { where: { employee_contract: { some: contract } }, limit: 10000 },
		employee_balance: {
			where: { employee_id: { is: { employee_contract: { some: contract } } } },
			limit: 10000
		},
		// a leave stays answerable after its first run: its later days fall in later windows
		leave_catalog_entry: {
			where: pays === undefined ? own : { id: { in: [...pays] } },
			limit: 10000
		},
		'leave_catalog_entry.catalog_id': CODE_OF_CATALOG,
		claim_catalog_entry: { where: openIn('incurred_on'), limit: 10000 },
		'claim_catalog_entry.catalog_id': CODE_OF_CATALOG,
		adhoc_catalog_entry: { where: openIn('incurred_on'), limit: 10000 },
		'adhoc_catalog_entry.catalog_id': CODE_OF_CATALOG,
		loan_catalog_entry: { where: own, limit: 10000 },
		'loan_catalog_entry.catalog_id': CODE_OF_CATALOG,
		loan_repayment_entry: { where: openIn('paid_on'), limit: 10000 },
		work_interruption_catalog_entry: {
			where: { ...own, payroll_run_id: { isNull: true } },
			fields: ['id', 'period'],
			limit: 10000
		},
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
			interruption: [],
			case: [],
			roster_entry: []
		};
	const within = (date: unknown) => typeof date === 'string' && date >= cover.from && due(date);
	return {
		leave: idsOf(
			'leave_catalog_entry',
			(row) =>
				row.payroll_run_id == null &&
				Array.isArray(row.days) &&
				row.days.some((day) => isJsonObject(day) && within(day.date))
		),
		claim: idsOf('claim_catalog_entry', (row) => due(row.incurred_on)),
		adhoc: idsOf('adhoc_catalog_entry', (row) => due(row.incurred_on)),
		repayment: idsOf('loan_repayment_entry', (row) => due(row.paid_on)),
		interruption: idsOf('work_interruption_catalog_entry', (row) => {
			const { from, to } = objectValue(row.period);
			return String(from) <= cover.to && (to == null || String(to) >= cover.from);
		}),
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
	const employer = (data.entity_profile_version ?? []).find((row) =>
		covers(row.effective_range, from, to)
	);
	if (employer === undefined)
		return yield* Effect.fail(
			new Refusal({ message: 'No employer version covers the salary period.' })
		);
	const covering = (data.employee_contract ?? []).filter((row) =>
		covers(row.effective_range, from, to)
	);
	if (covering.length === 0) return { payslips: [], ledger: [] };
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
	const workDays = new Map<string, JsonObject[]>();
	for (const row of workRows) {
		const owner = String(row.employment_id);
		if (owner === undefined) continue;
		const days = workDays.get(owner) ?? [];
		const date = String(row.work_date);
		const holiday = holidaysForDay(date, {
			holidays: data.holiday ?? [],
			roster_day_types: rosterDayTypes.get(owner) ?? {},
			roster_days: []
		})[0];
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
			const days = (Array.isArray(row.days) ? row.days : []).filter(
				(day) => isJsonObject(day) && within(day.date)
			);
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

	const patterns = new Map((data.shift_pattern ?? []).map((row) => [row.id, row]));
	/** What a person's contracts project over the salary and attendance periods. */
	const projectionDays = eachDay(datePeriod(start < from ? start : from, end > to ? end : to)).map(
		String
	);
	const projectedDays = (rows: readonly JsonObject[]): readonly ProjectedDay[] | undefined => {
		const days: ProjectedDay[] = [];
		for (const date of projectionDays) {
			const row = rows.find((contract) => covers(contract.effective_range, date, date));
			if (row === undefined) continue;
			const terms = objectValue(row.terms);
			const pattern = patterns.get(terms.shift_pattern_id);
			if (pattern === undefined) return undefined;
			const cycle = objectValue(pattern.pattern);
			const slots = Array.isArray(cycle.days) ? cycle.days : [];
			if (slots.length === 0) return undefined;
			const index = daysBetween(String(cycle.anchor_date), date);
			const slot = ((index % slots.length) + slots.length) % slots.length;
			const shift = shifts.get(objectValue(slots[slot]).shift_definition_id);
			if (shift === undefined) continue;
			days.push({ date, work: objectValue(shift.variant).day_type === 'WORK' });
		}
		return days;
	};

	const paid: CalculatedPayslip[] = [];
	const ledger: CalculatedLedger[] = [];
	for (const contract of contracts) {
		const employmentId = String(contract.id),
			employeeId = String(contract.employee_id);
		const employee = profiles.get(employeeId),
			balance = balances.get(employeeId);
		if (employee === undefined) continue;
		const own = new Set(
			answering.filter((row) => row.employee_id === employeeId).map((row) => String(row.id))
		);
		const entries = (rows: readonly JsonObject[] | undefined) =>
			(rows ?? []).filter(
				(row) => own.has(String(row.employment_id)) && (pays?.has(String(row.id)) ?? true)
			);
		if (
			pays !== undefined &&
			[data.adhoc_catalog_entry, data.claim_catalog_entry].every(
				(rows) => entries(rows).length === 0
			)
		)
			continue;
		const projected = projectedDays(answering.filter((row) => row.employee_id === employeeId));
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
					balance: balance ?? { account: {} },
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
						loan_repayment_entry: entries(data.loan_repayment_entry).filter((row) =>
							due(row, row.paid_on)
						)
					},
					work: { days: [...own].flatMap((id) => workDays.get(id) ?? []) },
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
		if (balance !== undefined)
			for (const movement of result.ledger)
				ledger.push({
					balance_id: String(balance.id),
					operation: movement.operation,
					account: movement.account,
					code: movement.code,
					amount: movement.amount,
					...(movement.unit === undefined ? {} : { unit: movement.unit }),
					effective_on: movement.effective_on
				});
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
			employee_statutory: money(employeeStatutory),
			employer_statutory: money(employerStatutory),
			tax_withheld: money(taxWithheld),
			breakdown: breakdownOf(result)
		});
	}
	return { payslips: paid, ledger };
});
