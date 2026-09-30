import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { EXPORT_OUTPUT, quoteDocument } from '../../../lib/document-export.js';
import { missingReason, num, reprices } from '../../../lib/pricing.js';

/** The commercial terms a rep states on a quote, on creation and while it is a draft. */
const terms = [
	'account_id',
	'contact_id',
	'title',
	'status',
	'currency',
	'tax_inclusive',
	'valid_until',
	'payment_terms',
	'shipping_terms',
	'place_of_loading',
	'place_of_delivery',
	'packaging',
	'shipping_mark',
	'time_of_shipment',
	'other_terms',
	'owner_id',
	'description'
] as const;

/**
 * Opens a quote against an active account, in its currency unless stated (numbered `QT-<year>-<n>` by the model, draft
 * revision 1). The state field polices the moves; the transform adds what a move needs: confirming demands lines on
 * active products and, under adverse credit, an explicit acknowledgement; reopening a sent quote raises its revision;
 * cancelling needs a reason. A draft's currency and tax basis hold still under its priced lines.
 */
const c = collection('quotes', {
	read: { fields: 'all' },
	create: { input: { columns: terms } },
	update: { input: { columns: [...terms, 'credit_acknowledged', 'cancel_reason'] } },
	queries: {
		export_confirmed: {
			description:
				'Packages each confirmed quote with its lines as a JSON document for the downstream system to receive.',
			input: { ids: { kind: 'list', of: { kind: 'id', of: 'quotes' }, min: 1 } },
			output: EXPORT_OUTPUT
		}
	}
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'quotes'>) => {
	const confirming = inputs.flatMap((input, i) =>
		input.status === 'confirmed' ? [ctx.existing[i]!] : []
	);
	const accountIds = [
		...new Set(
			[...inputs.map((input) => input.account_id), ...confirming.map((q) => q.account_id)].filter(
				(id) => id != null
			)
		)
	];
	const repricing = inputs.flatMap((input, i) => {
		const stored = ctx.existing[i];
		return stored !== undefined && reprices(input, stored) ? [stored.id] : [];
	});
	// a transform's stored rows carry no roll-ups (rule 10): the confirming and repricing quotes' lines are read here
	const onConfirming = { quote_id: { in: confirming.map((q) => q.id) } };
	const [accounts, lines, inactive] = await Promise.all([
		ctx.db.read('accounts', { where: { id: { in: accountIds } }, all: true }),
		ctx.db.read('quote_lines', {
			where: { quote_id: { in: [...onConfirming.quote_id.in, ...repricing] } },
			all: true
		}),
		ctx.db.read('quote_lines', {
			where: { ...onConfirming, product_id: { is: { active: { eq: false } } } },
			all: true
		})
	]);
	const account = (id: string) => accounts.rows.find((a) => a.id === id);

	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		if (stored === undefined) {
			const a = account(input.account_id!);
			if (a?.active === false) ctx.refuse('Cannot create a quote for an inactive account.');
			return { ...input, currency: input.currency ?? a?.currency ?? null };
		}
		const from = stored.status,
			to = input.status ?? from;
		if (from === to) {
			if (from !== 'draft')
				ctx.refuse(`A ${from} document is immutable. Revise by reopening to draft status first.`);
			// lines are priced once, in the quote's currency and tax basis: neither moves under them
			if (reprices(input, stored) && lines.rows.some((l) => l.quote_id === stored.id))
				ctx.refuse(
					'Currency and tax basis cannot change once the quote has lines. Remove the lines first.'
				);
			return input;
		}
		if (to === 'confirmed') {
			const a = account(stored.account_id);
			const own = lines.rows.filter((l) => l.quote_id === stored.id);
			const gross = own.reduce((sum, l) => sum + num(l.line_total), 0);
			if (a?.active === false) ctx.refuse('Cannot confirm a quote for an inactive account.');
			// Credit warns, never blocks: an adverse verdict demands an explicit acknowledgement on the document.
			const adverse =
				a?.credit_hold === true ||
				(a?.credit_limit != null &&
					a.credit_used != null &&
					num(a.credit_used) + gross > num(a.credit_limit));
			if (adverse && input.credit_acknowledged !== true && stored.credit_acknowledged !== true)
				ctx.refuse(
					'Credit check is adverse (hold or over-limit). Set credit_acknowledged to confirm anyway.'
				);
			if (own.length === 0)
				ctx.refuse('A quote must have at least one line before it can be confirmed.');
			const names = [
				...new Set(inactive.rows.filter((l) => l.quote_id === stored.id).map((l) => l.product_name))
			];
			if (names.length > 0)
				ctx.refuse(`Cannot confirm a quote with inactive products: ${names.join(', ')}.`);
			return { ...input, ...(stored.confirmed_at == null ? { confirmed_at: ctx.now } : {}) };
		}
		if (to === 'draft' && from === 'sent')
			return {
				...input,
				revision_number: stored.revision_number + 1,
				revision_of: stored.revision_of ?? stored.id
			};
		if (to === 'cancelled') {
			if (missingReason(input.cancel_reason ?? stored.cancel_reason))
				ctx.refuse('A cancellation reason is required.');
			return { ...input, ...(stored.cancelled_at == null ? { cancelled_at: ctx.now } : {}) };
		}
		return input;
	});
});

/** `norbital.crm.confirmed_quote.v1`, one per confirmed quote the caller may read. */
c.query('export_confirmed', async ({ ids }, ctx) => {
	const docs = await ctx.read('quotes', {
		where: { id: { in: ids }, status: { eq: 'confirmed' } },
		all: true
	});
	const lines = await ctx.read('quote_lines', {
		where: { quote_id: { in: docs.rows.map((d) => d.id) } },
		all: true
	});
	return {
		documents: docs.rows.map((d) =>
			quoteDocument(
				d,
				lines.rows.filter((l) => l.quote_id === d.id)
			)
		)
	};
});
