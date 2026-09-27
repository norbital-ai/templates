/** The public `base` pack is this template's invented fixtures only; the bank's rows ship in the private sample (L-TPL-ALL-004). */
import { expect, it } from 'vitest';
import { workspace } from './kit.ts';

it('restores the public base pack: one invented account, contact and product', async () => {
	const t = await workspace();
	const admin = t.as(t.admin);
	const codes = async (c: string, f: string) =>
		(await admin.read(c, { all: true })).rows.map((r) => r[f]);
	expect(await codes('accounts', 'external_code')).toEqual(['PUB-ACC-0001']);
	expect(await codes('contacts', 'email')).toEqual(['ada.fixture@example.test']);
	expect(await codes('products', 'code')).toEqual(['PUB-WIDGET']);
	expect(await codes('quotes', 'id')).toEqual([]);
});
