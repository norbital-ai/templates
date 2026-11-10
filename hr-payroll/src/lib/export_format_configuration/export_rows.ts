import { Effect } from 'effect';
import { queryRows, type Reader } from '../payroll_engine/reads.js';
import { isJsonObject } from '../payroll_engine/foundation.js';
import type { PayrollExportRow } from './export_format.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const amount = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : 0;
const day = (value: unknown): number => Date.parse(`${String(value)}T00:00:00Z`);
const days = (from: string, to: string) =>
	Math.max(0, Math.round((day(to) - day(from)) / 86_400_000) + 1);

/** Resolve one run's payments for a file export: payslips, contracts and the run's currency. */
export const exportRows = Effect.fn('payroll.exportRows')(function* (read: Reader, runId: string) {
	const first = yield* queryRows(read, {
		payroll_run: { where: { id: { eq: runId } }, limit: 1 },
		payslip: { where: { payroll_run_id: { eq: runId } }, limit: 10000 }
	});
	const run = (first.payroll_run ?? [])[0];
	if (run === undefined) return [];
	const slips = first.payslip ?? [];
	const employmentIds = slips.map((row) => text(row.employment_id));
	const settingsId = text(run.settings_id);

	const second = yield* queryRows(read, {
		jurisdiction_settings: { where: { id: { eq: settingsId } }, limit: 1 },
		entity: { where: { id: { eq: text(run.entity_id) } }, limit: 1 },
		employee_contract: { where: { id: { in: employmentIds } }, limit: 10000 },
		'employee_contract.employee_id': { fields: ['name'] }
	});
	const currency = text((second.jurisdiction_settings ?? [])[0]?.currency);
	const entityName = text((second.entity ?? [])[0]?.name);
	const contracts = new Map((second.employee_contract ?? []).map((row) => [text(row.id), row]));

	return slips.map((slip): PayrollExportRow => {
		const contract = contracts.get(text(slip.employment_id)),
			bank = contract !== undefined && isJsonObject(contract.bank) ? contract.bank : {};
		const person =
			contract !== undefined && isJsonObject(contract.employee_id) ? contract.employee_id : {};
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
			.filter((line) => {
				const source = line.source;
				return isJsonObject(source) && text(source.model) === 'allowance_catalog';
			})
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
