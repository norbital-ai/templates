import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Instant } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { employer, employment, profile, world } from './jurisdiction_kit.js';

// only what the retention guard reads: the version and its retention rule, the entity, the person and the employment
const KEPT = ['jurisdiction_settings', 'rule_set', 'entity', 'employment_profile', 'employment_contract'];
const endedEmployment = () => {
	const tables = new Map(
		[...employer([{ key: 'a', salary: 3000 }])].filter(([name]) => KEPT.includes(name))
	);
	tables.set(
		'rule_set',
		(tables.get('rule_set') ?? []).filter((row) => row.code === 'record_retention')
	);
	tables.set(
		'employment_contract',
		(tables.get('employment_contract') ?? []).map((contract) => ({
			...contract,
			effective_range: { from: '2020-01-01', to: '2020-03-31' },
			bank: {
				bank_name: 'Fixture bank',
				bank_code: 'FIX',
				bank_account_number: '12345',
				bank_account_name: 'Person a'
			},
			comments: 'Private employment notes'
		}))
	);
	return tables;
};
const Run = Schema.Struct({
	state: Schema.String,
	error: Schema.NullOr(Schema.Struct({ message: Schema.String }))
});

it.effect(
	'anonymisation is refused until the retention date, then clears both records in one guarded batch',
	() =>
		world(endedEmployment(), '2025-03-31T12:00:00.000Z').withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const records = () =>
					hr
						.query({
							employment_profile: { where: { id: { eq: profile('a') } } },
							employment_contract: { where: { id: { eq: employment('a') } } }
						})
						.pipe(
							Effect.map((got) => ({
								profile: got.employment_profile.rows[0],
								contract: got.employment_contract.rows[0]
							}))
						);
				const before = yield* records();
				// the retention guard is the profile's own write callback: a direct write before the date is refused
				const early = yield* Effect.flip(
					hr.act('employment_profile.update', [
						{ target: profile('a'), set: { anonymised_at: Instant('2025-03-31T12:00:00.000Z') } }
					])
				);
				assert.match(early.message, /The records are kept until 2026-03-31/);

				const now = '2027-03-31T12:00:00.000Z';
				t.clock.set(now);
				const started = yield* hr.start('employment_profile_anonymise', { employee: profile('a') });
				if (started.kind !== 'committed') throw new Error('The anonymisation run was not queued.');
				yield* t.runDue();
				const [run] = yield* t.db.rows(Run, {
					text: 'SELECT state, error FROM sys_run WHERE id = $1',
					params: [started.output.id]
				});
				assert.equal(run?.state, 'succeeded', JSON.stringify(run?.error));
				const { profile: afterProfile, contract: afterContract } = yield* records();
				assert.ok(afterProfile && afterContract);
				assert.equal(afterProfile.name, 'Former employee');
				assert.equal(afterProfile.email, null);
				assert.equal(afterProfile.anonymised_at, now);
				assert.equal(afterContract.bank, null);
				assert.equal(afterContract.comments, null);
				assert.deepEqual(afterContract.facts, before.contract?.facts);
				assert.deepEqual(afterContract.effective_range, before.contract?.effective_range);
			})
		)
);
