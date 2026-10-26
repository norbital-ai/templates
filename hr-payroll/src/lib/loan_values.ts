import { Decimal } from '@norbital-ai/std/decimal';
import { inputSchema } from '@norbital-ai/std/kind';
import { Schema } from 'effect';
import type { Masked, Row } from '@norbital-ai/bolt';
import { currencyScale } from './payroll_engine/payslip/context.js';

const amount = inputSchema({ kind: 'decimal', scale: 2 });
const nativeAmount = Schema.declare((value: unknown): value is Decimal => value instanceof Decimal);

/** Transform patches accept native amounts and the decimal literals admitted by the kind codec. */
export const loanAmount = (value: Decimal | number | `${number}`): Decimal =>
	value instanceof Decimal
		? value
		: Schema.decodeUnknownSync(nativeAmount)(Schema.decodeUnknownSync(amount)(value));

/** Dated catalogue rules receive only the loan inputs they calculate with — the principal, the advance date and the
 * loan's own `facts` (the keys its class's rule reads); none are duplicated on repayments. */
export const loanRuleFacts = (loan: {
	readonly principal_amount?: Decimal | null;
	readonly advance_made_on?: string | null;
	readonly facts?: Exclude<Row<'loan_catalog_entry'>['facts'], Masked>;
}) => ({
	...(loan.facts ?? {}),
	...(loan.principal_amount == null ? {} : { principal: loan.principal_amount.toNumber() }),
	...(loan.advance_made_on == null ? {} : { advance_made_on: loan.advance_made_on })
});

/** The money and calendar a loan schedule keeps, from the version governing its class: the version's minor units (else
 * its currency's) and its semi-monthly split. `null` when the version states neither currency nor split. */
export const loanCalendar = (
	payroll:
		| {
				readonly currency?: string | null;
				readonly minor_units?: number | null;
				readonly semi_monthly_split?: number | null;
		  }
		| null
		| undefined
): { readonly scale: number; readonly semi_monthly_split: number } | null =>
	payroll?.currency == null || payroll.semi_monthly_split == null
		? null
		: {
				scale: payroll.minor_units ?? currencyScale(payroll.currency),
				semi_monthly_split: payroll.semi_monthly_split
			};
