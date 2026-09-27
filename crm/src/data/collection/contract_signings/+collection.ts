import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { missingReason } from '../../../lib/pricing.js';

const sha256 = async (text: string) =>
	[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

/** The files and the state a signing walks through; the quote it binds is fixed at creation. */
const lifecycle = ['variant', 'status', 'generated_file', 'counterparty_file', 'owner_id'] as const;

/**
 * Raises a signing only from a confirmed quote with no other live signing (also a partial `unique`), fingerprinting
 * the quote's substance and lines into `binding_hash` so later edits are detectable. Stamping needs the counterparty's
 * file, acknowledging stamps the time, voiding needs a reason; a voided signing is frozen. (A confirmed quote is
 * terminal, so the quote under an acknowledged signing is still confirmed.)
 */
const c = collection('contract_signings', {
	read: { fields: 'all' },
	create: { input: { columns: ['quote_id', ...lifecycle] } },
	update: { input: { columns: [...lifecycle, 'void_reason'] } }
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'contract_signings'>) => {
	const quoteIds = inputs.flatMap((input) => input.quote_id ?? []);
	const [quotes, lines, live] = await Promise.all([
		ctx.db.read('quotes', { where: { id: { in: quoteIds } }, all: true }),
		ctx.db.read('quote_lines', { where: { quote_id: { in: quoteIds } }, all: true }),
		ctx.db.read('contract_signings', {
			where: { quote_id: { in: quoteIds }, status: { ne: 'voided' } },
			all: true
		})
	]);
	return Promise.all(
		inputs.map(async (input, i) => {
			const stored = ctx.existing[i];
			if (stored === undefined) {
				const quote = quotes.rows.find((q) => q.id === input.quote_id);
				if (!quote) ctx.refuse('Referenced quote does not exist.');
				if (quote.status !== 'confirmed')
					ctx.refuse('A contract can only be generated from a confirmed quote.');
				if (live.rows.some((s) => s.quote_id === quote.id))
					ctx.refuse(
						'An active contract signing already exists for this quote. Void it before re-signing.'
					);
				const { account_id, currency, tax_inclusive } = quote;
				const quoteLines = lines.rows
					.filter((l) => l.quote_id === quote.id)
					.map(({ product_code, quantity, unit_price, tax_rate, line_total }) => ({
						product_code,
						quantity,
						unit_price,
						tax_rate,
						line_total
					}))
					.sort((a, b) => a.product_code.localeCompare(b.product_code));
				// the header's substance and its lines; its totals are the lines' sum, so the lines carry them (rule 10: no roll-ups here)
				const binding_hash = await sha256(
					JSON.stringify({ quote: { account_id, currency, tax_inclusive }, lines: quoteLines })
				);
				return { ...input, binding_hash };
			}
			const from = stored.status,
				to = input.status ?? from;
			if (
				to === 'counterparty_stamped' &&
				from !== to &&
				(input.counterparty_file ?? stored.counterparty_file) == null
			)
				ctx.refuse('The counterparty-stamped contract file is required to stamp.');
			if (to === 'acknowledged' && from !== to && stored.acknowledged_at == null)
				return { ...input, acknowledged_at: ctx.now };
			if (to === 'voided' && from !== to && missingReason(input.void_reason ?? stored.void_reason))
				ctx.refuse('A void reason is required.');
			return input;
		})
	);
});
