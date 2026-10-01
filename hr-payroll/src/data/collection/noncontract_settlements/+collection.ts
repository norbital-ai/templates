import { collection } from '@norbital-ai/bolt';
import { isCalendarDate } from '../../../lib/iso-day.js';
import { readAll } from '../../../lib/reads.js';
import { decodeNumber } from '../../../lib/wire.js';
import { cents } from '../../../lib/payroll/run/rounding.js';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { scalarFacts } from '../../../lib/payroll/run/eligibility.js';
import { settingsInForce } from '../../../lib/jurisdiction_settings.js';
import { factValuesFault } from '../../../lib/declared-facts.js';
import { entityFactsFault, evidenceFault } from '../../../lib/entity-facts.js';
import { factTables, lineageCodes } from '../../../lib/coded-fields.js';
import type { FactKey } from '../../../lib/datatypes/fact_keys.js';

/** An evidenced non-contract payee obligation; the row is immutable once recorded. */
const c = collection('noncontract_settlements', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'company_id',
				'employee_id',
				'reference',
				'currency',
				'agreed_gross',
				'agreed_due_on',
				'tax_residency',
				'tax_residency_range',
				'facts'
			],
			with: {
				/** Evidence of the declared settlement inputs, recorded with the obligation it evidences. */
				fact_evidence: { create: { columns: ['fact_key', 'reference', 'file', 'received_on'] } }
			}
		}
	}
});

type Version = {
	readonly id: string;
	readonly code: string;
	readonly effective_range: unknown;
	readonly sealed_at: string | null;
	readonly voided_at: string | null;
	readonly approval_id: string | null;
	readonly payroll: { readonly currency: string; readonly payment_occasion_scheme?: string | null };
	readonly settlement_facts: readonly FactKey[];
};

c.transform(async (inputs, ctx) => {
	const { db } = ctx;
	const refuse: (message: string, at?: { field?: string }) => never = (message, at) =>
		ctx.refuse(message, at as never);
	const companyIds = [...new Set(inputs.map((input) => String(input.company_id)))];
	const companies = await readAll<{ readonly id: string; readonly settings_code: string }>(
		db,
		'companies',
		{ id: { in: companyIds } }
	);
	const codeOf = new Map(companies.map((row) => [row.id, row.settings_code]));
	const lineages = await readAll<Version>(
		db,
		'jurisdiction_settings',
		{
			code: { in: [...new Set(companies.map((row) => row.settings_code))] },
			sealed_at: { isNull: false },
			voided_at: { isNull: true },
			approval_id: { isNull: true }
		},
		undefined,
		{
			id: true,
			code: true,
			effective_range: true,
			sealed_at: true,
			voided_at: true,
			approval_id: true,
			payroll: true,
			settlement_facts: true
		}
	);
	const codesOf = await lineageCodes(
		db,
		lineages,
		factTables(lineages.flatMap((row) => row.settlement_facts ?? []))
	);
	return inputs.map((input) => {
		const code = codeOf.get(String(input.company_id));
		if (code == null) refuse('A non-contract settlement needs a paying company on file.');
		const due = String(input.agreed_due_on ?? '');
		if (!isCalendarDate(due))
			refuse('Agreed non-contract remuneration needs a real due date.', { field: 'agreed_due_on' });
		const version = settingsInForce(lineages, code, due);
		if (version?.payroll.payment_occasion_scheme == null)
			refuse(
				`${code} settings in force on the due date name no payment-occasion scheme for non-contract remuneration.`
			);
		const currency = version.payroll.currency;
		if (input.currency !== currency)
			refuse(`Non-contract remuneration is agreed in the settings currency ${currency}.`, {
				field: 'currency'
			});
		if (!String(input.reference ?? '').trim())
			refuse('A non-contract settlement needs its agreement evidence reference.', {
				field: 'reference'
			});
		const agreed = decodeNumber(input.agreed_gross);
		if (!Number.isFinite(agreed) || agreed <= 0 || cents(agreed, currency) !== agreed)
			refuse(
				`Agreed non-contract remuneration must be a positive amount in ${currency} precision.`,
				{ field: 'agreed_gross' }
			);
		const range = readRange(input.tax_residency_range);
		if (
			range == null ||
			!isCalendarDate(range.start) ||
			(range.end != null && (!isCalendarDate(range.end) || range.end < range.start))
		)
			refuse('Tax residency needs a valid payment-date range.', { field: 'tax_residency_range' });
		// Values some version of the lineage declares; completeness and evidence are judged at payment.
		const facts = scalarFacts(input.facts as Record<string, unknown> | null);
		const lineage = lineages.filter((row) => row.code === code);
		const declared = lineage.flatMap((row) => row.settlement_facts ?? []);
		const fault =
			entityFactsFault(code, facts, declared, codesOf(code)) ??
			factValuesFault(version.settlement_facts ?? [], facts);
		if (fault != null) refuse(fault, { field: 'facts' });
		for (const row of (input.fact_evidence?.create ?? []) as readonly {
			readonly fact_key?: string | null;
			readonly reference?: string | null;
			readonly file?: unknown;
		}[]) {
			const key = String(row.fact_key ?? '').trim();
			if (!Object.hasOwn(facts, key)) refuse(`The settlement records no fact ${key} to evidence.`);
			const missing = evidenceFault(code, key, row, declared);
			if (missing != null) refuse(missing);
		}
		const id = crypto.randomUUID();
		return {
			...input,
			id,
			payable_tranches: {
				create: [
					{
						source_category: 'NONCONTRACT_REMUNERATION',
						source_kind: 'NONCONTRACT_SETTLEMENT',
						source_id: id,
						reference: input.reference,
						due_on: due,
						currency,
						gross_amount: agreed,
						non_event_deduction_amount: 0,
						tax_treatment: 'TAXABLE'
					}
				]
			}
		} as never;
	});
});

export default c;
