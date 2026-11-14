import { Effect } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import { idOf, idsOf, queryRows, type Reader } from '../payroll_engine/reads.js';
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
export const exportRows = Effect.fn('payroll.exportRows')(function* (
	read: Reader,
	runId: Id<'payroll_run'>
) {
	const first = yield* queryRows(read, {
		payroll_run: { where: { id: { eq: runId } }, limit: 1 },
		payslip: { where: { payroll_run_id: { eq: runId } }, limit: 10000 }
	});
	const run = (first.payroll_run ?? [])[0];
	if (run === undefined) return [];
	const slips = first.payslip ?? [];
	const employmentIds = idsOf(
		'employment',
		slips.map((row) => row.employment_id)
	);

	const second = yield* queryRows(read, {
		jurisdiction: { fields: ['code', 'currency'], limit: 20 },
		entity: { where: { id: { eq: idOf('entity', run.entity_id) } }, limit: 1 },
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
			net_pay: amount(slip.net_pay)
		};
	});
});
