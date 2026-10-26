import type { BankReader } from '@norbital-ai/bolt';
import { expect, it } from '@effect/vitest';
import source from '../seed/seed.js';

it('maps synthetic bank members to mobile numbers, active state and team handles', async () => {
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
		json: (path): unknown => {
			const value: unknown = JSON.parse(contents(path));
			return value;
		},
		bytes: (path) => new TextEncoder().encode(contents(path)),
		files: () => [...files.keys()]
	};
	const rows = await source.rows(bank);
	expect(rows['sys_user']).toMatchObject([
		{
			id: users[0]!.id,
			phone: '+6581234567',
			active: true,
			admin: true,
			team: 'field_ops_controllers'
		},
		{ id: users[1]!.id, phone: '+6587654321', active: false, admin: false, team: 'contractors' },
		{ id: users[2]!.id, phone: null, active: true, admin: false, team: null }
	]);
	expect(await source.rows({ ...bank, has: () => false })).toMatchObject({ sys_user: [] });
	// a bank team no handle maps is a build failure, never a member silently left without a team
	files.set(
		'user.json',
		JSON.stringify([{ ...users[2], team_id: '019f8a40-0000-7000-8000-000000000004' }])
	);
	expect(() => source.rows(bank)).toThrow(/no team handle maps/);
});
