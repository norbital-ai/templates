import { Effect } from 'effect';
import { queryRows, type Reader } from '../payroll_engine/reads.js';
import { isJsonObject } from '../payroll_engine/foundation.js';
import type { PayrollExportRow } from './export_format.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const amount = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : 0;

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
		employee_contract: { where: { id: { in: employmentIds } }, limit: 10000 }
	});
	const currency = text((second.jurisdiction_settings ?? [])[0]?.currency);
	const entityName = text((second.entity ?? [])[0]?.name);
	const contracts = new Map((second.employee_contract ?? []).map((row) => [text(row.id), row]));

	return slips.map((slip): PayrollExportRow => {
		const contract = contracts.get(text(slip.employment_id)),
			bank = contract !== undefined && isJsonObject(contract.bank) ? contract.bank : {};
		const bankAccountName = text(bank.bank_account_name) || text(contract?.employee_name);
		return {
			payroll_run_id: runId,
			employee_number: text(contract?.employee_number),
			employee_name: text(contract?.employee_name),
			entity_name: entityName,
			bank_name: text(bank.bank_name),
			bank_code: text(bank.bank_code),
			bank_account_number: text(bank.bank_account_number),
			bank_account_name: bankAccountName,
			currency,
			basic_earnings: amount(slip.basic_earnings),
			gross_earnings: amount(slip.gross_earnings),
			net_pay: amount(slip.net_pay),
			total_deductions: amount(slip.total_deductions),
			employer_cost: amount(slip.employer_cost)
		};
	});
});
