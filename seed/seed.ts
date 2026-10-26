import type { BankReader, SeedSource } from '@norbital-ai/bolt';
import { Schema } from 'effect';
import commercial_settings from './commercial_settings.json';
import document_templates from './document_templates.json';
import parties from './parties.json';
import products from './products.json';
import warehouses from './warehouses.json';

const PUBLIC = { commercial_settings, document_templates, parties, products, warehouses };
const Rows = Schema.Array(Schema.Record(Schema.String, Schema.Json));
/** The bank names members' teams by label; the workspace holds them by handle. */
const TEAMS: Readonly<Record<string, string>> = {
	Sales: 'sales',
	Procurement: 'procurement',
	'Commercial Managers': 'commercial_managers',
	Finance: 'finance',
	Logistics: 'logistics',
	Configurators: 'configurators'
};
const withHandle = (row: Record<string, Schema.Json>) => {
	if (row.team === undefined || row.team === null) return row;
	const handle = TEAMS[Schema.decodeUnknownSync(Schema.String)(row.team)];
	if (handle === undefined) throw new Error(`Unknown sample team ${String(row.team)}.`);
	return { ...row, team: handle };
};
const collections = [
	'sys_user',
	'parties',
	'products',
	'warehouses',
	'orders',
	'order_lines',
	'credit_snapshots',
	'stock_snapshots',
	'pricing_floors',
	'commission_rules'
] as const;

/** Private native sample rows extend the public defaults; identities and source facts stay in the bank. */
const source = {
	bank: 'trade-operations',
	rows(bank: Pick<BankReader, 'has'> & { json(path: string): unknown }) {
		const rows: Record<string, readonly Record<string, Schema.Json>[]> = { ...PUBLIC };
		for (const collection of collections) {
			const file = `${collection}.json`;
			if (!bank.has(file)) continue;
			const decoded = Schema.decodeUnknownSync(Rows)(bank.json(file));
			const supplied = collection === 'sys_user' ? decoded.map(withHandle) : decoded;
			const merged = new Map((rows[collection] ?? []).map((row) => [row.id, row]));
			const ids = new Set<string>();
			for (const row of supplied) {
				const id = Schema.decodeUnknownSync(Schema.String)(row.id);
				if (ids.has(id)) throw new Error(`Duplicate sample identity in ${collection}.`);
				ids.add(id);
				merged.set(id, row);
			}
			rows[collection] = [...merged.values()];
		}
		return rows;
	}
} satisfies SeedSource;

export default source;
