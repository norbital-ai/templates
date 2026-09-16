import { resolveEmployment } from '../../../lib/employment-contract.js';
import { addDays } from '../../../lib/period.js';
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
import { workPayItems } from '../../../lib/payroll/work-lines.js';
import {
	settlementBucket,
	type SettlementBucket,
	type SettlementDestination,
	type SettlementDirection,
	type FamilyPayItem
} from '../../../lib/payroll/family.js';
import { encashmentCode } from '../../../lib/leave/payroll.js';
import { PAGE_LIMIT, withReadLog } from './api.js';
import { daysBetween, requiredDateKey } from './dates.js';
import { effectiveOn } from './effective.js';
import type { ReportLine, ReportPayslip } from './report.js';
import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';
import {
	patternAnchor,
	patternRosterCodeId,
	patternRosterCodeIds,
	termPattern,
	termPatternRow
} from '../../../lib/scheduling/work-pattern.js';
import { normalizedWorkedIntervals, type WorkDayLike } from './overtime.js';
import { derivedBreakMinutes } from '../../../lib/scheduling/rest-break.js';
import type { WorkspaceRow } from '../$types.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { payerAccountSchema, type PayerAccount } from './bank-formats.js';

type RunExport = {
	readonly runId: string;
	readonly period: string;
	readonly payDate: string;
	/** The entity's named workbook layout, carried so the export never infers one from a currency. */
	readonly layout: 'MATRIX' | 'VENDOR';
	/** The account the entity pays from, when it has one; `null` keeps the generic listing. */
	readonly payer: PayerAccount | null;
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

/** What a settled line's catalogue says about it, reduced to the workbook's questions. */
type ExportLine = {
	readonly calculationSource: string;
	readonly bucket: SettlementBucket;
	readonly destination: SettlementDestination;
	readonly family: FamilyPayItem['family'];
};

function timestampHours(
	row: Omit<WorkDayLike, 'break_minutes'>,
	grantedBreakMinutes: number
): number {
	const clocked = {
		...row,
		break_minutes: derivedBreakMinutes(row.worked_intervals, grantedBreakMinutes)
	};
	const elapsed = normalizedWorkedIntervals(clocked).reduce(
		(total, interval) => total + (interval.end - interval.start) / 3_600_000,
		0
	);
	return Math.max(0, elapsed - clocked.break_minutes / 60);
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
			columns: { id: true, workbook_layout: true, disbursement_account: true },
			limit: PAGE_LIMIT
		});
		readApi.reads.assertComplete(companies, 'export entities');
		/** The named layout of each run's entity; an entity that states none takes the matrix. */
		const layoutOf = (run: RunRow): 'MATRIX' | 'VENDOR' =>
			companies.find((row) => row.id === run.company_id)?.workbook_layout === 'VENDOR'
				? 'VENDOR'
				: 'MATRIX';
		/** The entity's originator account, decoded; a malformed one is no account, not a crash. */
		const payerOf = (run: RunRow): PayerAccount | null => {
			const decoded = Schema.decodeUnknownOption(payerAccountSchema)(
				companies.find((row) => row.id === run.company_id)?.disbursement_account
			);
			return decoded._tag === 'Some' ? decoded.value : null;
		};

		const readPayslips = yield* readApi.db.payslips.findMany({
			where: { payroll_run_id: { in: runIds } },
			limit: PAGE_LIMIT
		});
		readApi.reads.assertComplete(readPayslips, 'payslips');
		// A held slip is deliberately out of the bank file and the workbook: its money has not been
		// paid and its row may still be re-priced. Draft and paid slips are what an export is for.
		const payslips = readPayslips.filter((row) => row.status !== 'ON_HOLD');
		if (payslips.length === 0)
			return runs.map((run) => ({
				runId: run.id,
				period: run.period,
				payDate: requiredDateKey(run.pay_date, 'payroll_runs.pay_date'),
				layout: layoutOf(run),
				payer: payerOf(run),
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
		const [employments, settingsVersions, leaves, claims, allowances, payments, terms, workDays] =
			yield* Effect.all(
				[
					api.db.employments.findMany({
						where: { id: { in: employmentIds } },
						limit: PAGE_LIMIT
					}),
					// Every catalogue: a settled payslip line names a component by code, and the code may come
					// from any of them. Merged here for the same reason the run merges them — the export asks
					// what a line *is*, never which table declared it.
					api.db.jurisdiction_settings.findMany({ limit: PAGE_LIMIT }),
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
							work_date: { gte: attendanceFrom, lt: addDays(attendanceTo, 1) }
						},
						limit: PAGE_LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
		for (const [name, rows] of Object.entries({
			settingsVersions,
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
			const version = settingsVersions.find((row) => row.id === run.settings_id);
			const componentByCode = new Map<string, ExportLine>();
			if (version != null)
				for (const item of workPayItems({ ...version.work_rules, settings_id: version.id }))
					componentByCode.set(item.code, {
						calculationSource: item.definition.source,
						bucket: settlementBucket(item.destination, item.direction),
						destination: item.destination,
						family: item.family
					});
			for (const row of leaves.filter((row) => row.settings_id === run.settings_id)) {
				const destination = row.destination as SettlementDestination;
				componentByCode.set(encashmentCode(row.code), {
					calculationSource: 'DERIVED',
					bucket: 'EARNING',
					destination,
					family: 'LEAVE'
				});
				if (!row.paid)
					componentByCode.set(row.code, {
						calculationSource: 'DERIVED',
						bucket: 'ABSENCE',
						destination,
						family: 'LEAVE'
					});
			}
			// The money catalogues store flat columns; the export reads them through the same
			// `ENTRY` arm the run does.
			for (const [family, rows] of [
				['CLAIM', claims],
				['ALLOWANCE', allowances],
				['PAYMENT', payments]
			] as const)
				for (const row of rows.filter((row) => row.settings_id === run.settings_id)) {
					// The enum columns arrive as text at the database boundary; the models constrain
					// them to the landing vocabulary.
					const destination = row.destination as SettlementDestination;
					const direction = row.direction as SettlementDirection | null;
					componentByCode.set(row.code, {
						calculationSource: 'ENTRY',
						bucket: settlementBucket(destination, direction),
						destination,
						family
					});
				}

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
					employment?.effective_range == null
						? null
						: requiredDateKey(employment.effective_range.start, 'employments.effective_range');
				const exitDate =
					employment?.effective_range?.end == null
						? null
						: requiredDateKey(employment.effective_range.end, 'employments.effective_range');
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
						return shift == null ? [] : [{ date, code: shift.code, shift }];
					}
					// The pattern is the baseline only while the employment runs. Nobody is scheduled
					// before they joined or after they left, and on those days there is no explicit row
					// to say so.
					if ((hireDate != null && date < hireDate) || (exitDate != null && date > exitDate))
						return [];
					const dayTerms = effectiveOn(employmentTerms, date);
					const patternRow = dayTerms == null ? null : termPatternRow(dayTerms, patternById);
					const codeId = patternRosterCodeId(
						patternRow?.pattern ?? null,
						date,
						patternAnchor(patternRow)
					);
					const shift = codeId == null ? null : shiftById.get(codeId);
					return shift == null ? [] : [{ date, code: shift.code, shift }];
				});
				const grantedBreakByDate = new Map(
					scheduled.map((day) => [day.date, workWindow(day.shift.variant)?.break_minutes ?? 0])
				);
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
					quantity: number | null,
					family: string,
					bucket?: SettlementBucket
				): ReportLine[] => {
					const line = componentByCode.get(componentCode);
					return [
						{
							componentCode: componentCode,
							componentName: componentCode,
							family,
							// An adjustment states the bucket it settled in; a base line reads its
							// catalogue's, and a code the run no longer carries is informational.
							bucket: bucket ?? line?.bucket ?? 'INFORMATION',
							calculationSource: line?.calculationSource ?? 'DERIVED',
							amount,
							quantity,
							isCompanyDirect: line?.destination === 'EMPLOYER',
							// A claim is the claim catalogue's own line, whatever its bands cap it at.
							isClaim: line?.family === 'CLAIM',
							isLoanInstalment: false
						}
					];
				};
				const reportLines: ReportLine[] = [
					...payslip.base.flatMap((entry) =>
						reportLine(entry.component_code, decodeNumber(entry.amount), null, 'BASE')
					),
					...payslipAdjustments.flatMap((row): ReportLine[] =>
						reportLine(
							row.component_code,
							decodeNumber(row.amount),
							row.quantity == null ? null : decodeNumber(row.quantity),
							row.family,
							row.bucket
						).map((line) => ({
							...line,
							label: row.label,
							// Recovery of a loan repayment is the one adjustment a workbook reports
							// separately, and the input family is what says so.
							isLoanInstalment: row.family === 'LOAN_REPAYMENT'
						}))
					)
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
						employment?.effective_range == null
							? ''
							: requiredDateKey(employment.effective_range.start, 'employments.effective_range'),
					lastDay:
						employment?.effective_range?.end == null
							? null
							: requiredDateKey(employment.effective_range.end, 'employments.effective_range'),
					attendance: {
						normalHours: scheduled.reduce(
							(total, day) =>
								rosterCodeKind(day.shift.variant) === 'WORK'
									? total + workWindow(day.shift.variant)!.paid_minutes / 60
									: total,
							0
						),
						actualHours: runTimes.reduce(
							(total, row) =>
								total +
								timestampHours(
									row,
									grantedBreakByDate.get(requiredDateKey(row.work_date, 'work_days.work_date')) ?? 0
								),
							0
						),
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
				payer: payerOf(run),
				payslips: report,
				bank,
				skippedEmploymentIds: skipped
			};
		});
	});
}
