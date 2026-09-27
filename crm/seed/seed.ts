import type { SeedSource } from '@norbital-ai/bolt';

type Row = { readonly [field: string]: unknown };
/**
 * The `crm` bank tree: one `<collection>.json` per collection, read as is, except that an activity's
 * `regarding_type`/`regarding_id` pair becomes its `regarding` reference, and `product_unit_cost_cny.json` (a cost
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
		return out as never;
	}
} satisfies SeedSource;
