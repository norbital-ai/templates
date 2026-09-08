import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import hooks from '../src/collections/employments/+hooks.ts';
import {
	assertContractDoesNotOverlap,
	resolveEmployment,
	boundToContract,
	type ContractCandidate
} from '../src/lib/employment-contract.ts';

const contract = (overrides: ContractCandidate = {}): ContractCandidate => ({
	id: 'a',
	employee_id: 'person',
	company_id: 'entity-a',
	hire_date: '2026-01-01',
	effective_range: { start: '2026-01-01T00:00:00.000Z', end: null },
	...overrides
});

test('one person cannot hold overlapping active contracts in one entity, including future contracts', () => {
	for (const hire_date of ['2026-01-01', '2026-06-01', '2027-01-01'])
		assert.throws(
			() =>
				assertContractDoesNotOverlap(
					contract({
						id: 'b',
						hire_date,
						effective_range: { start: `${hire_date}T00:00:00.000Z`, end: null }
					}),
					[contract()]
				),
			/already has an active employment contract/
		);
});

test('contracts for other entities or other employees remain independent', () => {
	assert.doesNotThrow(() =>
		assertContractDoesNotOverlap(contract({ company_id: 'entity-b' }), [contract()])
	);
	assert.doesNotThrow(() =>
		assertContractDoesNotOverlap(contract({ employee_id: 'someone-else' }), [contract()])
	);
});

test('departure is the last active day; a same-entity rehire starts on the following day', () => {
	const previous = contract({ exit_date: '2026-05-31', exit_reason: 'RESIGNATION' });
	assert.throws(
		() => assertContractDoesNotOverlap(contract({ id: 'b', hire_date: '2026-05-31' }), [previous]),
		/already has an active/
	);
	assert.doesNotThrow(() =>
		assertContractDoesNotOverlap(contract({ id: 'b', hire_date: '2026-06-01' }), [previous])
	);
});

test('fixed service periods permit a later contract and refuse inverted dates', () => {
	const previous = contract({
		effective_range: { start: '2026-01-01T00:00:00.000Z', end: '2026-05-31T00:00:00.000Z' }
	});
	assert.doesNotThrow(() =>
		assertContractDoesNotOverlap(contract({ id: 'b', hire_date: '2026-06-01' }), [previous])
	);
	assert.throws(
		() =>
			assertContractDoesNotOverlap(
				contract({
					hire_date: '2026-06-01',
					effective_range: { start: '2026-01-01T00:00:00.000Z', end: '2026-05-31T00:00:00.000Z' }
				}),
				[]
			),
		/cannot end before/
	);
});

test('departure resolves the service window without editing the signed contract', () => {
	const original = contract({ exit_date: '2026-05-31', exit_reason: 'MISCONDUCT' });
	const resolved = resolveEmployment({ ...original, effective_range: original.effective_range });
	assert.equal(resolved.exit_date, '2026-05-31');
	assert.deepEqual(original.effective_range, { start: '2026-01-01T00:00:00.000Z', end: null });
	assert.equal(resolved.exit_reason, 'MISCONDUCT');
});

test('every event names its contract and an existing event cannot change contracts', () => {
	assert.deepEqual(boundToContract({ employment_id: 'a' }), { employment_id: 'a' });
	assert.throws(() => boundToContract({}), /must reference an employment contract/);
	assert.throws(
		() => boundToContract({ employment_id: 'b' }, { employment_id: 'a' }),
		/cannot move/
	);
	assert.deepEqual(boundToContract({}, { employment_id: 'a' }), {});
});

test('nested contracts bind their employee before checking existing and sibling contracts', () => {
	const { employee_id: _employee, id: _id, ...input } = contract();
	const parent = { collection: 'employees', column: 'employee_id', id: 'person', values: {} };
	const run = (inputs: ContractCandidate[], stored: ContractCandidate[] = []) => {
		const api = {
			db: {
				employments: {
					findMany: ({ where }) =>
						Effect.succeed(
							stored.filter(
								(row) =>
									(where.employee_id == null || where.employee_id.in.includes(row.employee_id)) &&
									(where.company_id == null || where.company_id.in.includes(row.company_id))
							)
						),
					findPending: () => Effect.succeed([])
				}
			}
		};
		const prepared = Effect.runSync(hooks.mutate.prepare({ inputs, api }));
		return Effect.runSync(
			hooks.mutate.perRecord.before.handler({
				input: inputs[0],
				existing: undefined,
				recordId: 'new-contract',
				parent,
				prepared,
				api
			})
		);
	};
	assert.equal(run([input]).employee_id, parent.id);
	assert.throws(() => run([input], [contract()]), /already has an active/);
	assert.throws(() => run([input, { ...input, id: 'second' }]), /already has an active/);
	assert.throws(() => run([{ ...input, employee_id: 'different-person' }]), /enclosing/);
});
