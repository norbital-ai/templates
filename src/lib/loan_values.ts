import { Decimal } from '@norbital-ai/std/decimal';
import { inputSchema } from '@norbital-ai/std/kind';
import { Schema } from 'effect';

const amount = inputSchema({ kind: 'decimal', scale: 2 });
const nativeAmount = Schema.declare((value: unknown): value is Decimal => value instanceof Decimal);

/** Transform patches accept native amounts and the decimal literals admitted by the kind codec. */
export const loanAmount = (value: Decimal | number | `${number}`): Decimal =>
	value instanceof Decimal
		? value
		: Schema.decodeUnknownSync(nativeAmount)(Schema.decodeUnknownSync(amount)(value));

/** Dated catalogue rules receive only the loan inputs they calculate with; none are duplicated on repayments. */
export const loanRuleFacts = (loan: {
	readonly principal_amount?: Decimal | null;
	readonly advance_purpose?: string | null;
	readonly written_agreement_reference?: string | null;
	readonly advance_made_on?: string | null;
}) => ({
	...(loan.principal_amount == null ? {} : { principal: loan.principal_amount.toNumber() }),
	...(loan.advance_purpose == null ? {} : { advance_purpose: loan.advance_purpose }),
	...(loan.written_agreement_reference == null
		? {}
		: { written_agreement_reference: loan.written_agreement_reference }),
	...(loan.advance_made_on == null ? {} : { advance_made_on: loan.advance_made_on })
});
