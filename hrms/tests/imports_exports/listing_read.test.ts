import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { listingRead } from '../../src/data/model/payroll_run/service/exports/salary_listing_download.ts';
import {
	sheetsOf,
	workbookOf
} from '../../src/data/model/payroll_run/service/exports/salary_listing_export.ts';
import { ENTITY, pack, packTerms, storedQuery, storedReader, uuid, workspace } from '../kit.ts';

const original = pack('ZZ', 'UTC', packTerms(2800), {}, [], []);
const [user] = original.sys_user ?? [];
const [profile] = original.employee_profile ?? [];
const [balance] = original.employee_balance ?? [];
const [employment] = original.employment ?? [];
const [terms] = original.contract_terms ?? [];
const [parameters] = original.statutory_parameters ?? [];
assert.ok(user && profile && balance && employment && terms && parameters);
const staff = Array.from({ length: 120 }, (_, index) => {
	const id = (part: number) => uuid(10000 + index * 10 + part);
	const name = `Worker ${index + 1}`;
	return {
		sys_user: { ...user, id: id(1), name, email: `worker${index + 1}@example.test` },
		employee_profile: { ...profile, id: id(2), user_id: id(1), name },
		employee_balance: { ...balance, id: id(3), employee_id: id(2) },
		employment: { ...employment, id: id(4), employee_id: id(2), employee_number: `W${index + 1}` },
		contract_terms: { ...terms, id: id(5), employment_id: id(4) },
		statutory_parameters: { ...parameters, id: id(6), employment_id: id(4) }
	};
});
const seed = {
	...original,
	sys_user: staff.map((person) => person.sys_user),
	employee_profile: staff.map((person) => person.employee_profile),
	employee_balance: staff.map((person) => person.employee_balance),
	employment: staff.map((person) => person.employment),
	contract_terms: staff.map((person) => person.contract_terms),
	statutory_parameters: staff.map((person) => person.statutory_parameters)
};

it.live('exports every payslip of a large run across read pages, once each', () =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.create': [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]
		});
		const { payroll_run } = yield* storedQuery(t, { payroll_run: { limit: 1 } });
		const [run] = payroll_run.rows;
		assert.ok(run);
		const read = yield* listingRead(storedReader(t), [run.id]);
		assert.equal(read.slips.length, 120);
		const sheets = sheetsOf(read);
		const [sheet] = sheets;
		assert.ok(sheet);
		assert.equal(new Set(sheet.people.map((person) => person.code)).size, 120);
		const ws = workbookOf(sheets).getWorksheet('FEB 2026');
		assert.ok(ws);
		assert.equal(ws.rowCount, 125);
		assert.equal(ws.getRow(125).getCell(4).value, 'TOTAL');
	}).pipe(Effect.provide(workspace({ seed, now: '2026-03-05T02:00:00.000Z' })))
);
