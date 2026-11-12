import type { Decimal } from '@norbital-ai/std/decimal';

/** The statement fields of a holding the figures read. */
export type Statement = {
	readonly value_base: Decimal;
	readonly market_value: Decimal;
	readonly cost_value: Decimal | null;
	readonly live_value_base: Decimal | null;
};

export const round = (value: number, places = 2) => {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
};

/** What a line is worth now: its calculated value once the agent priced it, else the statement's. */
export const lineValue = (row: Statement) => (row.live_value_base ?? row.value_base).to_number();

/** What a line cost in base currency: its local cost at the statement's own rate. */
export const costInBase = (row: Statement) => {
	const local = row.cost_value?.to_number() ?? 0;
	const market = row.market_value.to_number();
	const base = row.value_base.to_number();
	return round(market > 0 && base > 0 ? local * (base / market) : local);
};

/** Cash and facilities are lines of the book, but not positions to analyse. */
export const isPosition = (row: { readonly asset_class: string }) =>
	row.asset_class !== 'cash' && row.asset_class !== 'loan';

/** One line as the totals read it: its value now in base currency and its statement P&L. */
export type BookLine = {
	readonly asset_class: string;
	readonly value: number;
	readonly unrealised_pl: number;
};

export type Metrics = {
	readonly total_assets: number;
	readonly invested: number;
	readonly cash: number;
	readonly liabilities: number;
	readonly net_assets: number;
	readonly unrealised_pl: number;
	readonly allocation: readonly { label: string; value: number; weight: number }[];
};

/** The book's totals and allocation; the report and the dashboard both read these. */
export const computeMetrics = (rows: readonly BookLine[]): Metrics => {
	let cash = 0;
	let invested = 0;
	let liabilities = 0;
	let unrealised = 0;
	const byClass = new Map<string, number>();
	for (const row of rows) {
		const value = row.value;
		if (row.asset_class === 'cash') cash += value;
		else if (row.asset_class === 'loan') liabilities -= value;
		else {
			invested += value;
			byClass.set(row.asset_class, (byClass.get(row.asset_class) ?? 0) + value);
		}
		unrealised += row.unrealised_pl;
	}
	const total = cash + invested;
	const weight = (value: number) => (total > 0 ? round((value / total) * 100, 1) : 0);
	return {
		total_assets: round(total),
		invested: round(invested),
		cash: round(cash),
		liabilities: round(liabilities),
		net_assets: round(total - liabilities),
		unrealised_pl: round(unrealised),
		allocation: [['cash', cash] as const, ...byClass]
			.filter(([, value]) => value !== 0)
			.map(([label, value]) => ({ label, value: round(value), weight: weight(value) }))
			.sort((a, b) => b.value - a.value)
	};
};
