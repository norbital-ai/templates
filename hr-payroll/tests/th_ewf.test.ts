// EWF is not collected before 1 January 2027, and a run with no positive EWF line raises no remittance.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { ENTITY, pack, workspace } from './kit.ts';

const terms = {
	rate: { amount: 30_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'ORDINARY',
	work_classification: 'EA_COVERED',
	residency_status: 'RESIDENT',
	wage_payment_method: 'BANK',
	allowances: {}
};
const base = pack('TH', 'Asia/Bangkok', terms, {}, [], [], '2026-11-15');
const from = (row: (typeof base)[string][number]) =>
	Schema.decodeUnknownSync(Schema.Struct({ from: Schema.String }))(row.effective_range).from;
const last = (base.jurisdiction_settings ?? []).map(from).sort().at(-1);
const withStanding = (kind: 'MEMBER' | 'NONE' | 'VOLUNTARY', exempt = false) => ({
	...base,
	// the seeded law stops with November 2026; the version that names the collection date carries on past it
	jurisdiction_settings: (base.jurisdiction_settings ?? []).map((row) =>
		from(row) === last ? { ...row, effective_range: { from: last, to: null } } : row
	),
	entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
		...row,
		entity_extension_data: { ewf_exempt: exempt, wcf_rate_percent: 0.2 }
	})),
	employee_contract: (base.employee_contract ?? []).map((row) => ({
		...row,
		employee_extension_data: {
			statutory: { PVD: { kind: 'NONE' }, EWF: { kind } }
		}
	}))
});
const remittance = (standing: 'MEMBER' | 'NONE' | 'VOLUNTARY', period: string, exempt = false) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* t
			.as(t.admin)
			.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }]);
		yield* t.runDue();
		const { obligation } = yield* t.storedQuery({ obligation: { limit: 300 } });
		return obligation.rows.filter((row) =>
			String(row.occurrence_key).startsWith('EWF_REMITTANCE:')
		);
	}).pipe(
		Effect.provide(
			workspace({ seed: withStanding(standing, exempt), now: '2027-01-20T02:00:00.000Z' })
		)
	);

describe('Employee Welfare Fund remittance', () => {
	it.live('December 2026 has no collection even for a member', () =>
		Effect.gen(function* () {
			assert.equal((yield* remittance('MEMBER', '2026-12')).length, 0);
		})
	);
	it.live('January 2027 raises one remittance, due 15 February', () =>
		Effect.gen(function* () {
			const rows = yield* remittance('MEMBER', '2027-01');
			assert.equal(rows.length, 1);
			assert.equal(String(rows[0]?.due_on), '2027-02-15');
		})
	);
	it.live('a member who is exempt raises none', () =>
		Effect.gen(function* () {
			assert.equal((yield* remittance('MEMBER', '2027-01', true)).length, 0);
		})
	);
	it.live('a non-member raises none', () =>
		Effect.gen(function* () {
			assert.equal((yield* remittance('NONE', '2027-01')).length, 0);
		})
	);
});
