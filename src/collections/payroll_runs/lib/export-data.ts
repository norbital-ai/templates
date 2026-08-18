/**
 * Loading a settled run back out for export.
 *
 * The workbook, the bank file and the payslips are all views of the same four collections. This
 * assembles that view once, so the three artefacts never disagree with each other.
 */

import { Effect } from 'effect';
import type { PayrollReadApi } from './api.js';
import { PAGE_LIMIT, assertComplete, groupBy } from './api.js';
import { requiredDateKey } from './dates.js';
import { coversDate } from './effective.js';
import type { ReportLine, ReportPayslip } from './report.js';
import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';
import { normalizedWorkedIntervals, overtimeBandCode } from './overtime.js';

export type RunExport = {
	readonly runId: string;
	readonly period: string;
	readonly payDate: string;
	readonly payslips: readonly ReportPayslip[];
	readonly bank: readonly BankDestination[];
	/** Employments whose payslip has no bank destination and is therefore not in the bank file. */
	readonly skippedEmploymentIds: readonly string[];
};

export type BankDestination = {
	readonly employmentId: string;
	readonly employeeNumber: string;
	readonly currency: string;
	readonly net: number;
	readonly bank: {
		readonly account_name: string;
		readonly bank_code: string;
		readonly bank_name: string;
		readonly account_number: string;
	};
};

type RunRow = {
	readonly norbital_id: string;
	readonly period: string;
	readonly pay_date: string | Date;
	readonly attendance_from: string | Date;
	readonly attendance_to: string | Date;
};

function timestampHours(row: {
	readonly norbital_id: string;
	readonly work_date: string | Date;
	readonly worked_intervals:
		| readonly {
				readonly start_at: string | Date;
				readonly end_at: string | Date | null;
		  }[]
		| null;
	readonly break_minutes: number;
}): number {
	const elapsed = normalizedWorkedIntervals(row).reduce(
		(total, interval) => total + (interval.end - interval.start) / 3_600_000,
		0
	);
	return Math.max(0, elapsed - Math.max(0, Number(row.break_minutes)) / 60);
}

export function loadRunExports(
	api: PayrollReadApi,
	runs: readonly RunRow[]
): Effect.Effect<RunExport[], never, never> {
	return Effect.gen(function* () {
		const runIds = runs.map((run) => run.norbital_id);
		if (runIds.length === 0) return [];

		const payslips = yield* api.db.query.payslips.findMany({
			where: { payroll_run_id: { in: runIds } },
			limit: PAGE_LIMIT
		});
		assertComplete(payslips, 'payslips');
		if (payslips.length === 0)
			return runs.map((run) => ({
				runId: run.norbital_id,
				period: run.period,
				payDate: requiredDateKey(run.pay_date, 'payroll_runs.pay_date'),
				payslips: [],
				bank: [],
				skippedEmploymentIds: []
			}));

		const payslipIds = payslips.map((row) => row.norbital_id);
		const employmentIds = [...new Set(payslips.map((row) => row.employment_id))];
		const attendanceFrom = runs
			.map((run) => requiredDateKey(run.attendance_from, 'payroll_runs.attendance_from'))
			.toSorted()[0]!;
		const attendanceTo = runs
			.map((run) => requiredDateKey(run.attendance_to, 'payroll_runs.attendance_to'))
			.toSorted()
			.at(-1)!;
		const [lines, employments, payComponents, terms, timeEntries, rosters] = yield* Effect.all(
			[
				api.db.query.payslip_lines.findMany({
					where: { payslip_id: { in: payslipIds } },
					limit: PAGE_LIMIT
				}),
				api.db.query.employments.findMany({
					where: { norbital_id: { in: employmentIds } },
					limit: PAGE_LIMIT
				}),
				api.db.query.pay_components.findMany({ limit: PAGE_LIMIT }),
				api.db.query.employment_terms.findMany({
					where: { employment_id: { in: employmentIds } },
					limit: PAGE_LIMIT
				}),
				api.db.query.time_entries.findMany({
					where: {
						employment_id: { in: employmentIds },
						work_date: { gte: attendanceFrom, lte: attendanceTo }
					},
					limit: PAGE_LIMIT
				}),
				api.db.query.roster_entries.findMany({
					where: {
						employment_id: { in: employmentIds },
						work_date: { gte: attendanceFrom, lte: attendanceTo }
					},
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		assertComplete(lines, 'payslip lines');
		assertComplete(terms, 'employment terms');
		assertComplete(timeEntries, 'time entries');
		assertComplete(rosters, 'roster entries');

		const employeeIds = [...new Set(employments.map((row) => row.employee_id))];
		// Only working days name a shift; rest and off days schedule none.
		const shiftIds = [
			...new Set(rosters.map((row) => row.shift_definition_id).filter((id) => id != null))
		];
		const [employees, shifts] = yield* Effect.all(
			[
				api.db.query.employees.findMany({
					where: { norbital_id: { in: employeeIds } },
					limit: PAGE_LIMIT
				}),
				shiftIds.length
					? api.db.query.shift_definitions.findMany({
							where: { norbital_id: { in: shiftIds } },
							limit: PAGE_LIMIT
						})
					: Effect.succeed([])
			],
			{ concurrency: 'unbounded' }
		);
		assertComplete(employees, 'employees');
		assertComplete(shifts, 'shift definitions');

		const contributionIds = [
			...new Set(
				lines.flatMap((line) =>
					line.statutory_contribution_id == null ? [] : [line.statutory_contribution_id]
				)
			)
		];
		const contributions = contributionIds.length
			? yield* api.db.query.statutory_contributions.findMany({
					where: { norbital_id: { in: contributionIds } },
					limit: PAGE_LIMIT
				})
			: [];

		const componentById = new Map(payComponents.map((row) => [row.norbital_id, row]));
		const employmentById = new Map(employments.map((row) => [row.norbital_id, row]));
		const employeeById = new Map(employees.map((row) => [row.norbital_id, row]));
		const termsByEmployment = groupBy(terms, (row) => row.employment_id);
		const timeByEmployment = groupBy(timeEntries, (row) => row.employment_id);
		const rosterByEmployment = groupBy(rosters, (row) => row.employment_id);
		const shiftById = new Map(shifts.map((row) => [row.norbital_id, row]));
		const contributionCodeById = new Map(contributions.map((row) => [row.norbital_id, row.code]));
		const linesByPayslip = groupBy(lines, (row) => row.payslip_id);
		const payslipsByRun = groupBy(payslips, (row) => row.payroll_run_id);

		return runs.map((run) => {
			const runPayslips = payslipsByRun.get(run.norbital_id) ?? [];
			const runAttendanceFrom = requiredDateKey(
				run.attendance_from,
				'payroll_runs.attendance_from'
			);
			const runAttendanceTo = requiredDateKey(run.attendance_to, 'payroll_runs.attendance_to');
			const runPayDate = requiredDateKey(run.pay_date, 'payroll_runs.pay_date');
			const skipped: string[] = [];
			const bank: BankDestination[] = [];
			const report: ReportPayslip[] = runPayslips.map((payslip) => {
				const employment = employmentById.get(payslip.employment_id);
				const employeeNumber = employment?.employee_number ?? payslip.employment_id;
				const employee = employment == null ? null : employeeById.get(employment.employee_id);
				const activeTerms = (termsByEmployment.get(payslip.employment_id) ?? []).find((row) =>
					coversDate(row.effective_range, runPayDate)
				);
				const runRosters = (rosterByEmployment.get(payslip.employment_id) ?? []).filter(
					(row) => row.work_date >= runAttendanceFrom && row.work_date <= runAttendanceTo
				);
				const runTimes = (timeByEmployment.get(payslip.employment_id) ?? []).filter(
					(row) => row.work_date >= runAttendanceFrom && row.work_date <= runAttendanceTo
				);
				const account = employment?.bank;
				if (account == null) skipped.push(payslip.employment_id);
				else
					bank.push({
						employmentId: payslip.employment_id,
						employeeNumber,
						currency: payslip.currency,
						net: Number(payslip.net),
						bank: {
							account_name: account.bank_account_name,
							bank_code: account.bank_code,
							bank_name: account.bank_name,
							account_number: account.bank_account_number
						}
					});
				const settledLines = linesByPayslip.get(payslip.norbital_id) ?? [];
				const reportLines: ReportLine[] = settledLines
					.toSorted((left, right) => Number(left.sequence) - Number(right.sequence))
					.flatMap((line): ReportLine[] => {
						const kind = line.component?.kind;
						// A derived overtime line links to no pay component, because there is none: it
						// names the statutory band that priced it, and that band supplies its code, its
						// day type and the fact that it is an earning.
						if (kind === 'OVERTIME' || kind === 'OVERTIME_EXCESS') {
							const excess = kind === 'OVERTIME_EXCESS';
							const code = overtimeBandCode({
								excess,
								dayType: line.component.day_type,
								measure: line.component.measure,
								bandFrom: Number(line.component.band_from)
							});
							return [
								{
									payComponentCode: code,
									payComponentName: code,
									nature: 'EARNING',
									calculationSource: kind,
									amount: Number(line.amount),
									quantity: line.quantity == null ? null : Number(line.quantity),
									isCompanyDirect: false,
									isClaim: false,
									isLoanInstalment: false,
									overtimeDayType: line.component.day_type,
									isOvertimeExcess: excess
								}
							];
						}
						if (line.pay_component_id == null) return [];
						const payComponent = componentById.get(line.pay_component_id);
						const definition = payComponent?.definition ?? null;
						return [
							{
								payComponentCode: payComponent?.code ?? 'UNKNOWN',
								payComponentName: payComponent?.code ?? 'Unknown component',
								nature: payComponent?.nature ?? 'INFORMATION',
								calculationSource: definition?.source ?? 'DERIVED',
								amount: Number(line.amount),
								quantity: line.quantity == null ? null : Number(line.quantity),
								isCompanyDirect:
									definition?.source === 'ENTRY' && definition.settlement === 'COMPANY_DIRECT',
								isClaim: definition?.source === 'ENTRY' && definition.cap != null,
								isLoanInstalment: kind === 'LOAN_INSTALMENT',
								overtimeDayType: null,
								isOvertimeExcess: false
							}
						];
					});
				const contributionTotals = new Map<
					string,
					{ base: number; employee: number; employer: number }
				>();
				for (const line of settledLines) {
					if (line.statutory_contribution_id == null) continue;
					const code = contributionCodeById.get(line.statutory_contribution_id);
					if (code == null) continue;
					const component = line.component;
					if (component == null) continue;
					if (component.kind !== 'STATUTORY_EMPLOYEE' && component.kind !== 'STATUTORY_EMPLOYER')
						continue;
					const current = contributionTotals.get(code) ?? { base: 0, employee: 0, employer: 0 };
					contributionTotals.set(code, {
						base: Math.max(current.base, Number(component.base_amount)),
						employee:
							current.employee +
							(component.kind === 'STATUTORY_EMPLOYEE' ? Number(line.amount) : 0),
						employer:
							current.employer + (component.kind === 'STATUTORY_EMPLOYER' ? Number(line.amount) : 0)
					});
				}
				return {
					employmentId: payslip.employment_id,
					employeeNumber,
					currency: payslip.currency,
					designation: activeTerms?.job_title ?? null,
					section: activeTerms?.department ?? null,
					group: activeTerms?.payroll_group ?? null,
					employeeName: employee?.name ?? employeeNumber,
					identityNumber: employee?.identity_number ?? null,
					hireDate:
						employment == null
							? ''
							: requiredDateKey(employment.hire_date, 'employments.hire_date'),
					lastDay:
						employment?.exit_date == null
							? null
							: requiredDateKey(employment.exit_date, 'employments.exit_date'),
					attendance: {
						normalHours: runRosters.reduce((total, roster) => {
							const shift = shiftById.get(roster.shift_definition_id);
							if (shift == null || rosterCodeKind(shift.variant) !== 'WORK') return total;
							return total + workWindow(shift.variant)!.paid_minutes / 60;
						}, 0),
						actualHours: runTimes.reduce((total, row) => total + timestampHours(row), 0),
						shiftCodes: [
							...new Set(
								runRosters.flatMap((row) => {
									if (row.assignment_code != null) return [row.assignment_code];
									const shift = shiftById.get(row.shift_definition_id);
									return shift == null ? [] : [shift.code];
								})
							)
						].toSorted()
					},
					gross: Number(payslip.gross),
					totalDeductions: Number(payslip.total_deductions),
					net: Number(payslip.net),
					employerCost: Number(payslip.employer_cost),
					lines: reportLines,
					contributions: contributionTotals
				};
			});
			return {
				runId: run.norbital_id,
				period: run.period,
				payDate: runPayDate,
				payslips: report,
				bank,
				skippedEmploymentIds: skipped
			};
		});
	});
}
