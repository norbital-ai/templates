/**
 * Loading a settled run back out for export.
 *
 * The workbook, the bank file and the payslips are all views of the same records. This assembles
 * that view once, so the three artefacts never disagree with each other.
 *
 * Everything the run settled is read back from where it was stored and never recomputed: the
 * contracted amounts and the statutory charges are inlined on the payslip, and everything one input
 * caused is a `payslip_adjustments` row. Rows whose amount is zero are settlement claims rather than
 * figures — the run read the source and priced it at nothing — so they carry no pay component and
 * contribute no workbook line.
 */

import { Effect, Schema } from 'effect';
import type { PayrollReadApi } from './api.js';
import { PAGE_LIMIT, groupBy, withReadLog } from './api.js';
import { daysBetween, requiredDateKey } from './dates.js';
import { effectiveOn } from './effective.js';
import type { ReportLine, ReportPayslip } from './report.js';
import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';
import { patternRosterCodeId } from '../../../lib/scheduling/work-pattern.js';
import type { WorkPattern } from '../../../datatypes/work_pattern/+definition.js';
import { normalizedWorkedIntervals, overtimeBandCode, type WorkDayLike } from './overtime.js';
import type { WorkspaceRow } from '../$types.js';

type RunExport = {
	readonly runId: string;
	readonly period: string;
	readonly payDate: string;
	readonly payslips: readonly ReportPayslip[];
	readonly bank: readonly BankDestination[];
	/** Employments whose payslip has no bank destination and is therefore not in the bank file. */
	readonly skippedEmploymentIds: readonly string[];
};

const BankAccountSchema = Schema.Struct({
	account_name: Schema.String,
	bank_code: Schema.String,
	bank_name: Schema.String,
	account_number: Schema.String
});
const BankDestinationSchema = Schema.Struct({
	employmentId: Schema.String,
	employeeNumber: Schema.String,
	currency: Schema.String,
	net: Schema.Number,
	bank: BankAccountSchema
});
type BankDestination = Schema.Schema.Type<typeof BankDestinationSchema>;

type RunRow = Pick<
	WorkspaceRow<'payroll_runs'>,
	'id' | 'period' | 'pay_date' | 'attendance_from' | 'attendance_to'
>;

function timestampHours(row: WorkDayLike): number {
	const elapsed = normalizedWorkedIntervals(row).reduce(
		(total, interval) => total + (interval.end - interval.start) / 3_600_000,
		0
	);
	return Math.max(0, elapsed - Math.max(0, Number(row.break_minutes)) / 60);
}

/** Every roster code a pattern can project, so the shift definitions behind one can be loaded. */
function patternRosterCodeIds(pattern: WorkPattern): readonly string[] {
	return pattern.type === 'ROSTERED'
		? []
		: pattern.phases.flatMap((phase) => phase.day_cycle.map((day) => day.roster_code_id));
}

export function loadRunExports(
	api: PayrollReadApi,
	runs: readonly RunRow[]
): Effect.Effect<RunExport[], never, never> {
	return Effect.gen(function* () {
		const readApi = withReadLog(api);
		const runIds = runs.map((run) => run.id);
		if (runIds.length === 0) return [];

		const payslips = yield* readApi.db.payslips.findMany({
			where: { payroll_run_id: { in: runIds } },
			limit: PAGE_LIMIT
		});
		readApi.reads.assertComplete(payslips, 'payslips');
		if (payslips.length === 0)
			return runs.map((run) => ({
				runId: run.id,
				period: run.period,
				payDate: requiredDateKey(run.pay_date, 'payroll_runs.pay_date'),
				payslips: [],
				bank: [],
				skippedEmploymentIds: []
			}));

		const payslipIds = payslips.map((row) => row.id);
		const employmentIds = [...new Set(payslips.map((row) => row.employment_id))];
		const attendanceFrom = runs
			.map((run) => requiredDateKey(run.attendance_from, 'payroll_runs.attendance_from'))
			.toSorted()[0]!;
		const attendanceTo = runs
			.map((run) => requiredDateKey(run.attendance_to, 'payroll_runs.attendance_to'))
			.toSorted()
			.at(-1)!;
		const [adjustments, employments, payComponents, terms, workDays] = yield* Effect.all(
			[
				api.db.payslip_adjustments.findMany({
					where: { payslip_id: { in: payslipIds } },
					// The obligation's own arm, hydrated through the reference rather than fetched by a
					// second query: the workbook reports loan recovery in its own column, and
					// `terms = SCHEDULED` is the whole of what makes an adjustment one.
					with: { source: { OBLIGATION: { columns: { terms: true } } } },
					limit: PAGE_LIMIT
				}),
				api.db.employments.findMany({
					where: { id: { in: employmentIds } },
					limit: PAGE_LIMIT
				}),
				api.db.pay_components.findMany({ limit: PAGE_LIMIT }),
				api.db.employment_terms.findMany({
					where: { employment_id: { in: employmentIds } },
					limit: PAGE_LIMIT
				}),
				// One read where there were two. Plan and punch are one row, so the schedule this
				// export reports and the hours it reports come from the same query and cannot disagree
				// about which days existed.
				api.db.work_days.findMany({
					where: {
						employment_id: { in: employmentIds },
						work_date: { gte: attendanceFrom, lte: attendanceTo }
					},
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		readApi.reads.assertComplete(adjustments, 'payslip adjustments');
		readApi.reads.assertComplete(terms, 'employment terms');
		readApi.reads.assertComplete(workDays, 'work days');

		const employeeIds = [...new Set(employments.map((row) => row.employee_id))];
		// Only working days name a shift; rest and off days schedule none.
		//
		// The codes a work pattern projects are loaded alongside the ones explicit roster rows name.
		// A PATTERNED employment is scheduled by its pattern and only carries an explicit row where
		// the month departs from it, so loading the rostered ids alone would leave the schedule this
		// export reports as the fraction of it somebody happened to override.
		const shiftIds = [
			...new Set([
				...workDays.map((row) => row.shift_definition_id).filter((id) => id != null),
				...terms.flatMap((row) => patternRosterCodeIds(row.work_pattern))
			])
		];
		const [employees, shifts] = yield* Effect.all(
			[
				api.db.employees.findMany({
					where: { id: { in: employeeIds } },
					limit: PAGE_LIMIT
				}),
				shiftIds.length
					? api.db.shift_definitions.findMany({
							where: { id: { in: shiftIds } },
							limit: PAGE_LIMIT
						})
					: Effect.succeed([])
			],
			{ concurrency: 'unbounded' }
		);
		readApi.reads.assertComplete(employees, 'employees');
		readApi.reads.assertComplete(shifts, 'shift definitions');

		// The schemes charged are on the payslips themselves now, one entry per scheme with both
		// shares on it, so the ids come out of the rows already in hand rather than out of a join.
		const contributionIds = [
			...new Set(
				payslips.flatMap((payslip) =>
					payslip.statutory.map((charge) => charge.statutory_contribution_id)
				)
			)
		];
		const contributions = contributionIds.length
			? yield* api.db.statutory_contributions.findMany({
					where: { id: { in: contributionIds } },
					limit: PAGE_LIMIT
				})
			: [];

		const componentById = new Map(payComponents.map((row) => [row.id, row]));
		const employmentById = new Map(employments.map((row) => [row.id, row]));
		const employeeById = new Map(employees.map((row) => [row.id, row]));
		const termsByEmployment = groupBy(terms, (row) => row.employment_id);
		const workDaysByEmployment = groupBy(workDays, (row) => row.employment_id);
		const shiftById = new Map(shifts.map((row) => [row.id, row]));
		const contributionCodeById = new Map(contributions.map((row) => [row.id, row.code]));
		const adjustmentsByPayslip = groupBy(adjustments, (row) => row.payslip_id);
		const payslipsByRun = groupBy(payslips, (row) => row.payroll_run_id);

		return runs.map((run) => {
			const runPayslips = payslipsByRun.get(run.id) ?? [];
			const runAttendanceFrom = requiredDateKey(
				run.attendance_from,
				'payroll_runs.attendance_from'
			);
			const runAttendanceTo = requiredDateKey(run.attendance_to, 'payroll_runs.attendance_to');
			const runPayDate = requiredDateKey(run.pay_date, 'payroll_runs.pay_date');
			const runDates = daysBetween(runAttendanceFrom, runAttendanceTo);
			const skipped: string[] = [];
			const bank: BankDestination[] = [];
			const report: ReportPayslip[] = runPayslips.map((payslip) => {
				const employment = employmentById.get(payslip.employment_id);
				const employeeNumber = employment?.employee_number ?? payslip.employment_id;
				const employee = employment == null ? null : employeeById.get(employment.employee_id);
				const hireDate =
					employment == null
						? null
						: requiredDateKey(employment.hire_date, 'employments.hire_date');
				const exitDate =
					employment?.exit_date == null
						? null
						: requiredDateKey(employment.exit_date, 'employments.exit_date');
				const employmentTerms = termsByEmployment.get(payslip.employment_id) ?? [];
				// A leaver's terms end on their last day, and their wages arrive after it. Reading the
				// terms at the pay date therefore found nothing for exactly the people whose final
				// payslip is checked hardest, and their designation, department and payroll group came
				// out blank. The terms in force are the ones covering the last day they were employed.
				const termsAsOf = exitDate != null && exitDate < runPayDate ? exitDate : runPayDate;
				const activeTerms = effectiveOn(employmentTerms, termsAsOf);
				const employmentDays = workDaysByEmployment.get(payslip.employment_id) ?? [];
				const plannedByDate = new Map(
					employmentDays.map((row) => [requiredDateKey(row.work_date, 'work_days.work_date'), row])
				);
				const runTimes = employmentDays.filter(
					(row) =>
						row.worked_intervals != null &&
						row.work_date >= runAttendanceFrom &&
						row.work_date <= runAttendanceTo
				);
				/**
				 * The schedule the run priced, day by day, on the same rule the engine resolves it by:
				 * an explicit roster row wins, and every other day falls back to the code the
				 * employment's work pattern projects for it (`schedule.ts`, `resolveSchedule`).
				 *
				 * Reading the roster rows alone was right while every person-day carried one. It stopped
				 * being right when most employments moved to PATTERNED: the pattern supplies the
				 * schedule and a roster row is only written where a month departs from it, so a
				 * roster-only reading reported the hours nobody overrode as no hours at all — a
				 * Normal Hours column of zero beside an Actual Hours column of a full month.
				 */
				const scheduled = runDates.flatMap((date) => {
					const explicit = plannedByDate.get(date);
					if (explicit?.shift_definition_id != null) {
						const shift = shiftById.get(explicit.shift_definition_id);
						return shift == null ? [] : [{ code: explicit.assignment_code ?? shift.code, shift }];
					}
					// The pattern is the baseline only while the employment runs. Nobody is scheduled
					// before they joined or after they left, and on those days there is no explicit row
					// to say so.
					if ((hireDate != null && date < hireDate) || (exitDate != null && date > exitDate))
						return [];
					const dayTerms = effectiveOn(employmentTerms, date);
					const codeId = dayTerms == null ? null : patternRosterCodeId(dayTerms.work_pattern, date);
					const shift = codeId == null ? null : shiftById.get(codeId);
					return shift == null ? [] : [{ code: shift.code, shift }];
				});
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
				/**
				 * The report's line list, assembled from the two planes the payslip stores.
				 *
				 * The contracted amounts come first, in the catalogue's own order, then everything one
				 * input caused in the order the run settled it. Proration is not a line: it is the
				 * working behind a base amount, and a workbook column that summed it would count the
				 * wage twice.
				 */
				const payslipAdjustments = (adjustmentsByPayslip.get(payslip.id) ?? []).toSorted(
					(left, right) => Number(left.sequence) - Number(right.sequence)
				);
				const reportLine = (
					payComponentId: string | null,
					amount: number,
					quantity: number | null
				): ReportLine[] => {
					if (payComponentId == null) return [];
					const payComponent = componentById.get(payComponentId);
					const definition = payComponent?.definition ?? null;
					return [
						{
							payComponentCode: payComponent?.code ?? 'UNKNOWN',
							payComponentName: payComponent?.code ?? 'Unknown component',
							nature: payComponent?.nature ?? 'INFORMATION',
							calculationSource: definition?.source ?? 'DERIVED',
							amount,
							quantity,
							isCompanyDirect:
								definition?.source === 'ENTRY' && definition.settlement === 'COMPANY_DIRECT',
							isClaim: definition?.source === 'ENTRY' && definition.cap != null,
							isLoanInstalment: false,
							overtimeDayType: null,
							isOvertimeExcess: false
						}
					];
				};
				const reportLines: ReportLine[] = [
					...payslip.base.flatMap((entry) =>
						reportLine(entry.pay_component_id, Number(entry.amount), null)
					),
					...payslipAdjustments.flatMap((row): ReportLine[] => {
						const band = row.overtime_band;
						// A derived overtime row links to no pay component, because there is none: it
						// names the statutory band that priced it, and that band supplies its code, its
						// day type and the fact that it is an earning.
						if (band != null) {
							const code = overtimeBandCode({
								excess: band.excess,
								dayType: band.day_type,
								measure: band.measure,
								bandFrom: Number(band.band_from)
							});
							return [
								{
									payComponentCode: code,
									payComponentName: code,
									nature: 'EARNING',
									calculationSource: band.excess ? 'OVERTIME_EXCESS' : 'OVERTIME',
									amount: Number(row.amount),
									quantity: row.quantity == null ? null : Number(row.quantity),
									isCompanyDirect: false,
									isClaim: false,
									isLoanInstalment: false,
									overtimeDayType: band.day_type,
									isOvertimeExcess: band.excess
								}
							];
						}
						// A settlement-lock row priced its source at nothing and names no component; it
						// is a claim, not a figure, and a workbook has no column for it.
						return reportLine(
							row.pay_component_id,
							Number(row.amount),
							row.quantity == null ? null : Number(row.quantity)
						).map((line) => ({
							...line,
							// Recovery of a SCHEDULED obligation is the one adjustment a workbook reports
							// separately, and the obligation's arm is what says so.
							isLoanInstalment:
								row.source.kind === 'OBLIGATION' && row.source.record?.terms === 'SCHEDULED'
						}));
					})
				];
				const contributionTotals = new Map<
					string,
					{ base: number; employee: number; employer: number }
				>();
				for (const charge of payslip.statutory) {
					const code = contributionCodeById.get(charge.statutory_contribution_id);
					if (code == null) continue;
					// One entry per scheme, both shares on it, so there is no second row to pair with
					// and no base to guard against double-counting.
					contributionTotals.set(code, {
						base: Number(charge.base_amount),
						employee: Number(charge.employee_amount),
						employer: Number(charge.employer_amount)
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
						normalHours: scheduled.reduce(
							(total, day) =>
								rosterCodeKind(day.shift.variant) === 'WORK'
									? total + workWindow(day.shift.variant)!.paid_minutes / 60
									: total,
							0
						),
						actualHours: runTimes.reduce((total, row) => total + timestampHours(row), 0),
						shiftCodes: [...new Set(scheduled.map((day) => day.code))].toSorted()
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
				runId: run.id,
				period: run.period,
				payDate: runPayDate,
				payslips: report,
				bank,
				skippedEmploymentIds: skipped
			};
		});
	});
}
