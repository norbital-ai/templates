import type { BankReader } from '@norbital-ai/bolt';
import { expect, it } from '@effect/vitest';
import source from '../seed/seed.js';

it('preserves seeded mobile numbers and explicit inactive membership without adding public people', async () => {
	const users = [
		{
			id: '019f8a40-0000-7000-8000-000000000101',
			name: 'Synthetic controller',
			email: 'controller@example.test',
			phone: '+6581234567',
			status: 'admin',
			team_id: '019f8a40-0000-7000-8000-000000000001'
		},
		{
			id: '019f8a40-0000-7000-8000-000000000102',
			name: 'Synthetic inactive contractor',
			phone: '+6587654321',
			active: false,
			team_id: '019f8a40-0000-7000-8000-000000000002'
		},
		{
			id: '019f8a40-0000-7000-8000-000000000103',
			name: 'Synthetic member without mobile'
		}
	];
	const files = new Map([
		['sites.json', '[]'],
		['user.json', JSON.stringify(users)]
	]);
	const contents = (path: string) => {
		const value = files.get(path);
		if (value === undefined) throw new Error(`Missing synthetic bank file: ${path}`);
		return value;
	};
	const bank: BankReader = {
		tree: 'synthetic',
		has: (path) => files.has(path),
		json: (path) => JSON.parse(contents(path)),
		bytes: (path) => new TextEncoder().encode(contents(path)),
		files: () => [...files.keys()]
	};
	const rows = await source.rows(bank);
	expect(rows['sys_user']).toMatchObject([
		{ id: users[0]!.id, phone: '+6581234567', active: true, admin: true },
		{ id: users[1]!.id, phone: '+6587654321', active: false, admin: false },
		{ id: users[2]!.id, phone: null, active: true, admin: false }
	]);
	expect(await source.rows({ ...bank, has: () => false })).toMatchObject({ sys_user: [] });
});
