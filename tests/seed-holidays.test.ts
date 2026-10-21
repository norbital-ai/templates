import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from '@effect/vitest';
import type { BankReader } from '@norbital-ai/bolt';
import seed from '../seed/seed.ts';

const BANK = resolve(import.meta.dirname, '../../../seed_bank/norbital_hr');

it.skipIf(!existsSync(BANK))(
	'sample entities keep their bank holidays and take later years from the jurisdiction calendar',
	async () => {
		const bank: BankReader = {
			tree: BANK,
			has: (path) => existsSync(resolve(BANK, path)),
			json: (path) => JSON.parse(readFileSync(resolve(BANK, path), 'utf8')),
			bytes: (path) => readFileSync(resolve(BANK, path)),
			files: (dir = '') =>
				readdirSync(resolve(BANK, dir), { recursive: true, withFileTypes: true })
					.filter((entry) => entry.isFile())
					.map((entry) => resolve(entry.parentPath, entry.name).slice(BANK.length + 1))
					.toSorted()
		};
		const rows = await seed.rows(bank);
		const holidays = rows['holiday'] ?? [];
		const of = (company: string) => holidays.filter((row) => row['company_id'] === company);
		// MY (Nihon, Johor): the bank chose its 2026 holidays; 2027 comes from the gazette, regional days only where
		// Johor is named
		const nihon = of('e7b313fc-e947-5b78-8066-97bea6644915');
		assert.ok(
			nihon.some((row) => row['date'] === '2026-03-23'),
			"the bank's Johor holiday stays"
		);
		assert.ok(nihon.some((row) => row['date'] === '2027-08-31' && row['published_at'] != null));
		assert.ok(
			nihon.some((row) => row['date'] === '2027-02-07'),
			'Johor observes the second day of CNY'
		);
		assert.ok(
			!nihon.some((row) => row['date'] === '2027-05-18'),
			'a day not gazetted for Johor stays out'
		);
		// one row per entity and day
		for (const company of new Set(holidays.map((row) => String(row['company_id']))))
			assert.equal(
				new Set(of(company).map((row) => row['date'])).size,
				of(company).length,
				`${company} has one holiday per day`
			);
	}
);
