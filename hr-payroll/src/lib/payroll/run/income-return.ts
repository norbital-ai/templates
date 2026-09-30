/**
 * The employer's employment-income returns, read back from settled payslips: the year-end return
 * the version's `payroll.income_return` declares, for every employee, and its cessation return
 * instead for a leaver the tax-clearance rule holds.
 *
 * Nothing is recomputed. Each settled line lands on the item its class names (else the version's
 * earning or allowance default), each scheme charge on the deduction the version names, so the
 * return's income items always sum to the payslips' gross. The year is the one the income is due
 * for — the run's period — not the day it was paid.
 */

import { refuse } from '../../refuse.js';
import { cents } from './rounding.js';
import { monthDay, monthBounds, addDays, type IsoDate } from './dates.js';
import { decodeNumber } from '../../wire.js';
import type { IncomeReturnSettings, PayrollSettings } from '../../datatypes/payroll_settings.js';
import { readAll, type Reads } from '../../reads.js';
import type { WorkspaceRow } from '../../rows.js';
import { dateKey } from '../../iso-day.js';
import { loadRunExports } from './export-data.js';

/** What one settled payslip contributes to a return. */
export type ReturnSlip = {
	readonly employeeId: string;
	readonly employmentId: string;
	/** The run period (`YYYY-MM`, or a half/week of one): the month the income is due for. */
	readonly period: string;
	readonly payDate: IsoDate;
	readonly lines: readonly {
		readonly componentCode: string;
		readonly family: string;
		readonly bucket: string;
		readonly amount: number;
	}[];
	readonly charges: readonly {
		readonly scheme: string;
		readonly employee: number;
		readonly employer: number;
	}[];
};

/** The person and the employment a slip belongs to, as the payroll holds them. */
export type ReturnPerson = {
	readonly employeeId: string;
	readonly employmentId: string;
	readonly employeeNumber: string;
	readonly name: string;
	readonly identityNumber: string | null;
	readonly dateOfBirth: string | null;
	readonly gender: 'MALE' | 'FEMALE' | null;
	readonly nationality: string | null;
	readonly designation: string | null;
	readonly hireDate: IsoDate;
	readonly lastDay: IsoDate | null;
	/** The recorded departure from the country (exit fact `departure_on`), where known. */
	readonly departureOn: IsoDate | null;
};

/** The tax-clearance hold the engine raised on a leaver: its presence is the cessation decision. */
export type ClearanceHold = {
	readonly employmentId: string;
	readonly amount: number | null;
	readonly noWithholdingReason: string | null;
	readonly noticeReceivedOn: IsoDate | null;
};

export type Employer = { readonly taxReference: string; readonly name: string };
export type AuthorisedPerson = {
	readonly name: string;
	readonly designation: string;
	readonly contact: string;
	readonly date: IsoDate;
};
export type Submission = 'ORIGINAL' | 'AMENDMENT' | 'REVISION';

/** The declared items' amounts, keyed and ordered as the version declares them. */
export type ReturnAmounts = Readonly<Record<string, number>>;
/** The declared dates; a `BLANK` date, or one whose item was never paid, is null. */
export type ReturnDates = Readonly<Record<string, string | null>>;

export type ReturnIdentity = {
	readonly id_type: string;
	readonly id_number: string;
	readonly employee_number: string;
	readonly name: string;
	readonly date_of_birth: string | null;
	readonly sex: 'M' | 'F' | null;
	readonly nationality: string | null;
	readonly designation: string | null;
	readonly commencement_on: IsoDate | null;
	readonly cessation_on: IsoDate | null;
};

export type AnnualReturn = {
	readonly form: string;
	readonly basis_year: number;
	readonly submission: Submission;
	readonly employer: Employer;
	readonly authorised: AuthorisedPerson;
	readonly employee: ReturnIdentity;
	/** Amendment: only the changed amounts, as signed differences; every other amount blank. */
	readonly amounts: ReturnAmounts | Readonly<Record<string, number | null>>;
	readonly dates: ReturnDates;
};

export type CessationReturn = {
	readonly form: string;
	readonly submission: Submission;
	readonly employer: Employer;
	readonly authorised: AuthorisedPerson;
	readonly employee: ReturnIdentity;
	/** The declared months before the cessation. */
	readonly notice_due_on: IsoDate;
	readonly departure_on: IsoDate | null;
	readonly current_year: { readonly year: number; amounts: ReturnAmounts; dates: ReturnDates };
	readonly previous_year: {
		readonly year: number;
		amounts: ReturnAmounts;
		dates: ReturnDates;
	} | null;
	/** The moneys withheld, as the hold records them; null while it states none. */
	readonly withheld_amount: number | null;
	readonly no_withholding_reason: string | null;
	/** The day the authority received the notice, which starts the hold. */
	readonly notice_received_on: IsoDate | null;
	readonly release_by: IsoDate | null;
};

/** One year's amounts and dates for one employee, from that year's slips. */
export function returnAmounts(
	settings: IncomeReturnSettings,
	slips: readonly ReturnSlip[]
): { amounts: ReturnAmounts; dates: ReturnDates } {
	const sums = new Map<string, number>();
	const add = (key: string, amount: number) => sums.set(key, (sums.get(key) ?? 0) + amount);
	const deductions = new Set(settings.items.filter((row) => row.deduction).map((row) => row.key));
	const paidOn = new Map<string, IsoDate>();
	const paidMonths = new Map<string, Set<string>>();
	const fund = settings.split_fund;
	for (const slip of slips) {
		for (const line of slip.lines) {
			const named = settings.classes.find((row) => row.code === line.componentCode);
			const item =
				named == null
					? line.family === 'ALLOWANCE'
						? settings.default_allowance_item
						: settings.default_earning_item
					: (named.item ?? null);
			if (item == null) continue;
			if (deductions.has(item)) {
				if (line.bucket === 'DEDUCTION') add(item, line.amount);
				continue;
			}
			// An absence is a clawed-back earning: it reduces the item its class reports on.
			const sign = line.bucket === 'EARNING' ? 1 : line.bucket === 'ABSENCE' ? -1 : 0;
			if (sign === 0) continue;
			add(item, sign * line.amount);
			if (named?.remission === true) add(settings.remission_item!, sign * line.amount);
			const latest = paidOn.get(item);
			if (latest == null || slip.payDate > latest) paidOn.set(item, slip.payDate);
			paidMonths.set(item, (paidMonths.get(item) ?? new Set()).add(slip.period.slice(0, 7)));
		}
		for (const charge of slip.charges) {
			if (charge.scheme === settings.compulsory_scheme)
				add(settings.compulsory_item, charge.employee);
			if (settings.donation_schemes.includes(charge.scheme))
				add(settings.donation_item, charge.employee);
			if (fund != null && charge.scheme === fund.scheme && charge.employee !== 0) {
				const part =
					fund.allocation.find((row) => cents(row.total) === cents(charge.employee))?.part ??
					charge.employee;
				add(fund.part_item, part);
				add(fund.rest_item, charge.employee - part);
			}
		}
	}
	const at = (key: string) => cents(sums.get(key) ?? 0);
	const amounts = Object.fromEntries(
		settings.items
			.toSorted((a, b) => a.order - b.order)
			.map((row) => [
				row.key,
				row.sum_of == null ? at(row.key) : cents(row.sum_of.reduce((sum, key) => sum + at(key), 0))
			])
	);
	const dates = Object.fromEntries(
		settings.dates.map((row) => {
			const months = [...(paidMonths.get(row.item ?? '') ?? [])].toSorted();
			const first = months[0];
			const last = months.at(-1);
			const value =
				row.value === 'LATEST_PAY_DATE'
					? (paidOn.get(row.item ?? '') ?? null)
					: first == null || last == null || row.value === 'BLANK'
						? null
						: row.value === 'FIRST_MONTH'
							? `${first}-01`
							: row.value === 'LAST_MONTH'
								? monthBounds(last).end
								: // Paid every month of its span is monthly; gaps make it other than monthly.
									((months.length === monthsBetween(first, last) + 1 ? row.monthly : row.other) ??
									null);
			return [row.key, value];
		})
	);
	return { amounts, dates };
}

const year = (month: string) => decodeNumber(month.slice(0, 4));
/** The 1-based month of a `YYYY-MM` or a date. */
const month = (value: string) => decodeNumber(value.slice(5, 7));
const monthsBetween = (from: string, to: string) =>
	(year(to) - year(from)) * 12 + month(to) - month(from);

/**
 * The identification type, read from the number itself by the version's declared patterns. A
 * return cannot be filed on any other, so it is refused rather than guessed.
 */
function identity(
	settings: IncomeReturnSettings,
	person: ReturnPerson,
	year: number,
	people: readonly ReturnPerson[]
): ReturnIdentity {
	const number = person.identityNumber?.trim().toUpperCase() ?? '';
	const type =
		settings.identity_patterns.find((row) => new RegExp(row.pattern).test(number))?.type ??
		refuse(
			`${person.employeeNumber}: ${settings.form} identifies the employee by ${settings.identity_patterns.map((row) => row.type).join(' or ')}; record the identity number before filing.`
		);
	// The earliest commencement and the latest cessation in the year, and a commencement only when
	// it fell in the year or before the version's `commencement_before`.
	const starts = people.map((row) => row.hireDate).toSorted();
	const ends = people.map((row) => row.lastDay);
	const start = starts[0]!;
	const end = ends.includes(null) ? null : ends.toSorted().at(-1)!;
	const before = settings.commencement_before;
	return {
		id_type: type,
		id_number: number,
		employee_number: person.employeeNumber,
		name: person.name,
		date_of_birth: person.dateOfBirth,
		sex: person.gender === 'MALE' ? 'M' : person.gender === 'FEMALE' ? 'F' : null,
		nationality: person.nationality,
		designation: person.designation,
		commencement_on:
			start.startsWith(`${year}-`) || (before != null && start < before) ? start : null,
		cessation_on: end != null && end.startsWith(`${year}-`) ? end : null
	};
}

/** The difference an amendment submits: changed amounts signed, unchanged ones blank. */
export function amendmentOf(
	submitted: Readonly<Record<string, number>>,
	corrected: ReturnAmounts
): Record<string, number | null> {
	return Object.fromEntries(
		Object.entries(corrected).map(([key, value]) => {
			const difference = cents(value - (submitted[key] ?? 0));
			return [key, difference === 0 ? null : difference];
		})
	);
}

export type IncomeReturnInput = {
	readonly year: number;
	readonly settings: IncomeReturnSettings;
	readonly employer: Employer;
	readonly authorised: AuthorisedPerson;
	readonly submission: Submission;
	/** Amendment only: the amounts already submitted, per identity number. */
	readonly submitted?: ReadonlyMap<string, Readonly<Record<string, number>>>;
	/** This year's and the previous year's slips (the cessation return reports both). */
	readonly slips: readonly ReturnSlip[];
	readonly people: readonly ReturnPerson[];
	readonly holds: readonly ClearanceHold[];
	/** The most days the moneys may be held after the authority receives the notice. */
	readonly maxWithholdDays: number | null;
};

/**
 * The year's returns: an annual return per employee, and the cessation return instead for one
 * whose employment ceased in the year under a tax-clearance hold, where the version declares one.
 */
export function incomeReturns(input: IncomeReturnInput): {
	annual: AnnualReturn[];
	cessation: CessationReturn[];
} {
	const { settings } = input;
	const inYear = (slip: ReturnSlip, year: number) => slip.period.startsWith(`${year}-`);
	const cleared = new Map(input.holds.map((hold) => [hold.employmentId, hold]));
	const annual: AnnualReturn[] = [];
	const cessation: CessationReturn[] = [];
	for (const [employeeId, people] of Map.groupBy(input.people, (row) => row.employeeId)) {
		const slips = input.slips.filter((slip) => slip.employeeId === employeeId);
		const current = slips.filter((slip) => inYear(slip, input.year));
		if (current.length === 0) continue;
		const latest = people.toSorted((a, b) => (a.hireDate < b.hireDate ? 1 : -1))[0]!;
		const hold = cleared.get(latest.employmentId);
		const employee = identity(settings, latest, input.year, people);
		const { amounts, dates } = returnAmounts(settings, current);
		if (input.submission === 'REVISION' && Object.values(amounts).some((value) => value < 0))
			refuse(`${latest.employeeNumber}: a revision cannot carry a negative amount.`);
		const stated =
			input.submission === 'AMENDMENT'
				? amendmentOf(input.submitted?.get(employee.id_number) ?? {}, amounts)
				: amounts;
		const ceased = latest.lastDay;
		const notice = settings.cessation_return;
		if (notice != null && hold != null && ceased != null && ceased.startsWith(`${input.year}-`)) {
			const previous = slips.filter((slip) => inYear(slip, input.year - 1));
			const received = hold.noticeReceivedOn;
			cessation.push({
				form: notice.form,
				submission: input.submission,
				employer: input.employer,
				authorised: input.authorised,
				employee,
				notice_due_on: monthDay(
					year(ceased),
					month(ceased) - 1 - notice.due_months_before_cessation,
					decodeNumber(ceased.slice(8))
				),
				departure_on: latest.departureOn,
				current_year: { year: input.year, amounts, dates },
				previous_year:
					previous.length === 0
						? null
						: { year: input.year - 1, ...returnAmounts(settings, previous) },
				withheld_amount: hold.amount,
				no_withholding_reason: hold.noWithholdingReason,
				notice_received_on: received,
				release_by:
					received == null || input.maxWithholdDays == null
						? null
						: addDays(received, input.maxWithholdDays)
			});
			continue;
		}
		annual.push({
			form: settings.form,
			basis_year: input.year,
			submission: input.submission,
			employer: input.employer,
			authorised: input.authorised,
			employee,
			amounts: stated,
			dates
		});
	}
	return { annual, cessation };
}

type RunRow = Parameters<typeof loadRunExports>[1][number] & { readonly company_id: string };

/**
 * The returns an export of `runs` asks for: for each entity and year the runs name, every settled
 * run of that entity in the year and the one before (the cessation return reports both), read
 * back through `loadRunExports` so the returns and the workbook are the same records. An entity whose version
 * states no `income_return` files none.
 */
export async function loadIncomeReturns(
	reads: Reads,
	runs: readonly RunRow[],
	options: Pick<IncomeReturnInput, 'authorised' | 'submission' | 'submitted'>
): Promise<
	{ label: string; year: number; annual: AnnualReturn[]; cessation: CessationReturn[] }[]
> {
	const out = [];
	for (const [companyId, selected] of Map.groupBy(runs, (run) => run.company_id)) {
		const [company] = await readAll<WorkspaceRow<'companies'>>(reads, 'companies', {
			id: { in: [companyId] }
		});
		for (const year of new Set(selected.map((run) => decodeNumber(run.period.slice(0, 4))))) {
			const scope = await readAll<RunRow>(reads, 'payroll_runs', {
				company_id: { in: [companyId] },
				period: { gte: `${year - 1}-01`, lte: `${year}-12-9` }
			});
			const last = scope
				.filter((run) => run.period.startsWith(`${year}-`))
				.toSorted((a, b) => (a.period < b.period ? 1 : -1))[0];
			if (last == null) continue;
			const [version] = await readAll<
				Pick<WorkspaceRow<'jurisdiction_settings'>, 'id' | 'payroll'>
			>(reads, 'jurisdiction_settings', { id: { in: [last.settings_id] } }, undefined, {
				id: true,
				payroll: true
			});
			const payroll = version?.payroll as PayrollSettings | undefined;
			const settings = payroll?.income_return;
			if (settings == null) continue;
			const held = await readAll<WorkspaceRow<'payslips'>>(reads, 'payslips', {
				payroll_run_id: { in: scope.map((run) => run.id) },
				status: { eq: 'ON_HOLD' }
			});
			// A held slip may still be re-priced: a return filed without it would need an amendment.
			if (held.length > 0)
				refuse(
					`${held.length} payslip(s) of ${year - 1}–${year} are on hold; settle or release them before building the ${year} returns.`
				);
			const exports = await loadRunExports(reads, scope);
			const slips: ReturnSlip[] = [];
			const people = new Map<string, ReturnPerson>();
			for (const run of exports.toSorted((a, b) => (a.period < b.period ? -1 : 1)))
				for (const payslip of run.payslips) {
					slips.push({
						employeeId: payslip.person.employeeId,
						employmentId: payslip.employmentId,
						period: run.period,
						payDate: run.payDate,
						lines: payslip.lines,
						charges: [...payslip.contributions.values()].map((charge) => ({
							scheme: charge.scheme_code,
							employee: charge.employee,
							employer: charge.employer
						}))
					});
					// The latest slip's terms name the designation the year ended on.
					people.set(payslip.employmentId, {
						employeeId: payslip.person.employeeId,
						employmentId: payslip.employmentId,
						employeeNumber: payslip.employeeNumber,
						name: payslip.employeeName,
						identityNumber: payslip.identityNumber,
						dateOfBirth: payslip.person.dateOfBirth,
						gender: payslip.person.gender,
						nationality: payslip.person.nationality,
						designation: payslip.designation,
						hireDate: payslip.hireDate,
						lastDay: payslip.lastDay,
						departureOn: payslip.person.departureOn
					});
				}
			const holds = await readAll<WorkspaceRow<'payment_holds'>>(reads, 'payment_holds', {
				employment_id: { in: [...people.keys()] },
				category: { eq: 'TAX_CLEARANCE' }
			});
			const reference = company?.registration_number?.trim() ?? '';
			if (reference === '')
				refuse(
					`${company?.name ?? companyId}: ${settings.form} names the employer's tax reference; record the entity's registration number first.`
				);
			const returns = incomeReturns({
				year,
				settings,
				employer: { taxReference: reference, name: company!.name },
				...options,
				slips,
				people: [...people.values()],
				holds: holds.map((hold) => ({
					employmentId: hold.employment_id,
					amount: hold.amount == null ? null : decodeNumber(hold.amount),
					noWithholdingReason: hold.no_withholding_reason ?? null,
					noticeReceivedOn: dateKey(hold.authority_notice_received_on) || null
				})),
				maxWithholdDays: payroll?.tax_clearance?.max_withhold_days ?? null
			});
			out.push({ label: `${company!.name} ${year}`, year, ...returns });
		}
	}
	return out;
}
