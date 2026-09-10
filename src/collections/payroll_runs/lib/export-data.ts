import { resolveEmployment } from '../../../lib/employment-contract.js';
/**
 * Loading a settled run back out for export.
 *
 * The workbook, the bank file and the payslips are all views of the same records. This assembles
 * that view once, so the three artefacts never disagree with each other.
 *
 * Everything the run settled is read back from where it was stored and never recomputed: the
 * contracted amounts and the statutory charges are inlined on the payslip, and everything one input
 * caused is an entry of `payslips.adjustments`. Rows whose amount is zero are settlement claims rather than
 * figures — the run read the source and priced it at nothing — so they carry no component and
 * contribute no workbook line.
 */

import { Effect, Schema } from 'effect';
import type { PayrollReadApi } from './api.js';
import { workPayItems } from '../../work_catalogue/pay-items.js';
import {
	LEAVE_ABSENCE_SEQUENCE,
	LEAVE_ENCASHMENT_SEQUENCE,
	encashmentCode
} from '../../../lib/leave/pay-items.js';
import { PAGE_LIMIT, withReadLog } from './api.js';
import { daysBetween, requiredDateKey } from './dates.js';
import { effectiveOn } from './effective.js';
import type { ReportLine, ReportPayslip } from './report.js';
import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';
import {
	patternRosterCodeId,
	patternRosterCodeIds,
	termPattern
} from '../../../lib/scheduling/work-pattern.js';
import { normalizedWorkedIntervals, type WorkDayLike } from './overtime.js';
import type { WorkspaceRow } from '../$types.js';
import { decodeNumber } from '@norbital-ai/std/json';

type RunExport = {
	readonly runId: string;
	readonly period: string;
	readonly payDate: string;
	/** The entity's named workbook layout, carried so the export never infers one from a currency. */
	readonly layout: 'MATRIX' | 'VENDOR';
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
	'id' | 'company_id' | 'settings_id' | 'period' | 'pay_date' | 'attendance_from' | 'attendance_to'
>;

function timestampHours(row: WorkDayLike): number {
	const elapsed = normalizedWorkedIntervals(row).reduce(
		(total, interval) => total + (interval.end - interval.start) / 3_600_000,
		0
	);
	return Math.max(0, elapsed - Math.max(0, decodeNumber(row.break_minutes)) / 60);
}

/**
 * The statutory day type a rule key names.
 *
 * The key spells the band as `OT_[EXCESS_]<day type>_<measure>_<from>` — the same shape
 * `overtimeBandCode` writes — so the day type is the key's own words rather than a decode of a
 * band blob. Two of the three day types are themselves two words long (`REST_DAY`,
 * `PUBLIC_HOLIDAY`), so the match is prefix-based longest-first, not a split on `_`; an unknown
 * key still names itself in the workbook column.
 */
const RULE_KEY_DAY_TYPES = ['REST_DAY', 'PUBLIC_HOLIDAY', 'SPECIAL_HOLIDAY', 'ORDINARY'] as const;

function overtimeRuleKeyDayType(ruleKey: string): (typeof RULE_KEY_DAY_TYPES)[number] | null {
	const withoutPrefix = ruleKey.replace('OT_', '').replace('EXCESS_', '');
	return (
		RULE_KEY_DAY_TYPES.find(
			(dayType) => withoutPrefix.startsWith(`${dayType}_`) || withoutPrefix === dayType
		) ?? null
	);
}

/** Whether a rule key names the excess above the statutory ceiling. */
function overtimeRuleKeyIsExcess(ruleKey: string): boolean {
	return ruleKey.includes('_EXCESS_');
}

/** Every roster code a pattern can project, so the shift definitions behind one can be loaded. */
export function loadRunExports(
	api: PayrollReadApi,
	runs: readonly RunRow[]
): Effect.Effect<RunExport[], never, never> {
	return Effect.gen(function* () {
		const readApi = withReadLog(api);
		const runIds = runs.map((run) => run.id);
		if (runIds.length === 0) return [];

		const companies = yield* readApi.db.companies.findMany({
			where: { id: { in: [...new Set(runs.map((run) => run.company_id))] } },
			columns: { id: true, workbook_layout: true },
			limit: PAGE_LIMIT
		});
		readApi.reads.assertComplete(companies, 'export entities');
		/** The named layout of each run's entity; an entity that states none takes the matrix. */
		const layoutOf = (run: RunRow): 'MATRIX' | 'VENDOR' =>
			companies.find((row) => row.id === run.company_id)?.workbook_layout === 'VENDOR'
				? 'VENDOR'
				: 'MATRIX';

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
				layout: layoutOf(run),
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
		const [employments, workCatalogues, leaves, claims, allowances, payments, terms, workDays] =
			yield* Effect.all(
				[
					api.db.employments.findMany({
						where: { id: { in: employmentIds } },
						limit: PAGE_LIMIT
					}),
					// Every catalogue: a settled payslip line names a component by code, and the code may come
					// from any of them. Merged here for the same reason the run merges them — the export asks
					// what a line *is*, never which table declared it.
					api.db.work_catalogue.findMany({ limit: PAGE_LIMIT }),
					api.db.leave_catalogue.findMany({ limit: PAGE_LIMIT }),
					api.db.claim_catalogue.findMany({ limit: PAGE_LIMIT }),
					api.db.allowance_catalogue.findMany({ limit: PAGE_LIMIT }),
					api.db.payment_catalogue.findMany({ limit: PAGE_LIMIT }),
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
		for (const [name, rows] of Object.entries({
			workCatalogues,
			leaves,
			claims,
			allowances,
			payments
		}))
			readApi.reads.assertComplete<unknown>(rows, name);
		readApi.reads.assertComplete(terms, 'employment terms');
		readApi.reads.assertComplete(workDays, 'work days');

		// The named patterns the terms point at, read once for every run in the export. The base of
		// every employment is projected through them, so a payslip's Normal Hours cannot be read
		// without them.
		const patternIds = [
			...new Set(
				terms.flatMap((row) => (row.shift_pattern_id == null ? [] : [row.shift_pattern_id]))
			)
		];
		const patterns =
			patternIds.length === 0
				? []
				: yield* api.db.shift_patterns.findMany({
						where: { id: { in: patternIds } },
						limit: PAGE_LIMIT
					});
		readApi.reads.assertComplete(patterns, 'shift patterns');
		const patternById = new Map(patterns.map((row) => [row.id, row]));

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
				...terms.flatMap((row) => patternRosterCodeIds(termPattern(row, patternById)))
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

		const employmentById = new Map(employments.map(resolveEmployment).map((row) => [row.id, row]));
		const employeeById = new Map(employees.map((row) => [row.id, row]));
		const termsByEmployment = Map.groupBy(terms, (row) => row.employment_id);
		const workDaysByEmployment = Map.groupBy(workDays, (row) => row.employment_id);
		const shiftById = new Map(shifts.map((row) => [row.id, row]));
		const payslipsByRun = Map.groupBy(payslips, (row) => row.payroll_run_id);

		return runs.map((run) => {
			const componentByCode = new Map(
				[
					...workCatalogues
						.filter((row) => row.settings_id === run.settings_id)
						.flatMap(workPayItems),
					...leaves
						.filter((row) => row.settings_id === run.settings_id)
						.flatMap((row) => [
							{
								code: encashmentCode(row.code),
								nature: 'EARNING',
								sequence: LEAVE_ENCASHMENT_SEQUENCE,
								settlement: 'PAYROLL' as const,
								definition: null
							},
							...(!row.paid
								? [
										{
											code: row.code,
											nature: 'ABSENCE',
											sequence: LEAVE_ABSENCE_SEQUENCE,
											settlement: 'PAYROLL' as const,
											definition: null
										}
									]
								: [])
						]),
					// The money catalogues store flat columns; the export reads them through the same
					// `ENTRY` arm the run does.
					...[...claims, ...allowances, ...payments]
						.filter((row) => row.settings_id === run.settings_id)
						.map((row) => ({ ...row, definition: { source: 'ENTRY' as const, cap: row.cap } }))
				].map((row) => [row.code, row])
			);

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
					const codeId =
						dayTerms == null ? null : patternRosterCodeId(termPattern(dayTerms, patternById), date);
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
						net: decodeNumber(payslip.net),
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
				// Settlement order is the array's order.
				const payslipAdjustments = payslip.adjustments;
				const reportLine = (
					componentCode: string,
					amount: number,
					quantity: number | null
				): ReportLine[] => {
					const catalogueComponent = componentByCode.get(componentCode);
					const definition = catalogueComponent?.definition ?? null;
					return [
						{
							componentCode: componentCode,
							componentName: componentCode,
							nature: catalogueComponent?.nature ?? 'INFORMATION',
							// The catalogue's order is the column order. A code the run's catalogue no
							// longer carries sorts last rather than jumping to the front.
							sequence:
								catalogueComponent?.sequence == null
									? Number.MAX_SAFE_INTEGER
									: decodeNumber(catalogueComponent.sequence),
							calculationSource: definition?.source ?? 'DERIVED',
							amount,
							quantity,
							isCompanyDirect: catalogueComponent?.settlement === 'COMPANY_DIRECT',
							isClaim: definition?.source === 'ENTRY' && definition.cap != null,
							isLoanInstalment: false,
							overtimeDayType: null,
							isOvertimeExcess: false
						}
					];
				};
				const reportLines: ReportLine[] = [
					...payslip.base.flatMap((entry) =>
						reportLine(entry.component_code, decodeNumber(entry.amount), null)
					),
					...payslipAdjustments.flatMap((row): ReportLine[] => {
						const ruleKey = row.statutory_rule_key;
						// A derived overtime row is settled under the Work catalogue's `OVERTIME` or
						// `OVERTIME_EXCESS` component, which `component_code` carries like every other
						// row — the workbook groups by the catalogue, so the column has to be the
						// catalogue's. The rule key is provenance beside it, and the workbook still
						// reads it for the day type and the excess flag: it spells the band as
						// `OT_[EXCESS_]<day type>_<measure>_<from>`, the shape `overtimeBandCode`
						// writes, so neither fact has to decode a band blob.
						const lines = reportLine(
							row.component_code,
							decodeNumber(row.amount),
							row.quantity == null ? null : decodeNumber(row.quantity)
						);
						if (ruleKey != null)
							return lines.map((line) => ({
								...line,
								nature: 'EARNING',
								calculationSource: overtimeRuleKeyIsExcess(ruleKey)
									? 'OVERTIME_EXCESS'
									: 'OVERTIME',
								overtimeDayType: overtimeRuleKeyDayType(ruleKey),
								isOvertimeExcess: overtimeRuleKeyIsExcess(ruleKey)
							}));
						return lines.map((line) => ({
							...line,
							// Recovery of a loan repayment is the one adjustment a workbook reports
							// separately, and the input family is what says so.
							isLoanInstalment: row.family === 'LOAN_REPAYMENT'
						}));
					})
				];
				const contributionTotals = new Map<
					string,
					{ base: number; employee: number; employer: number }
				>();
				for (const charge of payslip.statutory) {
					// One entry per scheme, both shares on it, named by its code — so there is no second
					// row to pair with and no base to guard against double-counting.
					contributionTotals.set(charge.scheme_code, {
						base: decodeNumber(charge.base_amount),
						employee: decodeNumber(charge.employee_amount),
						employer: decodeNumber(charge.employer_amount)
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
					gross: decodeNumber(payslip.gross),
					totalDeductions: decodeNumber(payslip.total_deductions),
					net: decodeNumber(payslip.net),
					employerCost: decodeNumber(payslip.employer_cost),
					lines: reportLines,
					contributions: contributionTotals
				};
			});
			return {
				runId: run.id,
				period: run.period,
				payDate: runPayDate,
				layout: layoutOf(run),
				payslips: report,
				bank,
				skippedEmploymentIds: skipped
			};
		});
	});
}
