import { datePeriod, eachDay, isPlainDate } from '@norbital-ai/std/date';
import type { JsonObject, Lookup, Party, Direction, Rounding, Unit } from './contracts.js';
import { lookupOf } from './contracts.js';
import { evaluate } from './expressions.js';
import { Refusal, isJsonObject, leaveDays, leaveEntry } from './foundation.js';
import { rounded } from './money.js';

export interface PayLine {
	readonly code: string;
	readonly label: string;
	readonly subtotal_id: string;
	readonly amount: number;
	readonly direction: Direction;
	readonly party: Party;
	readonly incurred_on: string;
	readonly coverage: { readonly from: string; readonly to: string };
	readonly quantity?: number;
	readonly unit?: Unit;
	readonly rate_code?: string;
	readonly source_id: { readonly model: string; readonly id: string };
	readonly is_reversal: boolean;
}

export interface LedgerOperation {
	readonly operation: 'CREATE' | 'REMOVE' | 'ADD' | 'DEDUCT';
	readonly account: string;
	readonly code: string;
	readonly amount: number;
	readonly unit?: Unit;
	readonly effective_on: string;
	readonly source_id?: { readonly model: string; readonly id: string };
}

export interface SubtotalResult {
	readonly id: string;
	readonly code: string;
	readonly name: string;
	readonly previous_id?: string | null;
	value: number;
}

export interface StatutoryResult {
	readonly code: string;
	readonly kind: string;
	readonly employee: number;
	readonly employer: number;
	readonly employee_ytd: number;
	readonly employer_ytd: number;
}

export interface PayrollInput {
	readonly run: JsonObject;
	readonly settings: JsonObject;
	readonly subtotals: readonly JsonObject[];
	readonly allowance: readonly JsonObject[];
	readonly overtime: readonly JsonObject[];
	readonly statutory: readonly JsonObject[];
	readonly leave_catalog: readonly JsonObject[];
	readonly claim_catalog: readonly JsonObject[];
	readonly adhoc_catalog: readonly JsonObject[];
	readonly loan_catalog: readonly JsonObject[];
	readonly employee: JsonObject;
	readonly employment: JsonObject;
	readonly employer: JsonObject;
	readonly balance: JsonObject;
	readonly entries: Readonly<Record<string, readonly JsonObject[]>>;
	readonly history: Readonly<Record<string, readonly JsonObject[]>>;
	readonly work?: { readonly days: readonly JsonObject[] };
	/** The person's contracts, whichever one pays: days outside all of them were never owed. */
	readonly employed?: readonly { readonly from: string; readonly to: string | null }[];
	/** Working days the person's pattern projects in the attendance period, holidays excluded. */
	readonly projected_work_days?: number;
}

export interface PayrollResult {
	readonly lines: readonly PayLine[];
	readonly subtotals: readonly SubtotalResult[];
	readonly statutory: readonly StatutoryResult[];
	readonly net_pay: number;
	readonly employer_cost: number;
	readonly ledger: readonly LedgerOperation[];
}

const text = (row: JsonObject, key: string): string => {
	const value = row[key];
	if (typeof value !== 'string' || value.length === 0)
		throw new Refusal({ message: `${key}: required text.` });
	return value;
};
const number = (value: unknown, field: string): number => {
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw new Refusal({ message: `${field}: expected a finite number.` });
	return value;
};
const amount = (value: unknown, field: string): number => {
	const result = number(value, field);
	if (result < 0) throw new Refusal({ message: `${field}: amount must be nonnegative.` });
	return result;
};
const id = (row: JsonObject): string => text(row, 'id');
const period = (run: JsonObject): { from: string; to: string } => {
	const coverage = run.salary_coverage;
	if (coverage === null || typeof coverage !== 'object' || Array.isArray(coverage))
		throw new Refusal({ message: 'Payroll requires an explicit salary coverage period.' });
	const value = coverage as JsonObject;
	const from = value.from,
		to = value.to;
	if (!isPlainDate(from) || !isPlainDate(to))
		throw new Refusal({ message: 'Salary coverage requires actual dates.' });
	return { from, to };
};
const catalogById = (rows: readonly JsonObject[]): ReadonlyMap<string, JsonObject> =>
	new Map(rows.map((row) => [id(row), row]));

/** An off-cycle run pays only catalogues that opt in; statutory schemes always apply. */
const inRun = (run: JsonObject, catalog: JsonObject): boolean =>
	run.kind !== 'OFF_CYCLE' || catalog.off_cycle_eligible === true;

/** The configured chain is the whole execution plan: no implicit BASE/EARNINGS/NET stages. */
export function subtotalChain(rows: readonly JsonObject[]): readonly JsonObject[] {
	const byId = new Map(rows.map((row) => [id(row), row]));
	const next = new Map<string, JsonObject>();
	for (const row of rows) {
		const previous = row.previous_id;
		if (previous == null) continue;
		if (typeof previous !== 'string' || !byId.has(previous))
			throw new Refusal({ message: `${text(row, 'code')}: predecessor is missing.` });
		if (next.has(previous))
			throw new Refusal({ message: 'Subtotals must form one linear chain, not a branch.' });
		next.set(previous, row);
	}
	const first = rows.filter((row) => row.previous_id == null);
	if (rows.length > 0 && first.length !== 1)
		throw new Refusal({ message: 'A subtotal chain needs exactly one first checkpoint.' });
	const ordered: JsonObject[] = [];
	let current = first[0];
	const seen = new Set<string>();
	while (current !== undefined) {
		const key = id(current);
		if (seen.has(key)) throw new Refusal({ message: 'Subtotal chain contains a cycle.' });
		seen.add(key);
		ordered.push(current);
		current = next.get(key);
	}
	if (ordered.length !== rows.length)
		throw new Refusal({ message: 'Subtotal chain is disconnected.' });
	return ordered;
}

/** Statutory dependencies are explicit scheme codes and only finalised results are visible. */
export function statutoryOrder(rows: readonly JsonObject[]): readonly JsonObject[] {
	const byCode = new Map(rows.map((row) => [text(row, 'code'), row]));
	const ordered: JsonObject[] = [];
	const visiting = new Set<string>();
	const done = new Set<string>();
	const visit = (code: string): void => {
		if (done.has(code)) return;
		const row = byCode.get(code);
		if (row === undefined) throw new Refusal({ message: `${code}: unknown statutory dependency.` });
		if (visiting.has(code)) throw new Refusal({ message: `${code}: statutory dependency cycle.` });
		visiting.add(code);
		for (const dependency of (row.depends_on ?? []) as readonly string[]) visit(dependency);
		visiting.delete(code);
		done.add(code);
		ordered.push(row);
	};
	for (const code of [...byCode.keys()].sort()) visit(code);
	return ordered;
}

const evaluateNumber = (source: unknown, context: object, field: string): number => {
	if (typeof source !== 'string' || source.trim() === '') return 0;
	return number(evaluate(source, 'CALCULATION', context, field), field);
};
const eligible = (source: unknown, context: object, field: string): boolean => {
	if (typeof source !== 'string' || source.trim() === '') return true;
	const result = evaluate(source, 'CALCULATION', context, field);
	if (typeof result !== 'boolean')
		throw new Refusal({ message: `${field}: must return a boolean.` });
	return result;
};
const incurredOn = (source: unknown, context: object, fallback: string, field: string): string => {
	if (typeof source !== 'string' || source.trim() === '') return fallback;
	const value = evaluate(source, 'CALCULATION', context, field);
	if (!isPlainDate(value)) throw new Refusal({ message: `${field}: must return an ISO date.` });
	return value;
};
const ROUNDING_MODES: readonly Rounding['mode'][] = [
	'HALF_UP',
	'HALF_EVEN',
	'UP',
	'DOWN',
	'TRUNCATE'
];
/** Rounding is a constant like any other: the jurisdiction's flat lookup owns it. */
const rounding = (settings: JsonObject): Rounding => {
	const lookup = lookupOf(settings);
	const mode = ROUNDING_MODES.find((candidate) => candidate === lookup.rounding) ?? 'HALF_UP';
	const scale =
		typeof lookup.rounding_scale === 'number' &&
		Number.isInteger(lookup.rounding_scale) &&
		lookup.rounding_scale >= 0 &&
		lookup.rounding_scale <= 12
			? lookup.rounding_scale
			: 2;
	return { mode, scale };
};
const round = (settings: JsonObject, value: number): number => rounded(value, rounding(settings));

function line(input: {
	readonly code: string;
	readonly label: string;
	readonly subtotal: JsonObject;
	readonly amount: number;
	readonly direction?: Direction;
	readonly party?: Party;
	readonly incurred_on: string;
	readonly coverage: { from: string; to: string };
	readonly source: JsonObject;
	readonly model: string;
	readonly reversal?: boolean;
	readonly quantity?: number;
	readonly unit?: Unit;
	readonly rate_code?: string;
}): PayLine {
	return {
		code: input.code,
		label: input.label,
		subtotal_id: id(input.subtotal),
		amount: input.amount,
		direction: input.direction ?? 'ADD',
		party: input.party ?? 'EMPLOYEE',
		incurred_on: input.incurred_on,
		coverage: input.coverage,
		source_id: { model: input.model, id: id(input.source) },
		is_reversal: input.reversal === true,
		...(input.quantity === undefined ? {} : { quantity: input.quantity }),
		...(input.unit === undefined ? {} : { unit: input.unit }),
		...(input.rate_code === undefined ? {} : { rate_code: input.rate_code })
	};
}

const signed = (direction: Direction, amount: number): number =>
	direction === 'ADD' ? amount : -amount;

/** Unpaid leave took every working day the pattern projected: nothing is owed for the period. */
const noPaidDay = (input: PayrollInput, unpaidDays: number): boolean =>
	input.projected_work_days !== undefined &&
	input.projected_work_days > 0 &&
	unpaidDays >= input.projected_work_days;

const unemployedDays = (input: PayrollInput, days: readonly string[]): number =>
	input.employed === undefined
		? 0
		: days.filter(
				(day) => !input.employed?.some(({ from, to }) => from <= day && (to === null || day <= to))
			).length;

/** Days the roster marks ABS: the person was expected, did not come and took no leave. */
const absentDays = (input: PayrollInput): number =>
	(input.work?.days ?? []).filter((day) => day.day_type === 'ABS').length;

/** The paid share of the period's ordinary days: paid leave keeps it, unpaid leave and ABS reduce it. */
const paidTimeFactor = (input: PayrollInput, coverage: { from: string; to: string }): number => {
	const schedule = input.employer.payment_schedule;
	const offDays =
		isJsonObject(schedule) && Array.isArray(schedule.non_working_weekdays)
			? schedule.non_working_weekdays.filter((day): day is number => typeof day === 'number')
			: [0, 6];
	const ordinaryDays = eachDay(datePeriod(coverage.from, coverage.to)).filter(
		(day) => !offDays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())
	);
	const workingDays = ordinaryDays.length;
	if (workingDays <= 0) return 1;
	const catalogs = catalogById(input.leave_catalog);
	let unpaidDays = unemployedDays(input, ordinaryDays) + absentDays(input);
	for (const entry of input.entries.leave_catalog_entry ?? []) {
		const catalog = catalogs.get(String(entry.catalog_id));
		if (catalog?.pay_treatment !== 'UNPAID') continue;
		const days = leaveDays(entry);
		unpaidDays += entry.is_reversal === true ? -days : days;
	}
	if (noPaidDay(input, unpaidDays - unemployedDays(input, ordinaryDays))) return 0;
	return Math.min(1, Math.max(0, workingDays - unpaidDays) / workingDays);
};

/** Default opening checkpoint: contract salary, prorated by UNPAID leave; reversal undoes the absence. */
function defaultBasePay(
	input: PayrollInput,
	lookup: Lookup,
	coverage: { from: string; to: string }
): number {
	const terms = input.employment.terms;
	const contractTerms: JsonObject = isJsonObject(terms) ? terms : {};
	const rate = contractTerms.rate;
	const rateAmount =
		rate !== null && typeof rate === 'object' && !Array.isArray(rate)
			? amount((rate as JsonObject).amount ?? 0, 'terms.rate.amount')
			: 0;
	const rateUnit = isJsonObject(rate) ? rate.unit : undefined;
	// Ordinary hours belong to the employer and the contract, never to jurisdiction law.
	const schedule = input.employer.payment_schedule;
	const offDays =
		isJsonObject(schedule) && Array.isArray(schedule.non_working_weekdays)
			? schedule.non_working_weekdays.filter((day): day is number => typeof day === 'number')
			: [0, 6];
	const daysPerWeek = amount(
		contractTerms.normal_days_per_week ?? 7 - offDays.length,
		'terms.normal_days_per_week'
	);
	const hoursPerDay = amount(
		contractTerms.normal_hours_per_day ??
			(typeof contractTerms.normal_hours_per_week === 'number'
				? contractTerms.normal_hours_per_week / daysPerWeek
				: 8),
		'terms.normal_hours_per_day'
	);
	const ordinaryDays = eachDay(datePeriod(coverage.from, coverage.to)).filter(
		(day) => !offDays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())
	);
	const workingDays = ordinaryDays.length;
	if (workingDays <= 0) throw new Refusal({ message: 'Working days must be positive.' });
	const hoursPerMonth = amount(
		contractTerms.normal_hours_per_month ?? workingDays * hoursPerDay,
		'terms.normal_hours_per_month'
	);
	const salaryAmount =
		rateUnit === 'DAILY'
			? rateAmount * workingDays
			: rateUnit === 'HOURLY'
				? rateAmount * hoursPerMonth
				: rateAmount;
	const catalogs = catalogById(input.leave_catalog);
	let unpaidDays = unemployedDays(input, ordinaryDays) + absentDays(input);
	for (const entry of input.entries.leave_catalog_entry ?? []) {
		const catalog = catalogs.get(String(entry.catalog_id));
		if (catalog?.pay_treatment !== 'UNPAID') continue;
		const days = leaveDays(entry);
		unpaidDays += entry.is_reversal === true ? -days : days;
	}
	if (noPaidDay(input, unpaidDays - unemployedDays(input, ordinaryDays))) return 0;
	const factor = Math.min(1, Math.max(0, workingDays - unpaidDays) / workingDays);
	return salaryAmount * factor;
}

/** One pure linear pass: inputs in, pay lines, checkpoint values, statutory YTD and ledger out. */
export function calculatePayroll(input: PayrollInput): PayrollResult {
	const chain = subtotalChain(input.subtotals);
	const coverage = period(input.run);
	const settingsLookup = lookupOf(input.settings);
	const balance = input.balance.account ?? {};
	// expressions read service entitlement dates, not the latest contract's start
	const employment =
		typeof input.employment.service_started_on === 'string' &&
		isJsonObject(input.employment.effective_range)
			? {
					...input.employment,
					effective_range: {
						...input.employment.effective_range,
						from: input.employment.service_started_on
					}
				}
			: input.employment;
	const base = (context: unknown, lookup: Lookup, field: string) => ({
		subject: {
			employee: input.employee,
			employment,
			employer: input.employer
		},
		lookup,
		balances: balance,
		base_pay: context,
		work: input.work ?? { days: [] },
		run: input.run,
		history: input.history,
		as_of: coverage.to
	});
	const lines: PayLine[] = [];
	const values = new Map<string, number>();
	const results: SubtotalResult[] = [];
	const baseSubtotal = chain[0];
	if (baseSubtotal === undefined) throw new Refusal({ message: 'A payroll run needs subtotals.' });

	for (const subtotal of chain) {
		const code = text(subtotal, 'code');
		const previous = subtotal.previous_id;
		const previousValue = typeof previous === 'string' ? (values.get(previous) ?? 0) : 0;
		const baseContext = {
			...base(previousValue, settingsLookup, code),
			subtotals: Object.fromEntries(results.map((r) => [r.code, r.value]))
		};
		const computed =
			chain.indexOf(subtotal) === 0 && subtotal.calculation == null
				? input.run.kind === 'OFF_CYCLE'
					? 0
					: defaultBasePay(input, settingsLookup, coverage)
				: evaluateNumber(subtotal.calculation, baseContext, `${code}.calculation`);
		if (computed !== 0)
			lines.push(
				line({
					code,
					label: text(subtotal, 'name'),
					subtotal,
					amount: Math.abs(computed),
					direction: computed < 0 ? 'DEDUCT' : 'ADD',
					incurred_on: coverage.from,
					coverage,
					source: input.employment,
					model: 'employee_contract'
				})
			);
		const subtotalLines: PayLine[] = [];
		const producers = [...input.allowance, ...input.overtime].filter(
			(row) => row.subtotal_id === id(subtotal) && inRun(input.run, row)
		);
		for (const producer of producers) {
			const code = text(producer, 'code');
			const lookup = lookupOf(producer);
			const context = {
				...base(previousValue + computed, lookup, code),
				subtotals: Object.fromEntries(results.map((r) => [r.code, r.value]))
			};
			if (!eligible(producer.eligibility, context, `${code}.eligibility`)) continue;
			const raw = evaluateNumber(producer.conversion, context, `${code}.conversion`);
			const value = lookup.prorate === true ? raw * paidTimeFactor(input, coverage) : raw;
			if (value === 0) continue;
			subtotalLines.push(
				line({
					code,
					label: text(producer, 'name'),
					subtotal,
					amount: round(input.settings, value),
					direction: (producer.direction as Direction) ?? 'ADD',
					party: (producer.party as Party) ?? 'EMPLOYEE',
					incurred_on: incurredOn(
						producer.incurred_on,
						context,
						coverage.to,
						`${code}.incurred_on`
					),
					coverage,
					source: producer,
					model: input.allowance.includes(producer) ? 'allowance_catalog' : 'overtime_catalog'
				})
			);
		}

		const catalogs = [
			{
				rows: input.leave_catalog,
				entries: input.entries.leave_catalog_entry ?? [],
				model: 'leave_catalog',
				entryModel: 'leave_catalog_entry'
			},
			{
				rows: input.claim_catalog,
				entries: input.entries.claim_catalog_entry ?? [],
				model: 'claim_catalog',
				entryModel: 'claim_catalog_entry'
			},
			{
				rows: input.adhoc_catalog,
				entries: input.entries.adhoc_catalog_entry ?? [],
				model: 'adhoc_catalog',
				entryModel: 'adhoc_catalog_entry'
			}
		] as const;
		for (const group of catalogs) {
			const byId = catalogById(group.rows);
			for (const raw of group.entries) {
				// a posted entry already reached a finalised payslip: never pay it again
				if (raw.payroll_run_id != null) continue;
				const entry = group.model === 'leave_catalog' ? leaveEntry(raw) : raw;
				const catalog = byId.get(String(entry.catalog_id));
				if (catalog === undefined || catalog.subtotal_id !== id(subtotal)) continue;
				if (!inRun(input.run, catalog)) continue;
				const code = text(catalog, 'code');
				if (catalog.pay_treatment === 'UNPAID') continue;
				const lookup = lookupOf(catalog);
				const context = {
					...base(previousValue + computed, lookup, code),
					entry,
					subtotals: Object.fromEntries(results.map((r) => [r.code, r.value]))
				};
				if (!eligible(catalog.eligibility, context, `${code}.eligibility`)) continue;
				const value = evaluateNumber(catalog.conversion, context, `${code}.conversion`);
				if (value === 0) continue;
				subtotalLines.push(
					line({
						code,
						label: text(catalog, 'name'),
						subtotal,
						amount: round(input.settings, value),
						direction:
							((catalog.direction as Direction) ?? 'ADD') === 'ADD' && entry.is_reversal === true
								? 'DEDUCT'
								: ((catalog.direction as Direction) ?? 'ADD') === 'DEDUCT' &&
									  entry.is_reversal === true
									? 'ADD'
									: ((catalog.direction as Direction) ?? 'ADD'),
						party: (catalog.party as Party) ?? 'EMPLOYEE',
						incurred_on: incurredOn(
							catalog.incurred_on,
							context,
							String(entry.incurred_on ?? coverage.to),
							`${code}.incurred_on`
						),
						coverage,
						source: entry,
						model: group.entryModel,
						reversal: entry.is_reversal === true,
						...(typeof entry.quantity === 'number' ? { quantity: entry.quantity } : {}),
						...(entry.unit === undefined ? {} : { unit: entry.unit as Unit })
					})
				);
			}
		}

		const loanCatalog = catalogById(input.loan_catalog);
		for (const repayment of input.entries.loan_repayment_entry ?? []) {
			if (repayment.payroll_run_id != null) continue;
			// an instalment is due in the run that covers its date; a later month's stays open
			if (repayment.paid_on != null && String(repayment.paid_on) > coverage.to) continue;
			const loan = (input.entries.loan_catalog_entry ?? []).find(
				(row) => id(row) === repayment.loan_id
			);
			const catalog = loan === undefined ? undefined : loanCatalog.get(String(loan.catalog_id));
			if (catalog === undefined || catalog.subtotal_id !== id(subtotal)) continue;
			if (!inRun(input.run, catalog)) continue;
			const value = amount(repayment.amount ?? 0, 'repayment.amount');
			if (value === 0) continue;
			subtotalLines.push(
				line({
					code: text(catalog, 'code'),
					label: text(catalog, 'name'),
					subtotal,
					amount: round(input.settings, value),
					direction: repayment.is_reversal === true ? 'ADD' : 'DEDUCT',
					party: 'EMPLOYEE',
					incurred_on: String(repayment.paid_on ?? coverage.to),
					coverage,
					source: repayment,
					model: 'loan_repayment_entry',
					reversal: repayment.is_reversal === true,
					quantity: value,
					unit: 'MONEY'
				})
			);
		}

		const value = round(
			input.settings,
			previousValue +
				computed +
				subtotalLines.reduce((total, l) => total + signed(l.direction, l.amount), 0)
		);
		values.set(id(subtotal), value);
		results.push({
			id: id(subtotal),
			code,
			name: text(subtotal, 'name'),
			previous_id: (subtotal.previous_id as string | null | undefined) ?? null,
			value
		});
		lines.push(...subtotalLines);
	}

	const statutory: StatutoryResult[] = [];
	const statutoryValues: Record<string, { employee: number; employer: number }> = {};
	for (const scheme of statutoryOrder(input.statutory)) {
		const code = text(scheme, 'code');
		const subtotal = chain.find((row) => id(row) === scheme.subtotal_id);
		if (subtotal === undefined)
			throw new Refusal({ message: `${code}: its subtotal is not in this version.` });
		const lookup = lookupOf(scheme);
		const context = {
			...base(values.get(id(subtotal)) ?? 0, lookup, code),
			subtotals: Object.fromEntries(results.map((r) => [r.code, r.value])),
			statutory: statutoryValues,
			overtime: lines
				.filter((row) => row.source_id.model === 'overtime_catalog')
				.reduce((total, row) => total + row.amount, 0)
		};
		if (!eligible(scheme.eligibility, context, `${code}.eligibility`)) continue;
		const employee = round(
			input.settings,
			evaluateNumber(scheme.employee_amount, context, `${code}.employee_amount`)
		);
		const employer = round(
			input.settings,
			evaluateNumber(scheme.employer_amount, context, `${code}.employer_amount`)
		);
		statutoryValues[code] = { employee, employer };
		const prior = (input.history.statutory ?? []).filter((row) => row.code === code);
		const employeeYtd =
			prior.reduce((total, row) => total + amount(row.employee ?? 0, 'YTD'), 0) + employee;
		const employerYtd =
			prior.reduce((total, row) => total + amount(row.employer ?? 0, 'YTD'), 0) + employer;
		statutory.push({
			code,
			kind: String(scheme.kind ?? 'CONTRIBUTION'),
			employee,
			employer,
			employee_ytd: employeeYtd,
			employer_ytd: employerYtd
		});
		const target = chain.find((row) => id(row) === subtotal.id);
		if (target !== undefined && employee !== 0)
			lines.push(
				line({
					code,
					label: text(scheme, 'name'),
					subtotal: target,
					amount: employee,
					direction: 'DEDUCT',
					party: 'EMPLOYEE',
					incurred_on: coverage.to,
					coverage,
					source: scheme,
					model: 'statutory_contribution_catalog'
				})
			);
		const employerTarget = chain.find((row) => id(row) === scheme.employer_cost_subtotal_id);
		if (employerTarget !== undefined && employer !== 0)
			lines.push(
				line({
					code: `${code}_EMPLOYER`,
					label: `${text(scheme, 'name')} (employer)`,
					subtotal: employerTarget,
					amount: employer,
					direction: 'ADD',
					party: 'EMPLOYER',
					incurred_on: coverage.to,
					coverage,
					source: scheme,
					model: 'statutory_contribution_catalog'
				})
			);
	}
	// Statutory lines are producers too: rebuild the running checkpoints with them included.
	const finalValues = new Map<string, number>();
	const finalResults: SubtotalResult[] = [];
	for (const subtotal of chain) {
		const code = text(subtotal, 'code');
		const previous = subtotal.previous_id;
		const previousValue = typeof previous === 'string' ? (finalValues.get(previous) ?? 0) : 0;
		const context = {
			...base(previousValue, settingsLookup, code),
			subtotals: Object.fromEntries(finalResults.map((row) => [row.code, row.value]))
		};
		const computed =
			chain.indexOf(subtotal) === 0 && subtotal.calculation == null
				? input.run.kind === 'OFF_CYCLE'
					? 0
					: defaultBasePay(input, settingsLookup, coverage)
				: evaluateNumber(subtotal.calculation, context, `${code}.calculation`);
		const included = lines.filter(
			(l) =>
				l.subtotal_id === id(subtotal) &&
				l.party === 'EMPLOYEE' &&
				l.source_id.model !== 'employee_contract'
		);
		const value = round(
			input.settings,
			previousValue +
				computed +
				included.reduce((total, l) => total + signed(l.direction, l.amount), 0)
		);
		finalValues.set(id(subtotal), value);
		finalResults.push({
			id: id(subtotal),
			code,
			name: text(subtotal, 'name'),
			previous_id: (subtotal.previous_id as string | null | undefined) ?? null,
			value
		});
	}
	results.splice(0, results.length, ...finalResults);
	const net = results.at(-1)?.value ?? 0;
	if (net < 0 && lines.some((l) => l.source_id?.model === 'loan_repayment_entry' && !l.is_reversal))
		throw new Refusal({
			message: `${String(input.employee.name ?? id(input.employee))}: loan recovery would leave net pay at ${net}; reduce the final repayment.`
		});
	const employerCost = lines
		.filter((l) => l.party === 'EMPLOYER')
		.reduce((total, l) => total + signed(l.direction, l.amount), 0);
	const ledger: LedgerOperation[] = [];
	if (net !== 0)
		ledger.push({
			operation: net > 0 ? 'ADD' : 'DEDUCT',
			account: 'payroll',
			code: 'NET_PAY',
			amount: Math.abs(net),
			unit: 'MONEY',
			effective_on: String(input.run.pay_date ?? coverage.to)
		});
	for (const result of statutory) {
		if (result.employee !== 0)
			ledger.push({
				operation: 'ADD',
				account: 'statutory_contribution',
				code: `${result.code}.employee`,
				amount: result.employee,
				unit: 'MONEY',
				effective_on: String(input.run.pay_date ?? coverage.to)
			});
		if (result.employer !== 0)
			ledger.push({
				operation: 'ADD',
				account: 'statutory_contribution',
				code: `${result.code}.employer`,
				amount: result.employer,
				unit: 'MONEY',
				effective_on: String(input.run.pay_date ?? coverage.to)
			});
	}
	return {
		lines,
		subtotals: results,
		statutory,
		net_pay: net,
		employer_cost: employerCost,
		ledger
	};
}
