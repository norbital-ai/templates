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

import { Schema } from 'effect';
import type { WorkspaceRow } from '../../../lib/rows.js';
import type { WorkRules } from '../../../lib/datatypes/work_rules.js';
import type { ShiftPattern } from './configuration.js';
import { refuse } from '../../../lib/refuse.js';
import { readAll, type Reads } from '../../../lib/reads.js';
import { workPayItems } from '../../../lib/payroll/work-lines.js';
import {
	settlementBucket,
	type SettlementBucket,
	type SettlementDestination,
	type SettlementDirection,
	type FamilyPayItem
} from '../../../lib/payroll/family.js';
import { encashmentCode } from '../../../lib/leave/payroll.js';
import { daysBetween, requiredDateKey, addDays } from './dates.js';
import { effectiveOn, readRange } from './effective.js';
import type { ReportContribution, ReportLine, ReportPayslip } from './report.js';
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
import { decodeNumber } from '../../wire.js';
import { dateKey } from '../../iso-day.js';
import * as Predicate from 'effect/Predicate';
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

type BankAccount = {
	readonly account_name: string;
	readonly bank_code: string;
	readonly bank_name: string;
	readonly account_number: string;
};

type BankDestination = {
	readonly employmentId: string;
	readonly employeeNumber: string;
	readonly currency: string;
	readonly net: number;
	readonly bank: BankAccount;
};

type RunRow = {
	readonly id: string;
	readonly company_id: string;
	readonly settings_id: string;
	readonly period: string;
	readonly pay_date: string;
	readonly attendance_from: string;
	readonly attendance_to: string;
};
/** A row as read: the fields the export names, and whatever else the row carries. */
// ponytail: loose rows; typed per field where the export reads them, not a row type per collection.

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

/**
 * Every settled run of the export, loaded back out as the workbook, bank file and payslips read it. The reads run as
 * the starter (the automation's `runAs: 'trigger'`), in three waves: the runs' payslips and entities, then the
 * people, catalogues, terms and days they name, then the patterns and shifts those name.
 */
export async function loadRunExports(reads: Reads, runs: readonly RunRow[]): Promise<RunExport[]> {
	const runIds = runs.map((run) => run.id);
	if (runIds.length === 0) return [];
	const [companies, readPayslips] = await Promise.all([
		readAll<WorkspaceRow<'companies'>>(reads, 'companies', {
			id: { in: [...new Set(runs.map((run) => run.company_id))] }
		}),
		readAll<WorkspaceRow<'payslips'>>(reads, 'payslips', { payroll_run_id: { in: runIds } })
	]);
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

	const employmentIds = [...new Set(payslips.map((row) => String(row.employment_id)))];
	const attendanceFrom = runs
		.map((run) => requiredDateKey(run.attendance_from, 'payroll_runs.attendance_from'))
		.toSorted()[0]!;
	const attendanceTo = runs
		.map((run) => requiredDateKey(run.attendance_to, 'payroll_runs.attendance_to'))
		.toSorted()
		.at(-1)!;
	const shortfall = { employment_id: { in: employmentIds }, unfunded_contributions: { gt: 0 } };
	const settingsIds = [...new Set(runs.map((run) => run.settings_id))];
	const [
		shortfallSlips,
		shortfallRuns,
		employments,
		employees,
		settingsVersions,
		leaves,
		claims,
		adhoc,
		allowances,
		terms,
		workDays
	] = await Promise.all([
		readAll<WorkspaceRow<'payslips'>>(reads, 'payslips', shortfall),
		readAll<WorkspaceRow<'payroll_runs'>>(reads, 'payroll_runs', { payslips: { some: shortfall } }),
		readAll<WorkspaceRow<'employments'>>(reads, 'employments', { id: { in: employmentIds } }),
		readAll<WorkspaceRow<'employees'>>(reads, 'employees', {
			employments: { some: { id: { in: employmentIds } } }
		}),
		// The runs' catalogues: a settled payslip line names a component by code, and the code may
		// come from any family. Only the named settings versions can define those lines.
		readAll<Pick<WorkspaceRow<'jurisdiction_settings'>, 'id' | 'work_rules'>>(
			reads,
			'jurisdiction_settings',
			{ id: { in: settingsIds } },
			undefined,
			{ id: true, work_rules: true }
		),
		readAll<WorkspaceRow<'leave_catalogue'>>(reads, 'leave_catalogue', {
			settings_id: { in: settingsIds }
		}),
		readAll<WorkspaceRow<'claim_catalogue'>>(reads, 'claim_catalogue', {
			settings_id: { in: settingsIds }
		}),
		readAll<WorkspaceRow<'adhoc_catalogue'>>(reads, 'adhoc_catalogue', {
			settings_id: { in: settingsIds }
		}),
		readAll<WorkspaceRow<'allowance_catalogue'>>(reads, 'allowance_catalogue', {
			settings_id: { in: settingsIds }
		}),
		readAll<WorkspaceRow<'employment_terms'>>(reads, 'employment_terms', {
			employment_id: { in: employmentIds }
		}),
		// Plan and punch are one row, so the schedule this export reports and the hours it reports
		// come from the same query and cannot disagree about which days existed.
		readAll<WorkspaceRow<'work_days'>>(reads, 'work_days', {
			employment_id: { in: employmentIds },
			work_date: { gte: attendanceFrom, lte: attendanceTo }
		})
	]);
	const runOfSlip = new Map(shortfallRuns.map((row) => [row.id, row]));
	const shortfalls = shortfallSlips.map((row) => ({
		...row,
		payslip_payroll_run: runOfSlip.get(row.payroll_run_id) ?? null
	}));
	const shortfallsByEmployment = Map.groupBy(shortfalls, (row) => String(row.employment_id));

	// The named patterns the terms point at: the base of every employment is projected through them,
	// so a payslip's Normal Hours cannot be read without them. Only working days name a shift; the
	// codes a pattern projects are loaded beside the ones explicit roster rows name, or the schedule
	// this export reports would be the fraction of it somebody happened to override.
	const patternIds = [
		...new Set(terms.flatMap((row) => (row.shift_pattern_id == null ? [] : [row.shift_pattern_id])))
	];
	const patterns = await readAll<WorkspaceRow<'shift_patterns'>>(reads, 'shift_patterns', {
		id: { in: patternIds }
	});
	const patternById = new Map<string, ShiftPattern>(
		patterns.map((row) => [row.id, row as ShiftPattern])
	);
	const shiftIds = [
		...new Set([
			...workDays.map((row) => row.shift_definition_id).filter((id) => id != null),
			...terms.flatMap((row) => patternRosterCodeIds(termPattern(row, patternById)))
		])
	];
	const shifts = await readAll<WorkspaceRow<'shift_definitions'>>(reads, 'shift_definitions', {
		id: { in: shiftIds }
	});

	const employmentById = new Map(employments.map(resolveEmployment).map((row) => [row.id, row]));
	const employeeById = new Map(employees.map((row) => [row.id, row]));
	const termsByEmployment = Map.groupBy(terms, (row) => row.employment_id);
	const workDaysByEmployment = Map.groupBy(workDays, (row) => row.employment_id);
	const shiftById = new Map<string, (typeof shifts)[number]>(shifts.map((row) => [row.id, row]));
	const payslipsByRun = Map.groupBy(payslips, (row): string => row.payroll_run_id);

	return runs.map((run) => {
		const version = settingsVersions.find((row) => row.id === run.settings_id);
		const componentByCode = new Map<string, ExportLine>();
		if (version != null)
			for (const item of workPayItems({
				...(version.work_rules as WorkRules),
				settings_id: version.id
			}))
				componentByCode.set(item.code, {
					calculationSource: item.definition.source,
					bucket: settlementBucket(item.destination, item.direction),
					destination: item.destination,
					family: item.family
				});
		for (const row of leaves.filter((row) => row.settings_id === run.settings_id)) {
			// Leave carries no pricing and no landing: the engine prices both lines at the
			// ordinary day wage, so the export states the landing each line's bucket means.
			componentByCode.set(encashmentCode(row.code), {
				calculationSource: 'DERIVED',
				bucket: 'EARNING',
				destination: 'PAY',
				family: 'LEAVE'
			});
			if (row.is_npl || row.paid_by === 'FUND' || row.pay_fraction.trim() !== '')
				componentByCode.set(row.code, {
					calculationSource: 'DERIVED',
					bucket: 'ABSENCE',
					destination: 'PAY',
					family: 'LEAVE'
				});
		}
		// The money catalogues store flat columns; the export reads them through the same
		// `ENTRY` arm the run does.
		for (const [family, rows] of [
			['CLAIM', claims],
			['ADHOC', adhoc],
			['ALLOWANCE', allowances]
		] as const)
			for (const row of rows.filter((row) => row.settings_id === run.settings_id)) {
				// The enum columns arrive as text at the database boundary; the models constrain
				// them to the landing vocabulary.
				const destination = row.destination;
				const direction = row.direction;
				componentByCode.set(row.code, {
					calculationSource: 'ENTRY',
					bucket: settlementBucket(destination, direction),
					destination,
					family
				});
			}

		const runPayslips = payslipsByRun.get(run.id) ?? [];
		const runAttendanceFrom = requiredDateKey(run.attendance_from, 'payroll_runs.attendance_from');
		const runAttendanceTo = requiredDateKey(run.attendance_to, 'payroll_runs.attendance_to');
		const runPayDate = requiredDateKey(run.pay_date, 'payroll_runs.pay_date');
		const runDates = daysBetween(runAttendanceFrom, runAttendanceTo);
		const skipped: string[] = [];
		const bank: BankDestination[] = [];
		const report: ReportPayslip[] = runPayslips.map((payslip) => {
			const employment = employmentById.get(payslip.employment_id);
			const employeeNumber = employment?.employee_number ?? payslip.employment_id;
			const employee = employment == null ? null : employeeById.get(employment.employee_id);
			const range = readRange(employment?.effective_range);
			const hireDate =
				range == null ? null : requiredDateKey(range.start, 'employments.effective_range');
			const exitDate =
				range?.end == null ? null : requiredDateKey(range.end, 'employments.effective_range');
			const employmentTerms = termsByEmployment.get(payslip.employment_id) ?? [];
			const departure = employment?.exit_facts?.departure_on;
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
			if (payslip.net > 0 && account != null) {
				const outstanding = shortfallsByEmployment.get(payslip.employment_id)?.find((row) => {
					const earlier = row.payslip_payroll_run;
					if (earlier == null) refuse('A contribution shortfall is missing its payroll run.');
					return (
						earlier.company_id === run.company_id &&
						earlier.period < run.period &&
						(row.funding_received < row.unfunded_contributions ||
							!row.funding_reference?.trim() ||
							row.funding_received_on == null ||
							requiredDateKey(row.funding_received_on, 'payslips.funding_received_on') > runPayDate)
					);
				});
				if (outstanding != null)
					refuse(
						`${employeeNumber}: ${outstanding.payslip_payroll_run!.period} contribution funding must be reconciled by the payment date before exporting this bank payment.`
					);
			}
			if (payslip.net > 0 && account == null) skipped.push(payslip.employment_id);
			else if (payslip.net > 0 && account != null)
				bank.push({
					employmentId: payslip.employment_id,
					employeeNumber,
					currency: payslip.currency,
					net: payslip.net,
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
				// The wage's base line is the basic; an allowance on the contract is a base line
				// too, and the workbook files it under its own family.
				...payslip.base.flatMap((entry) =>
					reportLine(
						entry.component_code,
						entry.amount,
						null,
						componentByCode.get(entry.component_code)?.family === 'ALLOWANCE' ? 'ALLOWANCE' : 'BASE'
					)
				),
				...payslipAdjustments.flatMap((row): ReportLine[] =>
					reportLine(
						row.component_code,
						row.amount,
						row.quantity == null ? null : row.quantity,
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
			const contributionTotals = new Map<string, ReportContribution>();
			for (const charge of payslip.statutory) {
				// One entry per scheme, both shares on it, named by its code — so there is no second
				// row to pair with and no base to guard against double-counting. The listing the
				// version froze on the charge rides with it.
				contributionTotals.set(charge.scheme_code, {
					scheme_code: charge.scheme_code,
					label: charge.label ?? null,
					listing_order: charge.listing_order ?? null,
					listing_group: charge.listing_group ?? null,
					base: charge.base_amount,
					employee: charge.employee_amount,
					employer: charge.employer_amount
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
				hireDate: hireDate ?? '',
				lastDay: exitDate,
				person: {
					employeeId: employment?.employee_id ?? payslip.employment_id,
					dateOfBirth: dateKey(employee?.date_of_birth) || null,
					gender: employee?.gender ?? null,
					nationality: employee?.nationality ?? null,
					departureOn: Predicate.isString(departure) ? dateKey(departure) || null : null
				},
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
				gross: payslip.gross,
				totalDeductions: payslip.total_deductions,
				net: payslip.net,
				unfundedContributions: payslip.unfunded_contributions ?? 0,
				fundingReceived: payslip.funding_received ?? 0,
				employerCost: payslip.employer_cost,
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
}
