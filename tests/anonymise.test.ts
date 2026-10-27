import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Effect, Schema } from 'effect';
import { employer, employment, profile, world } from './jurisdiction_kit.js';

const endedEmployment = () => {
	const tables = employer([{ key: 'a', salary: 3000 }]);
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

for (const [name, now, accepted] of [
	[
		'retains every personal field before the configured retention date',
		'2025-03-31T12:00:00.000Z',
		false
	],
	[
		'anonymises the profile and contracts through one guarded automation batch',
		'2027-03-31T12:00:00.000Z',
		true
	]
] as const)
	it.effect(name, () =>
		world(endedEmployment(), now).withRead(() =>
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
				const { profile: beforeProfile, contract: beforeContract } = yield* records();
				const started = yield* hr.start('employment_profile_anonymise', { employee: profile('a') });
				assert.equal(started.kind, 'committed');
				if (started.kind !== 'committed') throw new Error('The anonymisation run was not queued.');
				yield* t.runDue();
				const [run] = yield* t.db.rows(Run, {
					text: 'SELECT state, error FROM sys_run WHERE id = $1',
					params: [started.output.id]
				});
				assert.ok(run, 'The started automation has a native run.');
				const { profile: afterProfile, contract: afterContract } = yield* records();
				if (!accepted) {
					assert.equal(run.state, 'failed');
					assert.match(run.error?.message ?? '', /The records are kept until 2026-03-31/);
					assert.deepEqual(afterProfile, beforeProfile);
					assert.deepEqual(afterContract, beforeContract);
					return;
				}
				assert.equal(run.state, 'succeeded', JSON.stringify(run.error));
				assert.equal(run.error, null);
				assert.ok(afterProfile && afterContract);
				assert.equal(afterProfile.name, 'Former employee');
				assert.equal(afterProfile.email, null);
				assert.equal(afterProfile.anonymised_at, now);
				assert.equal(afterContract.bank, null);
				assert.equal(afterContract.comments, null);
				assert.deepEqual(afterContract.facts, beforeContract?.facts);
				assert.deepEqual(afterContract.effective_range, beforeContract?.effective_range);
			})
		)
	);
