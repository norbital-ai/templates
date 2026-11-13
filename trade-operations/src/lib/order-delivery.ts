import type { Id, Row } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
import { type D, dec } from './values.js';
import type { ContractVersion } from './agreements.js';
import { contractEntryId } from './contract-draft.js';

export const orderDeliveries = (order: Id<'orders'>) =>
	({
		transactions: {
			where: { order: { eq: order }, kind: { eq: 'delivery' }, status: { eq: 'issued' } },
			// A corrected source sweep refreshes the first live page even if its quantities stayed the same.
			fields: ['seal_hash', 'items', 'source_updated_at'],
			limit: 100
		}
	}) as const;

export function deliveredByLine(
	contract: ContractVersion,
	history: readonly ContractVersion[],
	deliveries: readonly Pick<Row<'transactions'>, 'seal_hash' | 'items'>[]
) {
	const targets = new Map(
		history.map((version) => {
			const lines = new Map<string, { id: string; unit: string }>();
			for (const original of version.snapshot.lines) {
				const entry = contractEntryId(version, original);
				const matches = contract.snapshot.lines.filter(
					(line) =>
						line.product === original.product &&
						line.unit === original.unit &&
						(line.id === original.id ||
							(entry !== null && contractEntryId(contract, line) === entry))
				);
				if (matches.length === 1 && matches[0]) lines.set(original.id, matches[0]);
			}
			return [version.seal_hash, lines] as const;
		})
	);
	const quantities = new Map<string, D>();
	for (const delivery of deliveries) {
		const lines = targets.get(delivery.seal_hash);
		if (!lines) continue;
		for (const item of delivery.items ?? []) {
			const line = lines.get(item.order_line_id);
			if (!line || line.unit !== item.unit) continue;
			quantities.set(
				line.id,
				BigDecimal.sum(quantities.get(line.id) ?? dec(0), dec(item.quantity))
			);
		}
	}
	return quantities;
}
