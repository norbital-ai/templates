import { BigDecimal } from 'effect';
import { type D, type DecimalLike, dec, text } from './values.js';
/** A total is unknown if any constituent transaction lacks its consumed-lot cost. */
export function marginSeries(
	rows: readonly {
		owner: string | null;
		source_owner?: string | null;
		owner_name: string;
		currency: string;
		net?: DecimalLike | null;
		margin?: DecimalLike | null;
	}[]
) {
	const groups = new Map<
		string,
		{
			currency: string;
			salesperson: string;
			margin: D;
			unknown: boolean;
		}
	>();
	for (const row of rows) {
		const key = `${row.owner ?? row.source_owner ?? ''}/${row.currency}`;
		const group = groups.get(key) ?? {
			currency: row.currency,
			salesperson: row.owner_name,
			margin: dec(0),
			unknown: false
		};
		if (row.margin == null) group.unknown = true;
		else group.margin = BigDecimal.sum(group.margin, dec(row.margin));
		groups.set(key, group);
	}
	return [...groups.values()].map((row) => ({
		currency: row.currency,
		salesperson: row.salesperson,
		margin: row.unknown ? null : text(row.margin)
	}));
}
