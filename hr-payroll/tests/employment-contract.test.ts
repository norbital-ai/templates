import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import employments from '../src/collections/employments/+collection.ts';
import { transformSync } from './helpers/transform.ts';
import {
	assertContractDoesNotOverlap,
	nextContractNumber,
	resolveEmployment,
	boundToContract,
	type ContractCandidate
} from '../src/lib/employment-contract.ts';

const contract = (overrides: ContractCandidate = {}): ContractCandidate => ({
	id: 'a',
	employee_id: 'person',
	company_id: 'entity-a',
	effective_range: { start: '2026-01-01T00:00:00.000Z', end: null },
	...overrides
});

test('one person cannot hold overlapping active contracts in one entity, including future contracts', () => {
	for (const start of ['2026-01-01', '2026-06-01', '2027-01-01'])
		assert.throws(
			() =>
				assertContractDoesNotOverlap(
					contract({
						id: 'b',
						effective_range: { start: `${start}T00:00:00.000Z`, end: null }
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
	const previous = contract({
		effective_range: { start: '2026-01-01T00:00:00.000Z', end: '2026-05-31T00:00:00.000Z' }
	});
	assert.throws(
		() =>
			assertContractDoesNotOverlap(
				contract({
					id: 'b',
					effective_range: { start: '2026-05-31T00:00:00.000Z', end: null }
				}),
				[previous]
			),
		/already has an active/
	);
	assert.doesNotThrow(() =>
		assertContractDoesNotOverlap(
			contract({
				id: 'b',
				effective_range: { start: '2026-06-01T00:00:00.000Z', end: null }
			}),
			[previous]
		)
	);
});

test('fixed service periods permit a later contract and refuse inverted dates', () => {
	const previous = contract({
		effective_range: { start: '2026-01-01T00:00:00.000Z', end: '2026-05-31T00:00:00.000Z' }
	});
	assert.doesNotThrow(() =>
		assertContractDoesNotOverlap(
			contract({
				id: 'b',
				effective_range: { start: '2026-06-01T00:00:00.000Z', end: null }
			}),
			[previous]
		)
	);
	assert.throws(
		() =>
			assertContractDoesNotOverlap(
				contract({
					effective_range: { start: '2026-06-01T00:00:00.000Z', end: '2026-05-31T00:00:00.000Z' }
				}),
				[]
			),
		/cannot end before/
	);
});

test('the resolved service window is the signed range', () => {
	const resolved = resolveEmployment(contract());
	assert.deepEqual(resolved.effective_range, {
		start: '2026-01-01T00:00:00.000Z',
		end: null
	});
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

test('a new contract is checked against stored and sibling contracts and takes its rolling number', () => {
	const { id: _id, ...input } = contract();
	const run = (inputs: ContractCandidate[], stored: ContractCandidate[] = []) => {
		const db = {
			employments: {
				findMany: ({ where }) =>
					Effect.succeed(stored.filter((row) => where.employee_id.in.includes(row.employee_id)))
			}
		};
		return transformSync(employments, inputs, { db });
	};
	assert.equal(run([input])[0].contract_number, 1);
	assert.throws(() => run([input], [contract()]), /already has an active/);
	assert.throws(() => run([input, { ...input }]), /already has an active/);
	assert.equal(
		run(
			[input],
			[
				contract({
					id: 'z',
					effective_range: { start: '2020-01-01T00:00:00.000Z', end: '2020-12-31T00:00:00.000Z' },
					contract_number: 4
				})
			]
		)[0].contract_number,
		5
	);
});

test('a rehire takes the next rolling contract number for the same person and entity', () => {
	const prior = [
		{ employee_id: 'p', company_id: 'c', contract_number: 1 },
		{ employee_id: 'p', company_id: 'c', contract_number: 2 },
		{ employee_id: 'p', company_id: 'other', contract_number: 7 },
		{ employee_id: 'q', company_id: 'c', contract_number: 9 }
	];
	assert.equal(nextContractNumber({ employee_id: 'p', company_id: 'c' }, prior), 3);
	assert.equal(nextContractNumber({ employee_id: 'p', company_id: 'new' }, prior), 1);
	assert.equal(nextContractNumber({ employee_id: 'r', company_id: 'c' }, []), 1);
});
