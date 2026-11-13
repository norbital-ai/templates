import { BigDecimal } from 'effect';
/** A total is unknown if any constituent transaction lacks its consumed-lot cost. */
export function marginSeries(
	rows: readonly {
		owner: string | null;
		source_owner?: string | null;
		owner_name: string;
		currency: string;
		net?: string | null;
		margin?: string | null;
	}[]
) {
	const groups = new Map<
		string,
		{
			currency: string;
			salesperson: string;
			margin: BigDecimal.BigDecimal;
			unknown: boolean;
		}
	>();
	for (const row of rows) {
		const key = `${row.owner ?? row.source_owner ?? ''}/${row.currency}`;
		const group = groups.get(key) ?? {
			currency: row.currency,
			salesperson: row.owner_name,
			margin: BigDecimal.fromBigInt(0n),
			unknown: false
		};
		if (row.margin == null) group.unknown = true;
		else group.margin = BigDecimal.sum(group.margin, BigDecimal.fromStringUnsafe(row.margin));
		groups.set(key, group);
	}
	return [...groups.values()].map((row) => ({
		currency: row.currency,
		salesperson: row.salesperson,
		margin: row.unknown ? null : BigDecimal.format(row.margin)
	}));
}
