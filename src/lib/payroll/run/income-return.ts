/**
 * The employer's employment-income returns, read back from settled payslips: the year-end return
 * (SG Form IR8A under ITA 1947 s.68(2), filed through AIS by 1 March) for every employee, and the
 * cessation notice (SG Form IR21 under s.68(5)–(7)) for a leaver the tax-clearance rule holds.
 *
 * Nothing is recomputed. Each settled line lands on the return item its version's
 * `payroll.income_return.items` names (else base, work and leave pay is item a and an allowance
 * item d1), each scheme charge on the deduction the version names, so the return's income items
 * always sum to the payslips' gross. The year is the one the income is due for — the run's
 * period — not the day it was paid (IRAS Explanatory Notes YA 2027 para 9(a): "the amount due for
 * the year … regardless of whether it was paid in the year").
 */

import { refuse } from '../../refuse.js';
import { cents } from './rounding.js';
import { monthDay, monthBounds, addDays, type IsoDate } from './dates.js';
import { decodeNumber } from '../../wire.js';
import type {
	IncomeReturnItem,
	IncomeReturnSettings,
	PayrollSettings
} from '../../datatypes/payroll_settings.js';
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
	/** The recorded departure from Singapore (exit fact `departure_on`), where known. */
	readonly departureOn: IsoDate | null;
};

/** The tax-clearance hold the engine raised on a leaver: its presence is the IR21 decision. */
export type ClearanceHold = {
	readonly employmentId: string;
	readonly amount: number | null;
	readonly noWithholdingReason: string | null;
	readonly irasNoticeReceivedOn: IsoDate | null;
};

export type Employer = { readonly taxReference: string; readonly name: string };
export type AuthorisedPerson = {
	readonly name: string;
	readonly designation: string;
	readonly contact: string;
	readonly date: IsoDate;
};
export type Submission = 'ORIGINAL' | 'AMENDMENT' | 'REVISION';

/** Form IR8A's income and deduction items, in the form's order. Money is the entity's currency. */
export type ReturnAmounts = {
	readonly a_gross_salary: number;
	readonly b_bonus_contractual: number;
	readonly b_bonus_non_contractual: number;
	readonly c_director_fees: number;
	readonly d1_allowances: number;
	readonly d2_commission: number;
	readonly d3_lump_sum: number;
	/** Not taxable and outside the d total (IRAS notes, d3 and TOTAL (items d1 to d8)). */
	readonly d3_compensation_for_loss_of_office: number;
	readonly d4_pension: number;
	readonly d5_overseas_pension_fund: number;
	readonly d6_excess_voluntary_cpf: number;
	readonly d7_gains_s10_1_b: number;
	readonly d7_gains_s10_1_g: number;
	readonly d8_benefits_in_kind: number;
	readonly d_total: number;
	readonly e1_remission: number;
	readonly deduction_cpf_employee: number;
	readonly deduction_donations: number;
	readonly deduction_mosque_building_fund: number;
	readonly deduction_life_insurance: number;
};

export type ReturnDates = {
	/** Latest pay date of a run that settled a non-contractual bonus: the day it was declared. */
	readonly b_bonus_declared_on: IsoDate | null;
	readonly c_director_fees_approved_on: IsoDate | null;
	readonly d2_commission_from: IsoDate | null;
	readonly d2_commission_to: IsoDate | null;
	/** AIS: M monthly, O other than monthly, B both. */
	readonly d2_commission_type: 'M' | 'O' | 'B' | null;
	/** No overseas posting, remission or tax-borne arrangement is held by the payroll: blank. */
	readonly e1_overseas_posting: null;
	readonly f_tax_borne: null;
	readonly f_i_income_tax_borne: null;
	readonly f_ii_fixed_tax_borne_by_employee: null;
};

export type ReturnIdentity = {
	readonly id_type: 'NRIC' | 'FIN';
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

export type Ir8aRecord = {
	readonly form: 'IR8A';
	readonly basis_year: number;
	readonly submission: Submission;
	readonly employer: Employer;
	readonly authorised: AuthorisedPerson;
	readonly employee: ReturnIdentity;
	/** Amendment: only the changed amounts, as signed differences; every other amount blank. */
	readonly amounts: ReturnAmounts | Partial<Record<keyof ReturnAmounts, number | null>>;
	readonly dates: ReturnDates;
};

export type Ir21Record = {
	readonly form: 'IR21';
	readonly submission: Submission;
	readonly employer: Employer;
	readonly authorised: AuthorisedPerson;
	readonly employee: ReturnIdentity;
	/** s.68(5): notice not later than one month before the cessation. */
	readonly notice_due_on: IsoDate;
	readonly departure_on: IsoDate | null;
	readonly current_year: { readonly year: number; amounts: ReturnAmounts; dates: ReturnDates };
	readonly previous_year: {
		readonly year: number;
		amounts: ReturnAmounts;
		dates: ReturnDates;
	} | null;
	/** s.68(7): the moneys withheld, as the hold records them; null while it states none. */
	readonly withheld_amount: number | null;
	readonly no_withholding_reason: string | null;
	/** The day IRAS received the notice, which starts the hold (s.68(7), EA s.24(2)). */
	readonly iras_notice_received_on: IsoDate | null;
	readonly release_by: IsoDate | null;
};

const INCOME_ITEMS: Partial<Record<IncomeReturnItem, keyof ReturnAmounts>> = {
	A_SALARY: 'a_gross_salary',
	B_CONTRACTUAL_BONUS: 'b_bonus_contractual',
	B_NON_CONTRACTUAL_BONUS: 'b_bonus_non_contractual',
	C_DIRECTOR_FEES: 'c_director_fees',
	D1_ALLOWANCE: 'd1_allowances',
	D1_OCLA: 'd1_allowances',
	D2_COMMISSION: 'd2_commission',
	D3_LUMP_SUM: 'd3_lump_sum',
	COMPENSATION_FOR_LOSS_OF_OFFICE: 'd3_compensation_for_loss_of_office',
	D4_PENSION: 'd4_pension',
	D5_OVERSEAS_PENSION_FUND: 'd5_overseas_pension_fund',
	D7_GAINS_S10_1_B: 'd7_gains_s10_1_b',
	D7_GAINS_S10_1_G: 'd7_gains_s10_1_g',
	D8_BENEFITS_IN_KIND: 'd8_benefits_in_kind'
};
const DEDUCTION_ITEMS: Partial<Record<IncomeReturnItem, keyof ReturnAmounts>> = {
	DONATION: 'deduction_donations',
	LIFE_INSURANCE: 'deduction_life_insurance'
};

/** The item a settled earning lands on: the version's mapping, else salary or allowance by family. */
function itemOf(
	settings: IncomeReturnSettings,
	line: ReturnSlip['lines'][number]
): IncomeReturnItem {
	return (
		settings.items.find((row) => row.code === line.componentCode)?.item ??
		(line.family === 'ALLOWANCE' ? 'D1_ALLOWANCE' : 'A_SALARY')
	);
}

/**
 * An MBMF charge's Mosque Building Fund part: the MUIS allocation of the Schedule total it matches
 * (Table 1, wages from 1 June 2016). A notified amount that is no Schedule total is reported whole
 * as Mosque Building Fund (Owner rule 2026-09-28): IR8A (III) reports "only contributions made to
 * Mosque Building Fund", no allocation of a notified amount is published, and claiming none of it
 * as a donation never states a relief the record cannot evidence (ITA s.95).
 */
function mosquePart(settings: IncomeReturnSettings, amount: number): number {
	const allocation = settings.mosque_fund?.allocation.find(
		(row) => cents(row.total) === cents(amount)
	);
	return allocation == null ? amount : allocation.mosque;
}

/** One year's amounts and dates for one employee, from that year's slips. */
export function returnAmounts(
	settings: IncomeReturnSettings,
	slips: readonly ReturnSlip[]
): { amounts: ReturnAmounts; dates: ReturnDates } {
	const sums = new Map<keyof ReturnAmounts, number>();
	const add = (key: keyof ReturnAmounts, amount: number) =>
		sums.set(key, (sums.get(key) ?? 0) + amount);
	let declared: IsoDate | null = null;
	let approved: IsoDate | null = null;
	const commissionMonths = new Set<string>();
	for (const slip of slips) {
		for (const line of slip.lines) {
			const item = itemOf(settings, line);
			// An absence is a clawed-back earning: it reduces the item its class reports on.
			const sign = line.bucket === 'EARNING' ? 1 : line.bucket === 'ABSENCE' ? -1 : 0;
			const income = INCOME_ITEMS[item];
			if (sign !== 0 && income != null) {
				add(income, sign * line.amount);
				if (item === 'D1_OCLA') add('e1_remission', sign * line.amount);
				if (item === 'B_NON_CONTRACTUAL_BONUS' && (declared == null || slip.payDate > declared))
					declared = slip.payDate;
				if (item === 'C_DIRECTOR_FEES' && (approved == null || slip.payDate > approved))
					approved = slip.payDate;
				if (item === 'D2_COMMISSION') commissionMonths.add(slip.period.slice(0, 7));
			}
			const deduction = DEDUCTION_ITEMS[item];
			if (line.bucket === 'DEDUCTION' && deduction != null) add(deduction, line.amount);
		}
		for (const charge of slip.charges) {
			if (charge.scheme === settings.compulsory_scheme)
				add('deduction_cpf_employee', charge.employee);
			if (settings.donation_schemes.includes(charge.scheme))
				add('deduction_donations', charge.employee);
			if (charge.scheme === settings.mosque_fund?.scheme && charge.employee !== 0) {
				const mosque = mosquePart(settings, charge.employee);
				add('deduction_mosque_building_fund', mosque);
				add('deduction_donations', charge.employee - mosque);
			}
		}
	}
	const at = (key: keyof ReturnAmounts) => cents(sums.get(key) ?? 0);
	// The engine charges the compulsory rate on the capped OW and AW only, so no employer
	// contribution it settles is excess or voluntary (IRAS notes d6 i–iv).
	const excessCpf = 0;
	const dTotal = cents(
		at('d1_allowances') +
			excessCpf +
			at('d2_commission') +
			at('d3_lump_sum') +
			at('d4_pension') +
			at('d5_overseas_pension_fund') +
			at('d7_gains_s10_1_b') +
			at('d7_gains_s10_1_g') +
			at('d8_benefits_in_kind')
	);
	const months = [...commissionMonths].toSorted();
	const span = months.length === 0 ? 0 : monthsBetween(months[0]!, months.at(-1)!) + 1;
	return {
		amounts: {
			a_gross_salary: at('a_gross_salary'),
			b_bonus_contractual: at('b_bonus_contractual'),
			b_bonus_non_contractual: at('b_bonus_non_contractual'),
			c_director_fees: at('c_director_fees'),
			d1_allowances: at('d1_allowances'),
			d2_commission: at('d2_commission'),
			d3_lump_sum: at('d3_lump_sum'),
			d3_compensation_for_loss_of_office: at('d3_compensation_for_loss_of_office'),
			d4_pension: at('d4_pension'),
			d5_overseas_pension_fund: at('d5_overseas_pension_fund'),
			d6_excess_voluntary_cpf: excessCpf,
			d7_gains_s10_1_b: at('d7_gains_s10_1_b'),
			d7_gains_s10_1_g: at('d7_gains_s10_1_g'),
			d8_benefits_in_kind: at('d8_benefits_in_kind'),
			d_total: dTotal,
			e1_remission: at('e1_remission'),
			deduction_cpf_employee: at('deduction_cpf_employee'),
			deduction_donations: at('deduction_donations'),
			deduction_mosque_building_fund: at('deduction_mosque_building_fund'),
			deduction_life_insurance: at('deduction_life_insurance')
		},
		dates: {
			b_bonus_declared_on: declared,
			c_director_fees_approved_on: approved,
			d2_commission_from: months.length === 0 ? null : `${months[0]}-01`,
			d2_commission_to: months.length === 0 ? null : monthBounds(months.at(-1)!).end,
			// Paid every month of its span is monthly commission; gaps make it other than monthly.
			d2_commission_type: months.length === 0 ? null : months.length === span ? 'M' : 'O',
			e1_overseas_posting: null,
			f_tax_borne: null,
			f_i_income_tax_borne: null,
			f_ii_fixed_tax_borne_by_employee: null
		}
	};
}

const year = (month: string) => decodeNumber(month.slice(0, 4));
/** The 1-based month of a `YYYY-MM` or a date. */
const month = (value: string) => decodeNumber(value.slice(5, 7));
const monthsBetween = (from: string, to: string) =>
	(year(to) - year(from)) * 12 + month(to) - month(from);

/**
 * The AIS identification type, read from the number itself: an NRIC begins S or T, a FIN F, G or M
 * (ICA). A return cannot be filed on any other, so it is refused rather than guessed.
 */
function identity(
	person: ReturnPerson,
	year: number,
	people: readonly ReturnPerson[]
): ReturnIdentity {
	const number = person.identityNumber?.trim().toUpperCase() ?? '';
	const type = /^[ST]\d{7}[A-Z]$/.test(number)
		? 'NRIC'
		: /^[FGM]\d{7}[A-Z]$/.test(number)
			? 'FIN'
			: refuse(
					`${person.employeeNumber}: Form IR8A and IR21 identify the employee by NRIC or FIN; record the identity number before filing.`
				);
	// Para 5: the earliest commencement and the latest cessation in the year, and a commencement
	// only when it fell in the year or before 1 Jan 1969.
	const starts = people.map((row) => row.hireDate).toSorted();
	const ends = people.map((row) => row.lastDay);
	const start = starts[0]!;
	const end = ends.includes(null) ? null : ends.toSorted().at(-1)!;
	return {
		id_type: type,
		id_number: number,
		employee_number: person.employeeNumber,
		name: person.name,
		date_of_birth: person.dateOfBirth,
		sex: person.gender === 'MALE' ? 'M' : person.gender === 'FEMALE' ? 'F' : null,
		nationality: person.nationality,
		designation: person.designation,
		commencement_on: start.startsWith(`${year}-`) || start < '1969-01-01' ? start : null,
		cessation_on: end != null && end.startsWith(`${year}-`) ? end : null
	};
}

/** The difference an AIS amendment submits: changed amounts signed, unchanged ones blank. */
export function amendmentOf(
	submitted: Partial<Record<keyof ReturnAmounts, number>>,
	corrected: ReturnAmounts
): Partial<Record<keyof ReturnAmounts, number | null>> {
	return Object.fromEntries(
		Object.entries(corrected).map(([key, value]) => {
			const difference = cents(value - (submitted[key as keyof ReturnAmounts] ?? 0));
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
	readonly submitted?: ReadonlyMap<string, Partial<Record<keyof ReturnAmounts, number>>>;
	/** This year's and the previous year's slips (the IR21 reports both). */
	readonly slips: readonly ReturnSlip[];
	readonly people: readonly ReturnPerson[];
	readonly holds: readonly ClearanceHold[];
	/** s.68(7): the most days the moneys may be held after IRAS receives the notice. */
	readonly maxWithholdDays: number | null;
};

/**
 * The year's returns: an IR8A per employee, and an IR21 instead for one whose employment ceased in
 * the year under a tax-clearance hold — the notes' exclusion (i) of a foreigner "who have left the
 * organisation and Form IR21 has been filed/ will be filed".
 */
export function incomeReturns(input: IncomeReturnInput): {
	ir8a: Ir8aRecord[];
	ir21: Ir21Record[];
} {
	const inYear = (slip: ReturnSlip, year: number) => slip.period.startsWith(`${year}-`);
	const cleared = new Map(input.holds.map((hold) => [hold.employmentId, hold]));
	const ir8a: Ir8aRecord[] = [];
	const ir21: Ir21Record[] = [];
	for (const [employeeId, people] of Map.groupBy(input.people, (row) => row.employeeId)) {
		const slips = input.slips.filter((slip) => slip.employeeId === employeeId);
		const current = slips.filter((slip) => inYear(slip, input.year));
		if (current.length === 0) continue;
		const latest = people.toSorted((a, b) => (a.hireDate < b.hireDate ? 1 : -1))[0]!;
		const hold = cleared.get(latest.employmentId);
		const employee = identity(latest, input.year, people);
		const { amounts, dates } = returnAmounts(input.settings, current);
		if (input.submission === 'REVISION' && Object.values(amounts).some((value) => value < 0))
			refuse(`${latest.employeeNumber}: an AIS revision cannot carry a negative amount.`);
		const stated =
			input.submission === 'AMENDMENT'
				? amendmentOf(input.submitted?.get(employee.id_number) ?? {}, amounts)
				: amounts;
		const ceased = latest.lastDay;
		if (hold != null && ceased != null && ceased.startsWith(`${input.year}-`)) {
			const previous = slips.filter((slip) => inYear(slip, input.year - 1));
			const received = hold.irasNoticeReceivedOn;
			ir21.push({
				form: 'IR21',
				submission: input.submission,
				employer: input.employer,
				authorised: input.authorised,
				employee,
				notice_due_on: monthDay(year(ceased), month(ceased) - 2, decodeNumber(ceased.slice(8))),
				departure_on: latest.departureOn,
				current_year: { year: input.year, amounts, dates },
				previous_year:
					previous.length === 0
						? null
						: { year: input.year - 1, ...returnAmounts(input.settings, previous) },
				withheld_amount: hold.amount,
				no_withholding_reason: hold.noWithholdingReason,
				iras_notice_received_on: received,
				release_by:
					received == null || input.maxWithholdDays == null
						? null
						: addDays(received, input.maxWithholdDays)
			});
			continue;
		}
		ir8a.push({
			form: 'IR8A',
			basis_year: input.year,
			submission: input.submission,
			employer: input.employer,
			authorised: input.authorised,
			employee,
			amounts: stated,
			dates
		});
	}
	return { ir8a, ir21 };
}

type RunRow = Parameters<typeof loadRunExports>[1][number] & { readonly company_id: string };

/**
 * The returns an export of `runs` asks for: for each entity and year the runs name, every settled
 * run of that entity in the year and the one before (the IR21 reports both), read back through
 * `loadRunExports` so the returns and the workbook are the same records. An entity whose version
 * states no `income_return` files none.
 */
export async function loadIncomeReturns(
	reads: Reads,
	runs: readonly RunRow[],
	options: Pick<IncomeReturnInput, 'authorised' | 'submission' | 'submitted'>
): Promise<{ label: string; year: number; ir8a: Ir8aRecord[]; ir21: Ir21Record[] }[]> {
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
					`${company?.name ?? companyId}: Form IR8A names the employer's tax reference (UEN); record the entity's registration number first.`
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
					irasNoticeReceivedOn: dateKey(hold.iras_notice_received_on) || null
				})),
				maxWithholdDays: payroll?.tax_clearance?.max_withhold_days ?? null
			});
			out.push({ label: `${company!.name} ${year}`, year, ...returns });
		}
	}
	return out;
}
