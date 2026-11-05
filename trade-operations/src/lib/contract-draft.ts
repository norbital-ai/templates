import { Decimal } from '@norbital-ai/std/decimal';
import type { StoredRow } from '@norbital-ai/bolt';
import type { ContractVersion } from './agreements.js';

type SnapshotLine = ContractVersion['snapshot']['lines'][number];

/** The physical Kingdee entry survives when an imported line needs a new local editor ID. */
export const contractEntryId = (contract: ContractVersion, line: SnapshotLine) =>
	line.source_entry_id ??
	contract.kingdee?.entries?.find((entry) => entry.local_line_id === line.id)?.entry_id ??
	null;

export function draftLineTarget(
	contract: ContractVersion,
	line: Pick<StoredRow<'order_lines'>, 'id' | 'source_entry_id'>
) {
	return contract.snapshot.lines.find((target) =>
		line.source_entry_id
			? contractEntryId(contract, target) === line.source_entry_id
			: target.id === line.id
	);
}

export function draftLineMatches(
	contract: ContractVersion,
	target: SnapshotLine,
	line: Pick<
		StoredRow<'order_lines'>,
		'product' | 'unit' | 'source_entry_id' | 'quantity' | 'unit_price' | 'discount_pct' | 'tax_rate'
	>
) {
	return (
		line.product === target.product &&
		line.unit === target.unit &&
		(line.source_entry_id ?? null) === contractEntryId(contract, target) &&
		(['quantity', 'unit_price', 'discount_pct', 'tax_rate'] as const).every((field) =>
			Decimal.of(line[field]).eq(target[field])
		)
	);
}
