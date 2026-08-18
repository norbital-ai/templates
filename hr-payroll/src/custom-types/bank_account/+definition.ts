import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

const trimmedNonEmpty = Schema.Trimmed.check(Schema.isMinLength(1));

export const bankAccountValueSchema = Schema.Struct({
	bank_name: trimmedNonEmpty,
	bank_code: trimmedNonEmpty,
	bank_account_number: trimmedNonEmpty,
	bank_account_name: trimmedNonEmpty
});

export type BankAccount = Schema.Schema.Type<typeof bankAccountValueSchema>;

/** An in-progress bank account: any subset of the fields, or nothing at all. */
export const bankAccountDraftValueSchema = Schema.NullOr(
	Schema.Struct({
		bank_name: Schema.optional(trimmedNonEmpty),
		bank_code: Schema.optional(trimmedNonEmpty),
		bank_account_number: Schema.optional(trimmedNonEmpty),
		bank_account_name: Schema.optional(trimmedNonEmpty)
	})
);

/** Strict standard view: a key the account does not declare is refused rather than stripped. */
export const bankAccountSchema = Schema.toStandardSchemaV1(bankAccountValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});
export const bankAccountDraftSchema = Schema.toStandardSchemaV1(bankAccountDraftValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'bank_account',
	description:
		'The bank name, bank code, account number and account holder name a salary payment is credited to.',
	schema: bankAccountSchema
});
