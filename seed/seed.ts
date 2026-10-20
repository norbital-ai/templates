import type { BankReader, SeedSource } from '@norbital-ai/bolt';
import { Schema } from 'effect';
import commercial_settings from './commercial_settings.json';
import document_templates from './document_templates.json';
import parties from './parties.json';
import products from './products.json';
import warehouses from './warehouses.json';

const PUBLIC = { commercial_settings, document_templates, parties, products, warehouses };
const Rows = Schema.Array(Schema.Record(Schema.String, Schema.Json));
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
			const supplied = Schema.decodeUnknownSync(Rows)(bank.json(file));
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
