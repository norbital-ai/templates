import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { currentInstant } from '../../lib/clock.js';
import {
	assertTransition,
	batchEntries,
	groupBy,
	requireReason,
	uniqueIds
} from '../../lib/lifecycle.js';
import model from './+model.js';

type Signing = WorkspaceRow<'contract_signings'>;
type SigningStatus = NonNullable<Signing['status']>;

const TRANSITIONS: Record<SigningStatus, readonly SigningStatus[]> = {
	unstamped: ['counterparty_stamped', 'voided'],
	counterparty_stamped: ['acknowledged', 'voided'],
	acknowledged: ['voided'],
	voided: []
};

function sha256Hex(text: string) {
	// A digest of an in-memory string cannot fail for a data reason, so the error channel stays
	// clean: a host crypto fault dies as a defect instead of posing as a refusal.
	return Effect.orDie(
		Effect.tryPromise(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).pipe(
			Effect.map((digest) =>
				[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
			)
		)
	);
}

/** The files and the state a signing walks through; the quote it binds is fixed at creation. */
const lifecycle = {
	variant: true,
	status: true,
	generated_file: true,
	counterparty_file: true,
	owner_id: true
} as const;

/** `binding_hash` is computed here from the quote it fingerprints. */
const create = { input: { columns: { quote_id: true, ...lifecycle } } } as const;
const update = { input: { columns: { ...lifecycle, void_reason: true } } } as const;

type Create = CollectionInputOf<typeof model, typeof create, 'create'>;
type Update = CollectionInputOf<typeof model, typeof update, 'update'>;

const LIMIT = 5000;

/**
 * Raises a signing only from a confirmed quote with no other live signing, and fingerprints the
 * quote header and lines into `binding_hash` so later edits are detectable. Walks a signing from
 * unstamped to counterparty-stamped to acknowledged, demanding the counterparty file to stamp, a
 * still-confirmed quote to acknowledge, and a reason to void.
 */
export default defineCollection({
	model,
	create,
	update,
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const now = yield* currentInstant;
			const entries = batchEntries<Create, Update, Signing>(inputs, existing);
			const creates = entries.flatMap((entry) => (entry.kind === 'create' ? [entry.input] : []));
			const creatingQuoteIds = uniqueIds(creates.map((input) => input.quote_id));
			const quoteIds = uniqueIds([
				...creatingQuoteIds,
				...entries.flatMap((entry) =>
					entry.kind === 'update' && entry.input.status === 'acknowledged'
						? [entry.stored.quote_id]
						: []
				)
			]);
			const [quotes, lines, signings] = yield* Effect.all(
				[
					quoteIds.length
						? db.quotes.findMany({
								where: { id: { in: quoteIds } },
								columns: {
									id: true,
									status: true,
									account_id: true,
									currency: true,
									tax_inclusive: true,
									net: true,
									tax: true,
									gross: true
								},
								limit: LIMIT
							})
						: Effect.succeed([]),
					creatingQuoteIds.length
						? db.quote_lines.findMany({
								where: { quote_id: { in: creatingQuoteIds } },
								columns: {
									quote_id: true,
									product_code: true,
									quantity: true,
									unit_price: true,
									tax_rate: true,
									line_total: true
								},
								orderBy: { product_code: 'asc' },
								limit: LIMIT
							})
						: Effect.succeed([]),
					creatingQuoteIds.length
						? db.contract_signings.findMany({
								where: { quote_id: { in: creatingQuoteIds } },
								columns: { quote_id: true, status: true },
								limit: LIMIT
							})
						: Effect.succeed([])
				],
				{ concurrency: 'unbounded' }
			);
			const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
			const linesByQuote = groupBy(lines, (line) => line.quote_id);
			const signingsByQuote = groupBy(signings, (signing) => signing.quote_id);
			// The fingerprint of every quote a new signing binds: the header substance and the lines,
			// without the ids that would make two identical quotes hash apart.
			const hashByQuote = new Map(
				yield* Effect.all(
					quotes.flatMap(({ id, status, ...substance }) =>
						creatingQuoteIds.includes(id)
							? [
									Effect.map(
										sha256Hex(
											JSON.stringify({
												quote: substance,
												lines: (linesByQuote.get(id) ?? []).map(({ quote_id, ...line }) => line)
											})
										),
										(hash) => [id, hash] as const
									)
								]
							: []
					)
				)
			);

			return entries.map((entry) => {
				if (entry.kind === 'create') {
					const { input } = entry;
					const quote = quoteById.get(input.quote_id);
					const binding_hash = hashByQuote.get(input.quote_id);
					if (!quote || binding_hash === undefined) refuse('Referenced quote does not exist.');
					if (quote.status !== 'confirmed') {
						refuse('A contract can only be generated from a confirmed quote.');
					}
					if ((signingsByQuote.get(input.quote_id) ?? []).some((s) => s.status !== 'voided')) {
						refuse(
							'An active contract signing already exists for this quote. Void it before re-signing.'
						);
					}
					return {
						...input,
						status: input.status ?? 'unstamped',
						variant: input.variant ?? 'advance',
						binding_hash
					};
				}
				const { input, stored } = entry;
				const oldStatus = stored.status ?? 'unstamped';
				const newStatus = input.status ?? oldStatus;
				if (oldStatus === newStatus) {
					if (oldStatus === 'voided') refuse('A voided contract signing is immutable.');
					return input;
				}
				assertTransition(TRANSITIONS, oldStatus, newStatus);
				const stamps: { acknowledged_at?: string } = {};
				if (newStatus === 'counterparty_stamped') {
					if ((input.counterparty_file ?? stored.counterparty_file) == null) {
						refuse('The counterparty-stamped contract file is required to stamp.');
					}
				}
				if (newStatus === 'acknowledged') {
					const quote = quoteById.get(stored.quote_id);
					if (!quote || quote.status !== 'confirmed') {
						refuse('The underlying quote is no longer confirmed.');
					}
					if (stored.acknowledged_at == null) stamps.acknowledged_at = now.toISOString();
				}
				if (newStatus === 'voided') {
					requireReason(input.void_reason ?? stored.void_reason, 'void');
				}
				return { ...input, ...stamps };
			});
		})
});
