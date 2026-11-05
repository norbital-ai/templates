import { datePeriod, eachDay } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { awardedMinutes, holidaysForDay, overlapSpans, scheduled } from './attendance.js';
import { intervalSpans } from './time_evidence.js';
import { calculatePayroll } from './engine.js';
import type { JsonObject, Unit } from './contracts.js';
import { objectValue, queryRows, type Reader } from './reads.js';
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

const statutoryHistory = (entries: readonly JsonObject[]): readonly JsonObject[] => {
	const totals = new Map<string, { employee: number; employer: number }>();
	for (const entry of entries) {
		const code = String(entry.code ?? '');
		const dot = code.lastIndexOf('.');
		if (dot === -1) continue;
		const scheme = code.slice(0, dot),
			side = code.slice(dot + 1);
		if (side !== 'employee' && side !== 'employer') continue;
		const value = entry.amount;
		if (typeof value !== 'number' || !Number.isFinite(value)) continue;
		const row = totals.get(scheme) ?? { employee: 0, employer: 0 };
		row[side] += value;
		totals.set(scheme, row);
	}
	return [...totals].map(([code, value]) => ({ code, ...value }));
};

/**
 * Calculate one run's payslips: the engine is pure, this only gathers its declared inputs.
 * Reads stay in three bounded requests so a create transform keeps its crossing budget.
 */
export const calculateRun = Effect.fn('payroll.calculateRun')(function* (
	read: Reader,
	run: JsonObject
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
	const attendance = isJsonObject(run.attendance_coverage) ? run.attendance_coverage : coverage;
	const start = typeof attendance.from === 'string' ? attendance.from : from;
	const end = typeof attendance.to === 'string' ? attendance.to : to;
	const companyId = String(run.entity_id),
		settingsId = String(run.settings_id);

	const first = yield* queryRows(read, {
		jurisdiction_settings: { where: { id: { eq: settingsId } }, limit: 1 },
		subtotal: { where: { settings_id: { eq: settingsId } }, limit: 10000 },
		allowance_catalog: { where: { settings_id: { eq: settingsId } }, limit: 10000 },
		overtime_catalog: { where: { settings_id: { eq: settingsId } }, limit: 10000 },
		statutory_contribution_catalog: {
			where: { settings_id: { eq: settingsId } },
			limit: 10000
		},
		leave_catalog: { where: { settings_id: { eq: settingsId } }, limit: 10000 },
		claim_catalog: { where: { settings_id: { eq: settingsId } }, limit: 10000 },
		adhoc_catalog: { where: { settings_id: { eq: settingsId } }, limit: 10000 },
		loan_catalog: { where: { settings_id: { eq: settingsId } }, limit: 10000 },
		shift_definition: { where: { entity_id: { eq: companyId } }, limit: 10000 },
		shift_pattern: { where: { entity_id: { eq: companyId } }, limit: 10000 },
		payroll_run: {
			where: { entity_id: { eq: companyId } },
			fields: ['attendance_coverage'],
			limit: 10000
		},
		holiday: { where: { entity_id: { eq: companyId } }, limit: 10000 },
		entity_profile_version: {
			where: { entity_id: { eq: companyId }, status: { eq: 'SEALED' } },
			limit: 10000
		},
		employee_contract: {
			where: { entity_id: { eq: companyId }, status: { eq: 'SEALED' } },
			limit: 10000
		}
	});

	const settings = (first.jurisdiction_settings ?? [])[0];
	if (settings === undefined || settings['status'] !== 'SEALED')
		return yield* Effect.fail(new Refusal({ message: 'The run needs a sealed jurisdiction.' }));
	const employer = (first.entity_profile_version ?? []).find((row) =>
		covers(row.effective_range, from, to)
	);
	if (employer === undefined)
		return yield* Effect.fail(
			new Refusal({ message: 'No employer version covers the salary period.' })
		);
	const covering = (first.employee_contract ?? []).filter((row) =>
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

	// what was entered after an earlier run closed is paid here, a cycle late
	const since = (first.payroll_run ?? []).reduce((low, row) => {
		const started = objectValue(row.attendance_coverage).from;
		return typeof started === 'string' && started < low ? started : low;
	}, start);
	const due = (row: JsonObject, date: unknown): boolean =>
		typeof date === 'string' &&
		date <= end &&
		(date >= start || (row.payroll_run_id == null && date >= since));
	const employeeIds = [...new Set(contracts.map((row) => String(row.employee_id)))];
	// every contract of the person answers for its entries by their dates, a run pays on the one in force
	const answering = (first.employee_contract ?? []).filter((row) =>
		employeeIds.includes(String(row.employee_id))
	);
	const second = yield* queryRows(read, {
		employee_profile: { where: { id: { in: employeeIds } }, limit: 10000 },
		employee_balance: {
			where: { employee_id: { in: employeeIds } },
			limit: 10000
		}
	});
	const profiles = new Map((second.employee_profile ?? []).map((row) => [String(row.id), row]));
	const balances = new Map(
		(second.employee_balance ?? []).map((row) => [String(row.employee_id), row])
	);

	const employmentIds = answering.map((row) => String(row.id));
	const balanceIds = [...balances.values()].map((row) => String(row.id));
	const third = yield* queryRows(read, {
		leave_catalog_entry: {
			where: { employment_id: { in: employmentIds } },
			limit: 10000
		},
		claim_catalog_entry: {
			where: { employment_id: { in: employmentIds } },
			limit: 10000
		},
		adhoc_catalog_entry: {
			where: { employment_id: { in: employmentIds } },
			limit: 10000
		},
		loan_catalog_entry: {
			where: { employment_id: { in: employmentIds } },
			limit: 10000
		},
		loan_repayment_entry: {
			where: { employment_id: { in: employmentIds } },
			limit: 10000
		},
		roster_entry: {
			where: { employment_id: { in: employmentIds }, work_date: { gte: since, lte: end } },
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
		ledger_entry: {
			where: {
				balance_id: { in: balanceIds },
				account: { eq: 'statutory_contribution' }
			},
			limit: 10000
		},
		payslip: {
			where: { employee_id: { in: employeeIds } },
			fields: [
				'payroll_run_id',
				'employee_id',
				'employment_id',
				'period',
				'gross_earnings',
				'ordinary_wages',
				'additional_wages',
				'employee_statutory',
				'employer_statutory',
				'tax_withheld',
				'breakdown'
			],
			limit: 10000
		}
	});

	const workRows = (third.roster_entry ?? []).filter((row) => due(row, row.work_date));
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
	const shifts = new Map((first.shift_definition ?? []).map((row) => [row.id, row]));
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
			holidays: first.holiday ?? [],
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
	const raisedElsewhere = (
		entries: readonly JsonObject[] = [],
		own: readonly JsonObject[] = []
	) => {
		const held = new Set(own.map((row) => String(row.id)));
		return [...new Set(entries.map((row) => String(row.catalog_id)))].filter((id) => !held.has(id));
	};
	const raised = yield* queryRows(read, {
		leave_catalog: {
			where: { id: { in: raisedElsewhere(third.leave_catalog_entry, first.leave_catalog) } },
			fields: ['id', 'code'],
			limit: 10000
		},
		claim_catalog: {
			where: { id: { in: raisedElsewhere(third.claim_catalog_entry, first.claim_catalog) } },
			fields: ['id', 'code'],
			limit: 10000
		},
		adhoc_catalog: {
			where: { id: { in: raisedElsewhere(third.adhoc_catalog_entry, first.adhoc_catalog) } },
			fields: ['id', 'code'],
			limit: 10000
		},
		loan_catalog: {
			where: { id: { in: raisedElsewhere(third.loan_catalog_entry, first.loan_catalog) } },
			fields: ['id', 'code'],
			limit: 10000
		}
	});
	const inRunVersion = (
		entries: readonly JsonObject[],
		own: readonly JsonObject[] = [],
		elsewhere: readonly JsonObject[] = []
	) => {
		const codes = new Map(elsewhere.map((row) => [String(row.id), row.code]));
		const current = new Map(own.map((row) => [row.code, row.id]));
		return entries.map((row) => {
			const id = current.get(codes.get(String(row.catalog_id)));
			return id === undefined ? row : { ...row, catalog_id: id };
		});
	};

	const patterns = new Map((first.shift_pattern ?? []).map((row) => [row.id, row]));
	const attendanceDays = eachDay(datePeriod(start, end)).map(String);
	const holidayDates = new Set((first.holiday ?? []).map((row) => String(row.date)));
	/** Working days a person's contracts project in the attendance period. */
	const projectedWorkDays = (rows: readonly JsonObject[]): number | undefined => {
		let count = 0;
		for (const date of attendanceDays) {
			const row = rows.find((contract) => covers(contract.effective_range, date, date));
			if (row === undefined) continue;
			const terms = objectValue(row.terms);
			const pattern = patterns.get(terms.shift_pattern_id);
			if (pattern === undefined) return undefined;
			const cycle = objectValue(pattern.pattern);
			const days = Array.isArray(cycle.days) ? cycle.days : [];
			if (days.length === 0) return undefined;
			const index = daysBetween(String(cycle.anchor_date), date);
			const slot = ((index % days.length) + days.length) % days.length;
			const shift = shifts.get(objectValue(days[slot]).shift_definition_id);
			if (shift === undefined) continue;
			if (objectValue(shift.variant).day_type === 'WORK' && !holidayDates.has(date)) count += 1;
		}
		return count;
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
			(rows ?? []).filter((row) => own.has(String(row.employment_id)));
		const projected = projectedWorkDays(answering.filter((row) => row.employee_id === employeeId));
		const history = statutoryHistory(
			(third.ledger_entry ?? []).filter((row) => row.balance_id === balance?.id)
		);
		const payslips = (third.payslip ?? []).filter(
			(row) => row.employee_id === employeeId && row.payroll_run_id !== String(run.id)
		);
		const result = yield* Effect.try({
			try: () =>
				calculatePayroll({
					run,
					settings,
					subtotals: first.subtotal ?? [],
					allowance: first.allowance_catalog ?? [],
					overtime: first.overtime_catalog ?? [],
					statutory: first.statutory_contribution_catalog ?? [],
					leave_catalog: first.leave_catalog ?? [],
					claim_catalog: first.claim_catalog ?? [],
					adhoc_catalog: first.adhoc_catalog ?? [],
					loan_catalog: first.loan_catalog ?? [],
					employee,
					employment: contract,
					employer,
					balance: balance ?? { account: {} },
					entries: {
						leave_catalog_entry: inRunVersion(
							leaveWithin(entries(third.leave_catalog_entry)),
							first.leave_catalog,
							raised.leave_catalog
						),
						claim_catalog_entry: inRunVersion(
							entries(third.claim_catalog_entry).filter((row) => due(row, row.incurred_on)),
							first.claim_catalog,
							raised.claim_catalog
						),
						adhoc_catalog_entry: inRunVersion(
							entries(third.adhoc_catalog_entry).filter((row) => due(row, row.incurred_on)),
							first.adhoc_catalog,
							raised.adhoc_catalog
						),
						loan_catalog_entry: inRunVersion(
							entries(third.loan_catalog_entry),
							first.loan_catalog,
							raised.loan_catalog
						),
						loan_repayment_entry: entries(third.loan_repayment_entry).filter((row) =>
							due(row, row.paid_on)
						)
					},
					history: { statutory: history, payslips },
					work: { days: [...own].flatMap((id) => workDays.get(id) ?? []) },
					...(projected === undefined ? {} : { projected_work_days: projected }),
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
			total_deductions: money(deductions),
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
