import sys_channel_connection from './sys_channel_connection.json' with { type: 'json' };
import sys_envoy_channel from './sys_envoy_channel.json' with { type: 'json' };
import sys_envoy from './sys_envoy.json' with { type: 'json' };
import type { SeedSource } from '@norbital-ai/bolt';

type Row = { readonly [field: string]: unknown };
/**
 * The `crm` bank tree: one `<collection>.json` per collection, read as is, except that an activity's
 * `regarding_type`/`regarding_id` pair becomes its `regarding` reference, a line takes its document's currency (its
 * money reads in it), a product keeps the bank's `currency` when its row has one (else the model default, the
 * workspace's), and `product_unit_cost_cny.json` (a cost
 * lookup the purchase lines were priced from, not a collection) stays in the bank. With no bank (the public `base`
 * pack) the rows are this directory's invented `<collection>.json` fixtures; no bank row ships publicly.
 */
const PUBLIC = import.meta.glob<Row[]>('./*.json', { eager: true, import: 'default' });

export default {
	bank: 'crm',
	rows(bank) {
		const out: { [collection: string]: Row[] } = {};
		const files: [string, Row[]][] = bank.has('accounts.json')
			? bank
					.files()
					.filter((f) => /^[a-z_]+\.json$/.test(f) && f !== 'product_unit_cost_cny.json')
					.map((f) => [f, bank.json<Row[]>(f)])
			: Object.entries(PUBLIC).map(([path, rows]) => [path.slice(2), rows]);
		for (const [file, rows] of files) {
			const name = file.slice(0, -'.json'.length);
			if (name === 'team')
				out['sys_team'] = rows.map((r) => ({ id: r['id'], name: r['name'], parent: null }));
			else if (name === 'user')
				out['sys_user'] = rows.map((r) => ({
					id: r['id'],
					name: r['name'],
					email: r['email'] ?? null,
					kind: 'staff',
					admin: r['status'] === 'admin',
					team: r['team_id'] ?? null
				}));
			else if (name === 'activities')
				out[name] = rows.map(({ regarding_type, regarding_id, ...r }) => ({
					...r,
					regarding: { collection: regarding_type, id: regarding_id }
				}));
			else out[name] = rows as Row[];
		}
		for (const [lines, docs, fk] of [
			['quote_lines', 'quotes', 'quote_id'],
			['purchase_order_lines', 'purchase_orders', 'purchase_order_id']
		] as const) {
			const currency = new Map((out[docs] ?? []).map((d) => [d['id'], d['currency']]));
			if (out[lines]) out[lines] = out[lines].map((l) => ({ ...l, currency: currency.get(l[fk]) }));
		}
		return { ...out, sys_channel_connection, sys_envoy_channel, sys_envoy } as never;
	}
} satisfies SeedSource;
