import { Decimal, type DecimalLike } from '@norbital-ai/std/decimal';
/** A total is unknown if any constituent transaction lacks its consumed-lot cost. */
export function marginSeries(
	rows: readonly {
		owner: string;
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
			margin: Decimal;
			unknown: boolean;
		}
	>();
	for (const row of rows) {
		const key = `${row.owner}/${row.currency}`;
		const group = groups.get(key) ?? {
			currency: row.currency,
			salesperson: row.owner_name,
			margin: Decimal.of(0),
			unknown: false
		};
		if (row.margin == null) group.unknown = true;
		else group.margin = group.margin.plus(row.margin);
		groups.set(key, group);
	}
	return [...groups.values()].map((row) => ({
		currency: row.currency,
		salesperson: row.salesperson,
		margin: row.unknown ? null : row.margin.toString()
	}));
}
