import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import work from '../src/collections/payslip_work_day_inputs/+hooks.ts';
import claim from '../src/collections/payslip_claim_request_inputs/+hooks.ts';
import allowance from '../src/collections/payslip_allowance_request_inputs/+hooks.ts';
import payment from '../src/collections/payslip_payment_request_inputs/+hooks.ts';
import leave from '../src/collections/payslip_leave_inputs/+hooks.ts';
import loan from '../src/collections/payslip_loan_repayment_inputs/+hooks.ts';

const families = [
	{ hooks: work, source: 'work_days', key: 'work_day_id' },
	{ hooks: claim, source: 'claim_requests', key: 'claim_request_id' },
	{ hooks: allowance, source: 'allowance_requests', key: 'allowance_request_id' },
	{ hooks: payment, source: 'payment_requests', key: 'payment_request_id' },
	{ hooks: leave, source: 'leave_entries', key: 'leave_entry_id' },
	{ hooks: loan, source: 'loan_repayments', key: 'loan_repayment_id' }
] as const;

type LinkedRow = { id: string; employment_id: string };

function world(source: string, sources: LinkedRow[], payslips: LinkedRow[] = []) {
	const reads: { collection: string; ids: readonly string[] }[] = [];
	const reader = (collection: string, rows: LinkedRow[]) => ({
		findMany: (query: { where: { id: { in: readonly string[] } }; limit: number }) => {
			reads.push({ collection, ids: query.where.id.in });
			assert.equal(query.limit, query.where.id.in.length);
			return Effect.succeed(rows.filter((row) => query.where.id.in.includes(row.id)));
		}
	});
	return {
		api: { db: { [source]: reader(source, sources), payslips: reader('payslips', payslips) } },
		reads
	};
}

const source = { id: 'source-1', employment_id: 'contract-1' };
const payslip = { id: 'payslip-1', employment_id: 'contract-1' };
const parent = {
	collection: 'payslips',
	id: payslip.id,
	column: 'payslip_id',
	values: payslip
};

for (const family of families) {
	const nestedInput = { [family.key]: source.id, period: '2026-07' };
	const directInput = { ...nestedInput, payslip_id: payslip.id };
	const prepare = (fixture: ReturnType<typeof world>, inputs = [directInput]) =>
		Effect.runSync(family.hooks.mutate.prepare({ inputs, api: fixture.api } as never));
	const before = (context: object) =>
		family.hooks.mutate.perRecord.before.handler(context as never);

	test(`${family.source}: direct capture reads source and payslip contract once per batch`, () => {
		const second = { id: 'source-2', employment_id: payslip.employment_id };
		const fixture = world(family.source, [source, second], [payslip]);
		const inputs = [directInput, { ...directInput, [family.key]: second.id }, directInput];
		const prepared = prepare(fixture, inputs);
		for (const input of inputs) assert.equal(before({ input, prepared }), input);
		assert.deepEqual(fixture.reads, [
			{ collection: family.source, ids: [source.id, second.id] },
			{ collection: 'payslips', ids: [payslip.id] }
		]);
	});

	test(`${family.source}: nested capture accepts an unwritten payslip from authoritative parent`, () => {
		const fixture = world(family.source, [source]);
		const input = { ...nestedInput, charges: [{ date: '2026-07-01', units: 1 }] };
		const prepared = prepare(fixture, [input] as never);
		assert.equal(before({ input, prepared, parent }), input);
		assert.deepEqual(fixture.reads, [{ collection: family.source, ids: [source.id] }]);
	});

	test(`${family.source}: another contract refuses for direct and nested captures`, () => {
		const fixture = world(family.source, [{ ...source, employment_id: 'contract-2' }], [payslip]);
		const prepared = prepare(fixture);
		for (const context of [
			{ input: directInput, prepared },
			{ input: { ...nestedInput, employment_id: 'contract-1' }, prepared, parent }
		]) {
			assert.throws(() => before(context), /same employment contract as its payslip/);
		}
	});

	test(`${family.source}: nested payslip identity and own contract cannot be overridden`, () => {
		const fixture = world(family.source, [source], [payslip]);
		const prepared = prepare(fixture);
		assert.throws(
			() => before({ input: { ...directInput, payslip_id: 'other-payslip' }, prepared, parent }),
			/cannot name a different payslip/
		);
		assert.throws(
			() =>
				before({
					input: directInput,
					prepared,
					parent: { ...parent, values: { ...payslip, employment_id: 'contract-2' } }
				}),
			/same employment contract as its payslip/
		);
	});

	test(`${family.source}: absent source, payslip or contract cannot create a capture`, () => {
		for (const missing of ['source', 'payslip', 'source-contract', 'payslip-contract']) {
			const fixture = world(
				family.source,
				missing === 'source'
					? []
					: [
							{
								...source,
								employment_id: missing === 'source-contract' ? '' : source.employment_id
							}
						],
				missing === 'payslip'
					? []
					: [
							{
								...payslip,
								employment_id: missing === 'payslip-contract' ? '' : payslip.employment_id
							}
						]
			);
			assert.throws(
				() => before({ input: directInput, prepared: prepare(fixture) }),
				/must reference an existing (source|payslip) and its employment contract/
			);
		}
		const fixture = world(family.source, [source], [payslip]);
		const prepared = prepare(fixture);
		assert.throws(() => before({ input: nestedInput, prepared }), /existing payslip/);
		assert.throws(() => before({ input: { payslip_id: payslip.id }, prepared }), /existing source/);
		assert.throws(
			() => before({ input: nestedInput, prepared, parent: { ...parent, values: {} } }),
			/existing payslip/
		);
		assert.throws(
			() => before({ input: nestedInput, prepared, parent: { ...parent, column: 'other_id' } }),
			/must be created through its payslip/
		);
		assert.throws(
			() =>
				before({
					input: directInput,
					prepared,
					parent: {
						collection: family.source,
						column: family.key,
						id: 'different-source',
						values: { employment_id: 'contract-2' }
					}
				}),
			/must be created through its payslip/
		);
	});

	test(`${family.source}: stored captures remain immutable even for a no-op`, () => {
		assert.throws(
			() => before({ input: directInput, existing: { id: 'capture-1', ...directInput } }),
			/A captured input.*cannot be edited/
		);
	});
}
