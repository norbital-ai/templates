import { isPlainDate } from '@norbital-ai/std/date';
import { Result, Schema } from 'effect';
import { BankValidationRules, bankConfigurationRefusal } from '../bank_template.js';
import { evaluateConfigured } from './expressions.js';
import { getErrorMessage, isJsonObject, Refusal, type JsonObject } from './foundation.js';
import { bankAccountFrom, recordDocuments, type ExportDocument } from './export.js';

type ExportRows = Parameters<typeof recordDocuments>[2];
type SharedPaymentBank = {
	readonly code: string;
	readonly name: string;
	readonly bank_codes: readonly string[];
	readonly currencies: readonly string[];
	readonly enabled: boolean;
	readonly template: unknown;
};

type BankExportInput = {
	/** An explicitly selected shared bank replaces all jurisdiction layouts. */
	readonly bank?: SharedPaymentBank;
	readonly templates: Parameters<typeof recordDocuments>[0];
	readonly runs: readonly JsonObject[];
	readonly rows: ExportRows;
	readonly company: JsonObject;
	readonly currency: string;
	readonly generated_at: string;
};

const isText = Schema.is(Schema.String);
const isTextList = Schema.is(Schema.Array(Schema.String));

const requiredText = (value: unknown, field: string): void => {
	if (!isText(value) || value.trim() === '')
		throw new Refusal({ message: `${field} is required before exporting the bank file.` });
	if (/[\u0000-\u001f\u007f]/.test(value))
		throw new Refusal({ message: `${field} contains an invalid control character.` });
};

/** Bank layouts are enabled only after their complete upload specification has been checked. */
export function bankExportDocuments(input: BankExportInput): {
	readonly documents: readonly ExportDocument[];
	readonly issue: string | null;
} {
	const result = Result.try(() => {
		if (input.rows.length === 0)
			throw new Refusal({ message: 'There are no payable employees for this bank file.' });
		const context = {
			runs: input.runs,
			company: input.company,
			currency: input.currency,
			generated_at: input.generated_at
		};
		requiredText(input.currency, 'Payment currency');
		const payer = bankAccountFrom(input.company.disbursement_account);
		const configured = input.bank;
		if (configured !== undefined) {
			if (!configured.currencies.includes(input.currency))
				throw new Refusal({
					message: `${configured.name} does not support ${input.currency} payments. Its supported currencies are ${configured.currencies.join(', ') || 'not configured'}. Select a bank format that supports the payroll currency; the export does not convert currency.`
				});
			requiredText(payer?.bank_code, 'Company bank code');
			if (!configured.bank_codes.includes(payer?.bank_code ?? ''))
				throw new Refusal({
					message:
						'The company paying account does not match the selected bank. Correct the account or select its bank before exporting.'
				});
			if (!configured.enabled)
				throw new Refusal({
					message: `${configured.name} is a draft payment-file format. Complete and approve its configuration in Settings → Banks before exporting.`
				});
			const refusal = bankConfigurationRefusal(configured);
			if (refusal !== undefined) throw new Refusal({ message: refusal.message });
			if (!isJsonObject(configured.template))
				throw new Refusal({ message: 'The selected bank template is invalid.' });
		}
		const templates =
			configured === undefined
				? input.templates
				: [
						{
							code: configured.code,
							rules: {
								...Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
									configured.template
								),
								bank_file_verified: true,
								bank_file_currencies: configured.currencies
							}
						}
					];
		// Each layout's rules decoded once: an object, or the whole configuration is refused.
		const layouts = templates.flatMap(({ code, rules }) => {
			if (!isJsonObject(rules))
				throw new Refusal({ message: 'The bank-file layout configuration is invalid.' });
			return rules.applies_when == null ||
				(isText(rules.applies_when) && evaluateConfigured(rules.applies_when, context) === true)
				? [{ code, rules }]
				: [];
		});
		if (layouts.length === 0)
			throw new Refusal({
				message:
					'No bank-file layout matches the paying account. Select the entity’s payment bank and format in Entities before exporting.'
			});
		if (layouts.length !== 1)
			throw new Refusal({
				message:
					'More than one bank-file layout matches. Select one upload format before exporting.'
			});
		for (const layout of layouts)
			if (layout.rules.bank_file_verified !== true)
				throw new Refusal({
					message:
						'This bank-file layout has not been verified against the bank’s upload specification. Provide the bank specification before exporting.'
				});
		for (const layout of layouts)
			if (
				!isTextList(layout.rules.bank_file_currencies) ||
				!layout.rules.bank_file_currencies.includes(input.currency)
			)
				throw new Refusal({
					message: 'The bank-file layout is not configured for this payment currency.'
				});
		requiredText(payer?.bank_code, 'Company bank code');
		requiredText(payer?.bank_account_number, 'Company bank account number');
		requiredText(payer?.bank_account_name, 'Company bank account holder');
		for (const run of input.runs)
			if (!isText(run.pay_date) || !isPlainDate(run.pay_date))
				throw new Refusal({
					message: 'A valid payroll payment date is required for the bank file.'
				});
		for (const [index, row] of input.rows.entries()) {
			const bank = bankAccountFrom(row.contract.bank);
			requiredText(bank?.bank_code, `Payment row ${index + 1}: employee bank code`);
			requiredText(
				bank?.bank_account_number,
				`Payment row ${index + 1}: employee bank account number`
			);
			requiredText(
				bank?.bank_account_name,
				`Payment row ${index + 1}: employee bank account holder`
			);
		}
		for (const layout of layouts) {
			if (!isText(layout.rules.file))
				throw new Refusal({ message: 'The bank-file name configuration is invalid.' });
			const name = evaluateConfigured(layout.rules.file, context);
			if (
				!isText(name) ||
				name.trim() === '' ||
				name !== name.trim() ||
				name === '.' ||
				name === '..' ||
				name.length > 255 ||
				/[\\/:<>"|?*\u0000-\u001f\u007f]/.test(name) ||
				name.endsWith('.')
			)
				throw new Refusal({
					message:
						'The bank template must produce a nonempty file name without folders, reserved characters or control characters.'
				});
			if (layout.rules.bank_file_validation == null) continue;
			const checks = Schema.decodeUnknownSync(BankValidationRules)(
				layout.rules.bank_file_validation
			);
			for (const check of checks.file)
				if (evaluateConfigured(check.test, context) !== true)
					throw new Refusal({ message: check.message });
			for (const [index, row] of input.rows.entries())
				for (const check of checks.row)
					if (evaluateConfigured(check.test, { ...row, ...context, index: index + 1 }) !== true)
						throw new Refusal({ message: check.message });
		}
		const documents = recordDocuments(
			layouts,
			input.runs,
			input.rows,
			input.company,
			input.generated_at,
			true,
			input.currency
		);
		if (documents.length !== 1 || documents[0]?.content.trim() === '')
			throw new Refusal({ message: 'The configured bank layout did not produce a payment file.' });
		return documents;
	});
	return Result.isSuccess(result)
		? { documents: result.success, issue: null }
		: { documents: [], issue: getErrorMessage(result.failure) };
}
