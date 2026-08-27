import type { MutateBeforeContext, MutateEditContext } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { currentInstant } from '../../lib/clock.js';
import type { Hooks, WorkspaceRow } from './$types.js';

const signingStatusSchema = Schema.Literals([
	'unstamped',
	'counterparty_stamped',
	'acknowledged',
	'voided'
]);
type SigningStatus = Schema.Schema.Type<typeof signingStatusSchema>;

type SigningUpdate = {
	-readonly [K in keyof WorkspaceRow<'contract_signings'>]?: WorkspaceRow<'contract_signings'>[K];
};

const VALID_TRANSITIONS: Record<SigningStatus, readonly SigningStatus[]> = {
	unstamped: ['counterparty_stamped', 'voided'],
	counterparty_stamped: ['acknowledged', 'voided'],
	acknowledged: ['voided'],
	voided: []
};

function sha256Hex(text: string) {
	return Effect.tryPromise(() =>
		crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
	).pipe(
		Effect.map((digest) =>
			[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
		)
	);
}

type BeforeApi = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['mutate']>['perRecord']>['before']>['handler']
>[0]['api'];

/** Fingerprint the quote substance a contract is bound to. */
function bindingHashFor(api: BeforeApi, quoteId: string): Effect.Effect<string, unknown> {
	return Effect.gen(function* () {
		const quote = yield* api.db.quotes.findFirst({
			where: { id: { eq: quoteId } },
			columns: {
				account_id: true,
				currency: true,
				tax_inclusive: true,
				net: true,
				tax: true,
				gross: true
			}
		});
		const lines = yield* api.db.quote_lines.findMany({
			where: { quote_id: { eq: quoteId } },
			columns: {
				product_code: true,
				quantity: true,
				unit_price: true,
				tax_rate: true,
				line_total: true
			},
			orderBy: { product_code: 'asc' },
			limit: 5000
		});
		return yield* sha256Hex(JSON.stringify({ quote, lines }));
	});
}

type BeforeContext = MutateBeforeContext<Hooks>;
type EditContext = MutateEditContext<Hooks>;

/** A create states the whole record and has no `existing`. */
const beforeCreate = ({ input, api }: BeforeContext) =>
	Effect.gen(function* () {
		if (!input.quote_id) {
			return yield* Effect.fail(new Error('A contract signing must reference a quote.'));
		}
		const quote = yield* api.db.quotes.findFirst({
			where: { id: { eq: input.quote_id } }
		});
		if (!quote) {
			return yield* Effect.fail(new Error('Referenced quote does not exist.'));
		}
		if (quote.status !== 'confirmed') {
			return yield* Effect.fail(
				new Error('A contract can only be generated from a confirmed quote.')
			);
		}

		const existing = yield* api.db.contract_signings.findMany({
			where: { quote_id: { eq: input.quote_id } },
			columns: { status: true },
			limit: 5000
		});
		if (existing.some((signing) => signing.status !== 'voided')) {
			return yield* Effect.fail(
				new Error(
					'An active contract signing already exists for this quote. Void it before re-signing.'
				)
			);
		}

		return {
			...input,
			status: input.status ?? 'unstamped',
			variant: input.variant ?? 'advance',
			binding_hash: yield* bindingHashFor(api, input.quote_id)
		};
	});

/** An edit lands on a stored row; `existing` is what tells the two apart. */
const beforeUpdate = ({ input, existing, api }: EditContext) =>
	Effect.gen(function* () {
		const newStatus = yield* Schema.decodeUnknownEffect(signingStatusSchema)(
			input.status ?? existing.status
		);
		const oldStatus = yield* Schema.decodeUnknownEffect(signingStatusSchema)(existing.status);

		if (oldStatus === newStatus) {
			if (oldStatus === 'voided') {
				return yield* Effect.fail(new Error('A voided contract signing is immutable.'));
			}
			return input;
		}

		const allowed = VALID_TRANSITIONS[oldStatus];
		if (!allowed.includes(newStatus)) {
			return yield* Effect.fail(
				new Error(
					`Invalid status transition: ${oldStatus} → ${newStatus}. Allowed: ${allowed.join(', ')}.`
				)
			);
		}

		const updates: SigningUpdate = { ...input };

		if (newStatus === 'counterparty_stamped') {
			const counterpartyFile = input.counterparty_file ?? existing.counterparty_file;
			if (counterpartyFile == null) {
				return yield* Effect.fail(
					new Error('The counterparty-stamped contract file is required to stamp.')
				);
			}
		}

		if (newStatus === 'acknowledged') {
			const quote = yield* api.db.quotes.findFirst({
				where: { id: { eq: existing.quote_id } },
				columns: { status: true }
			});
			if (!quote || quote.status !== 'confirmed') {
				return yield* Effect.fail(new Error('The underlying quote is no longer confirmed.'));
			}
			if (existing.acknowledged_at == null) {
				updates.acknowledged_at = (yield* currentInstant).toISOString();
			}
		}

		if (newStatus === 'voided') {
			const voidReason = input.void_reason ?? existing.void_reason;
			if (!voidReason || String(voidReason).trim() === '') {
				return yield* Effect.fail(new Error('A void reason is required.'));
			}
		}

		return updates;
	});

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Raises a signing only from a confirmed quote with no other live signing, and fingerprints the quote header and lines into binding_hash so later edits are detectable. Walks a signing from unstamped to counterparty-stamped to acknowledged, demanding the counterparty file to stamp, a still-confirmed quote to acknowledge, and a reason to void.',
				handler: (context) =>
					context.existing === undefined
						? beforeCreate(context)
						: beforeUpdate({ ...context, existing: context.existing })
			}
		}
	}
} satisfies Hooks;
