import { collection } from '@norbital-ai/bolt';
import { isCalendarDate } from '../../../lib/iso-day.js';
import { readAll } from '../../../lib/reads.js';
import { readRange } from '../../../lib/payroll/run/effective.js';

/** An evidenced VN non-contract payee obligation; the row is immutable once recorded. */
const c = collection('vn_noncontract_settlements', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'company_id',
				'employee_id',
				'reference',
				'agreed_gross_vnd',
				'agreed_due_on',
				'agreement_amount_reference',
				'relationship_reference',
				'relationship_reviewed_on',
				'income_nature_reference',
				'tax_residency',
				'tax_residency_range',
				'tax_residency_reference',
				'currency'
			]
		}
	}
});

c.transform(async (inputs, { db, refuse }) => {
	const companyIds = [...new Set(inputs.map((input) => String(input.company_id)))];
	const companies = await readAll<{ readonly id: string; readonly settings_code: string }>(
		db,
		'companies',
		{ id: { in: companyIds } }
	);
	const byId = new Map(companies.map((row) => [row.id, row]));
	for (const input of inputs) {
		if (byId.get(String(input.company_id))?.settings_code !== 'VN')
			refuse('A Vietnam non-contract settlement needs a Vietnamese paying company.');
		for (const field of [
			'reference',
			'agreement_amount_reference',
			'relationship_reference',
			'income_nature_reference',
			'tax_residency_reference'
		] as const)
			if (!String(input[field] ?? '').trim())
				refuse(`${field} needs an evidence reference.`, { field });
		if (!isCalendarDate(String(input.relationship_reviewed_on ?? '')))
			refuse('Relationship review needs a real calendar day.', {
				field: 'relationship_reviewed_on'
			});
		const agreed = input.agreed_gross_vnd;
		if (agreed == null || !Number.isSafeInteger(agreed) || agreed <= 0)
			refuse('Agreed non-contract remuneration must be a positive whole VND amount.', {
				field: 'agreed_gross_vnd'
			});
		if (!isCalendarDate(String(input.agreed_due_on ?? '')))
			refuse('Agreed non-contract remuneration needs a real due date.', {
				field: 'agreed_due_on'
			});
		const range = readRange(input.tax_residency_range);
		if (
			range == null ||
			!isCalendarDate(range.start) ||
			(range.end != null && (!isCalendarDate(range.end) || range.end < range.start))
		)
			refuse('Tax residency needs a valid payment-date range.', {
				field: 'tax_residency_range'
			});
		if (input.currency !== 'VND')
			refuse('Vietnam non-contract withholding needs VND payment amounts.', {
				field: 'currency'
			});
	}
	return inputs.map((input) => {
		const id = crypto.randomUUID();
		return {
			...input,
			id,
			payable_tranches: {
				create: [
					{
						source_category: 'NONCONTRACT_REMUNERATION',
						source_kind: 'VN_NONCONTRACT_SETTLEMENT',
						source_id: id,
						reference: input.agreement_amount_reference,
						due_on: input.agreed_due_on,
						currency: 'VND',
						gross_amount: input.agreed_gross_vnd,
						non_event_deduction_amount: 0,
						tax_treatment: 'TAXABLE'
					}
				]
			}
		} as never;
	});
});

export default c;
