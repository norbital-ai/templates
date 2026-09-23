import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The allowances a contract carries: one entry per allowance class, with the monthly figure the
 * contract states. The class is `allowance_catalogue`'s row (its bands may price the figure from
 * the person — VN's insurance-equivalent allowance — in which case the contract states 0); the
 * amount is a positive magnitude in the contract's currency, prorated like basic salary. A class
 * appears once: to change its figure is a terms change from a date.
 */
const contractAllowanceValueSchema = Schema.Struct({
	catalogue_id: Schema.String.check(Schema.isUUID()),
	amount: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
});
export type ContractAllowance = Schema.Schema.Type<typeof contractAllowanceValueSchema>;

export const contractAllowancesValueSchema = Schema.Array(contractAllowanceValueSchema).check(
	Schema.makeFilter((rows) =>
		new Set(rows.map((row) => row.catalogue_id)).size === rows.length
			? true
			: 'A contract lists each allowance class once.'
	)
);

export default defineCustomType({
	name: 'contract_allowances',
	description:
		'The allowances on a contract: one allowance class each with its monthly figure, prorated like basic salary.',
	schema: Schema.toStandardSchemaV1(contractAllowancesValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
