/**
 * Elections are declared on the scheme row and read as `scheme.elections.<key>`: the scheme write
 * refuses a formula or rule naming a key the row does not declare, and the fact write refuses a
 * value under an undeclared key or of another type than declared.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import schemes from '../src/collections/statutory_contributions/+collection.ts';
import facts from '../src/collections/employment_statutory_facts/+collection.ts';
import { transformOne } from './helpers/transform.ts';

const scheme = {
	id: 'pcb',
	settings_id: 'draft',
	code: 'PCB',
	elections: [{ key: 'disabled', type: 'boolean' }],
	assessed_on: 'BASE',
	rules: [{ when: 'scheme.elections.disabled', employee: '0.0', employer: '0.0' }]
};

const db = {
	jurisdiction_settings: {
		findMany: ({ where }: { where: { id: { in: readonly string[] } } }) =>
			Effect.succeed(
				where.id.in.map((id) => ({ id, code: 'PUB', name: 'Public fixture', sealed_at: null }))
			)
	},
	statutory_contributions: {
		findMany: ({ where }: { where: Record<string, unknown> }) =>
			Effect.succeed('id' in where ? [scheme] : [])
	},
	allowance_catalogue: { findMany: () => Effect.succeed([]) },
	adhoc_catalogue: { findMany: () => Effect.succeed([]) },
	claim_catalogue: { findMany: () => Effect.succeed([]) },
	loan_catalogue: { findMany: () => Effect.succeed([]) },
	leave_catalogue: { findMany: () => Effect.succeed([]) }
};

const writeScheme = (input: Record<string, unknown>) => transformOne(schemes, input, undefined, db);
const writeFact = (status: Record<string, unknown>) =>
	transformOne(
		facts,
		{ employee_id: 'e', statutory_contribution_id: 'pcb', status },
		undefined,
		db
	);

test('a scheme write refuses a rule or formula reading an election the row does not declare', () => {
	// A declared boolean is typed as one at compile, so a bare `scheme.elections.disabled` is a
	// boolean `when` — and `&& scheme.elections.x`, as the SG ladders read an opt-in, compiles.
	assert.doesNotThrow(() => writeScheme(scheme));
	assert.doesNotThrow(() =>
		writeScheme({
			...scheme,
			rules: [{ when: 'base > 0.0 && scheme.elections.disabled', employee: '0.0', employer: '0.0' }]
		})
	);
	assert.throws(
		() =>
			writeScheme({
				...scheme,
				rules: [{ when: 'scheme.elections.zakat > 0.0', employee: '0.0', employer: '0.0' }]
			}),
		/Rule 1: .*reads scheme.elections.zakat, which the scheme does not declare/
	);
	assert.throws(
		() => writeScheme({ ...scheme, assessed_on: 'BASE + scheme.elections.extra' }),
		/Assessed-on: .*reads scheme.elections.extra/
	);
	// A declared type is the type the value is checked as: a boolean used as money is refused.
	assert.throws(
		() =>
			writeScheme({
				...scheme,
				rules: [{ when: 'true', employee: 'scheme.elections.disabled', employer: '0.0' }]
			}),
		/Rule 1 employee: .*must produce a money amount/
	);
});

test('a fact write refuses an election the scheme does not declare, or of another type', () => {
	const registered = { kind: 'REGISTERED', reference_number: 'R', rate_override: null };
	assert.doesNotThrow(() => writeFact(registered));
	assert.doesNotThrow(() => writeFact({ ...registered, elections: { disabled: true } }));
	assert.throws(
		() => writeFact({ ...registered, elections: { zakat: 100 } }),
		/PCB does not declare the election zakat/
	);
	assert.throws(
		() => writeFact({ ...registered, elections: { disabled: 'yes' } }),
		/declares the election disabled as a boolean; this value is a string/
	);
});
