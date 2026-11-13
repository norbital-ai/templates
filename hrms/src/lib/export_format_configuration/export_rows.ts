import { Effect } from 'effect';
import { queryRows, type Reader } from '../payroll_engine/reads.js';
import { isJsonObject } from '../payroll_engine/foundation.js';
import { PROFILE_FIELDS, employmentOn, partsIn } from '../person.js';
import type { PayrollExportRow } from './export_format.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const amount = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * Resolve one run's payments for a file export: payslips, each stint as it stood at the period's end, and the run's
 * currency.
 */
export const exportRows = Effect.fn('payroll.exportRows')(function* (read: Reader, runId: string) {
	const first = yield* queryRows(read, {
		payroll_run: { where: { id: { eq: runId } }, limit: 1 },
		payslip: { where: { payroll_run_id: { eq: runId } }, limit: 10000 }
	});
	const run = (first.payroll_run ?? [])[0];
	if (run === undefined) return [];
	const slips = first.payslip ?? [];
	const employmentIds = slips.map((row) => text(row.employment_id));

	const second = yield* queryRows(read, {
		jurisdiction: { fields: ['code', 'currency'], limit: 1000 },
		entity: { where: { id: { eq: text(run.entity_id) } }, limit: 1 },
		employment: { where: { id: { in: employmentIds } }, limit: 10000 },
		contract_terms: { where: { employment_id: { in: employmentIds } }, limit: 10000 },
		employee_profile: {
			where: { employment: { some: { id: { in: employmentIds } } } },
			fields: [...PROFILE_FIELDS, 'name'],
			limit: 10000
		}
	});
	const closes = text(isJsonObject(run.salary_coverage) ? run.salary_coverage.to : undefined);
	const entity = (second.entity ?? [])[0];
	// a run is paid in the currency of its company's jurisdiction
	const currency = text(
		(second.jurisdiction ?? []).find((row) => row.code === entity?.settings_code)?.currency
	);
	const entityName = text(entity?.name);
	const stints = new Map(partsIn(second).map((parts) => [text(parts.stint.id), parts]));

	return slips.map((slip): PayrollExportRow => {
		const parts = stints.get(text(slip.employment_id));
		const contract = parts === undefined ? undefined : employmentOn(parts, closes),
			bank = contract !== undefined && isJsonObject(contract.bank) ? contract.bank : {};
		const person = parts?.profile ?? {};
		const bankAccountName = text(bank.bank_account_name) || text(person.name);
		const terms = contract !== undefined && isJsonObject(contract.terms) ? contract.terms : {};
		const rate = isJsonObject(terms.rate) ? terms.rate : {};
		const unit = text(rate.unit) || 'MONTHLY';
		const paidBasicField = amount(slip.basic_earnings);
		const basic = unit === 'MONTHLY' ? amount(rate.amount) : paidBasicField;
		const breakdown = isJsonObject(slip.breakdown) ? slip.breakdown : {};
		const lines = Array.isArray(breakdown.lines) ? breakdown.lines.filter(isJsonObject) : [];
		const checkpoints = Array.isArray(breakdown.checkpoints)
			? breakdown.checkpoints.filter(isJsonObject)
			: [];
		const checkpoint = (code: string) =>
			amount(checkpoints.find((row) => text(row.code) === code)?.value);
		const allowances = lines
			.filter((line) => text(line.source) === 'allowance_catalog')
			.reduce((total, line) => total + amount(line.amount), 0);
		const nplLine = lines
			.filter((line) => text(line.code) === 'NPL')
			.reduce((total, line) => total + amount(line.amount), 0);
		const paidBasic = checkpoints.some((row) => text(row.code) === 'PAID_BASIC')
			? checkpoint('PAID_BASIC')
			: paidBasicField;
		const npl = nplLine > 0 ? nplLine : Math.max(0, basic - paidBasic);
		const proration = Math.max(0, basic - paidBasic - npl);
		return {
			payroll_run_id: runId,
			employee_number: text(contract?.employee_number),
			employee_name: text(person.name),
			entity_name: entityName,
			bank_name: text(bank.bank_name),
			bank_code: text(bank.bank_code),
			bank_account_number: text(bank.bank_account_number),
			bank_account_name: bankAccountName,
			currency,
			basic_earnings: basic,
			allowances,
			npl,
			proration,
			gross_earnings: amount(slip.gross_earnings),
			net_pay: amount(slip.net_pay),
			total_deductions: amount(slip.total_deductions),
			employer_cost: amount(slip.employer_cost)
		};
	});
});
