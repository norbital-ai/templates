// A payroll period can be a month or a part of one; annual statutory duties read the month the run covers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

const effects = JSON.parse(
	readFileSync(
		new URL('../seed/public/jurisdiction/ID/version_3/registered_effect.json', import.meta.url),
		'utf8'
	)
) as readonly {
	readonly code: string;
	readonly condition: string;
	readonly effects: string;
	readonly lookup?: Record<string, unknown>;
}[];
const condition = (code: string) => {
	const row = effects.find((item) => item.code === code);
	assert.ok(row !== undefined);
	return row.condition;
};
const holds = (code: string, period: string, from: string) => {
	const entry = { period, salary_coverage: { from, to: from } };
	return evaluate(condition(code), 'CALCULATION', { entry }, code) === true;
};

describe('Indonesian annual effects across part-period runs', () => {
	it('December is the annual release whatever the part key', () => {
		assert.equal(holds('PPH21_BPA1_YEAR_END', '2026-12', '2026-12-01'), true);
		assert.equal(holds('PPH21_BPA1_YEAR_END', '2026-12-2', '2026-12-11'), true);
		assert.equal(holds('PPH21_BPA1_YEAR_END', '2026-12-3', '2026-12-21'), true);
		assert.equal(holds('PPH21_BPA1_YEAR_END', '2026-11-2', '2026-11-11'), false);
	});
	it('January is the annual opening whatever the part key', () => {
		for (const code of [
			'PTKP_STATUS_ANNUAL',
			'MINIMUM_WAGE_COMPLIANCE',
			'WORKER_HEALTH_EXAMINATION'
		]) {
			assert.equal(holds(code, '2026-01-1', '2026-01-01'), true, code);
			assert.equal(holds(code, '2026-01-3', '2026-01-21'), true, code);
			assert.equal(holds(code, '2026-02-1', '2026-02-01'), false, code);
		}
	});
});

const effectOf = (code: string) => {
	const row = effects.find((item) => item.code === code);
	assert.ok(row !== undefined);
	return row;
};
const raised = (
	code: string,
	from: string,
	to = from,
	reads: Record<string, unknown> = { obligation: [] }
) =>
	evaluate(
		effectOf(code).effects,
		'CALCULATION',
		{
			lookup: effectOf(code).lookup ?? {},
			entry: { entity_id: 'entity-1', salary_coverage: { from, to } },
			reads
		},
		code
	) as readonly { title: string; due_on: string; occurrence_key: string }[];

describe('Indonesian annual obligations across part-period runs', () => {
	it('one BPA1 per entity and tax year, due 31 January', () => {
		const first = raised('PPH21_BPA1_YEAR_END', '2026-12-11', '2026-12-20');
		assert.equal(first.length, 1);
		assert.equal(first[0]?.due_on, '2027-01-31');
		const again = raised('PPH21_BPA1_YEAR_END', '2026-12-21', '2026-12-31', {
			obligation: first
		});
		assert.equal(again.length, 0);
	});
	it('each January duty is one obligation, whatever the part', () => {
		for (const code of [
			'PTKP_STATUS_ANNUAL',
			'MINIMUM_WAGE_COMPLIANCE',
			'DISABILITY_QUOTA_REVIEW',
			'WORKER_HEALTH_EXAMINATION'
		]) {
			const first = raised(code, '2026-01-01', '2026-01-10', {
				obligation: [],
				employee_contract: []
			});
			assert.equal(first.length, 1, code);
			const again = raised(code, '2026-01-11', '2026-01-20', {
				obligation: first,
				employee_contract: []
			});
			assert.equal(again.length, 0, code);
		}
	});
	it('K3 and the wage structure are one-time entity duties', () => {
		const profile = {
			status: 'SEALED',
			effective_range: { from: '2026-01-01', to: null },
			entity_extension_data: { k3_high_hazard: true }
		};
		const k3 = raised('K3_SMK3_P2K3', '2026-01-01', '2026-01-10', {
			obligation: [],
			employee_contract: [],
			entity_profile_version: [profile]
		});
		assert.equal(k3.length, 1);
		const k3Again = raised('K3_SMK3_P2K3', '2027-05-01', '2027-05-10', {
			obligation: k3,
			employee_contract: [],
			entity_profile_version: [profile]
		});
		assert.equal(k3Again.length, 0);
		const wage = raised('WAGE_STRUCTURE_SCALE', '2026-01-01', '2026-01-10');
		assert.equal(wage.length, 1);
		assert.equal(
			raised('WAGE_STRUCTURE_SCALE', '2027-05-01', '2027-05-10', { obligation: wage }).length,
			0
		);
	});
	it('the annual tax-records task no longer exists', () => {
		assert.equal(effects.some((row) => row.code === 'TAX_RECORDS_RETENTION'), false);
	});
});
