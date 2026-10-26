import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import type { DatabaseRequest } from '@norbital-ai/bolt/engine';
import { sourceEntryIds, type OrderPayload } from '../src/integration/kingdee/order-batch.js';
import { previousOrderDocument, sourceAmendmentSql } from '../src/integration/kingdee/amendment.js';
import { sourceOrderUuid, submitOrder } from '../src/integration/kingdee/submission.js';

const original = {
	id: 'line-retained', source_entry_id: '4', product_code: '301', unit: 'kg', quantity: '10',
	unit_price: '2', discount_pct: '0', tax_rate: '13', net: '20', tax: '2.60', total: '22.60'
};
const amended: OrderPayload = {
	order_id: 'order-a', reference: 'SO-A', direction: 'sales', agreement_hash: 'seal-b', version: 2,
	owner_id: 'member-a', ordered_on: '2026-10-26', currency: 'CNY', tax_inclusive: false,
	party_code: '101', payment_terms: 'NET30',
	lines: [{ ...original, quantity: '12', net: '24', tax: '3.12', total: '27.12' }],
	previous: {
		binding_id: 'sales:0:9002:seal-a',
		source_id: '9002', source_uuid: '00000000-0000-8000-8000-000000000001',
		source_version: '007', source_exchange_rate: '1', agreement_hash: 'seal-a', tax_inclusive: false, lines: [original]
	}
};
const { previous: _previous, ...withoutPrevious } = amended;
const configuration = {
	baseCurrency: 'CNY', branchNo: '0', billerId: '1',
	salespersonBindings: JSON.stringify({ 'member-a': { employeeId: '701', departmentId: '601' } }),
	currencyBindings: JSON.stringify({ CNY: { id: '1', base: true } }),
	settlementRules: JSON.stringify({ NET30: { creditDays: 30, fromMonthEnd: false } })
};
const previousBindings = { rate: '1', baseCurrency: 'CNY' };

it('preserves source entry identities when lines are reordered, removed or appended', () => {
	const old = { ...original, id: 'line-removed', source_entry_id: '9' };
	const previous = amended.previous;
	if (!previous) throw new Error('Previous source proof required');
	const { source_entry_id: _entry, ...line } = original;
	const inserted = { ...line, id: 'line-new' };
	expect(sourceEntryIds({
		...amended, previous: { ...previous, lines: [original, old] },
		lines: [inserted, original]
	})).toEqual([
		{ local_line_id: 'line-new', entry_id: '10' },
		{ local_line_id: 'line-retained', entry_id: '4' }
	]);
});

it('reuses a verified entry when an imported line receives a new native editor identity', () => {
	const previous = amended.previous;
	if (!previous) throw new Error('Previous source proof required');
	const { source_entry_id: _entry, ...line } = original;
	expect(sourceEntryIds({
		...amended,
		lines: [
			{ ...original, id: 'new-native-editor-id' },
			{ ...line, id: 'new-business-line' }
		]
	})).toEqual([
		{ local_line_id: 'new-native-editor-id', entry_id: '4' },
		{ local_line_id: 'new-business-line', entry_id: '5' }
	]);
});

it.each([
	['duplicate', [original, { ...original, id: 'second-native-id' }]],
	['unknown', [{ ...original, id: 'new-native-id', source_entry_id: '99' }]],
	['product hijack', [{ ...original, id: 'new-native-id', product_code: '302' }]],
	['unit hijack', [{ ...original, id: 'new-native-id', unit: 't' }]]
] as const)('refuses %s claims on a previous source entry', (_name, lines) => {
	try {
		sourceEntryIds({ ...amended, lines });
		throw new Error('Invalid source entry claims must be refused');
	} catch (error) {
		expect(error).toMatchObject({ _tag: 'SourceRowInvalid', column: 'FEntryID' });
	}
});

it('keeps a known local line attached to its original source entry', () => {
	const previous = amended.previous;
	if (!previous) throw new Error('Previous source proof required');
	try {
		sourceEntryIds({
			...amended,
			previous: { ...previous, lines: [original, { ...original, id: 'other-line', source_entry_id: '9' }] },
			lines: [{ ...original, source_entry_id: '9' }]
		});
		throw new Error('Existing local identity must not be reassigned');
	} catch (error) {
		expect(error).toMatchObject({ _tag: 'SourceRowInvalid', column: 'FEntryID' });
	}
});

it('refuses ambiguous source identities and exhausted Kingdee versions', () => {
	const previous = amended.previous;
	if (!previous) throw new Error('Previous source proof required');
	try {
		sourceEntryIds({
			...amended, previous: { ...previous, lines: [original, { ...original, id: 'another-local-line' }] }
		});
		throw new Error('Ambiguous source entries must be refused');
	} catch (error) {
		expect(error).toMatchObject({ _tag: 'SourceRowInvalid', column: 'FEntryID' });
	}
	expect(() => sourceEntryIds({ ...amended, previous: { ...previous, source_version: '999' } })).toThrow();
	expect(() => sourceEntryIds(withoutPrevious)).toThrow();
});

it('carries the prior commercial contents independently of the target', () => {
	const document = previousOrderDocument(amended, previousBindings);
	expect(document).toContain('entry="4"');
	expect(document).toContain('quantity="10"');
	expect(document).toContain('inclusive="2.26000000"');
	expect(document).not.toContain('quantity="12"');
});

it.effect('submits amendments to the verified live identity with frozen prior contents and stable retry provenance', () =>
	Effect.gen(function* () {
		const calls: DatabaseRequest[] = [];
		const ctx = {
			configuration: { ...configuration },
			request: Effect.fnUntraced(function* (operation: DatabaseRequest) {
				calls.push(operation);
				if (operation.op !== 'call') throw new Error('SQL RPC required');
				if (operation.arguments.stmt === sourceAmendmentSql) {
					const hash = operation.arguments.fingerprint;
					if (typeof hash !== 'string') throw new Error('Fingerprint required');
					return { rows: [{ remote: '9002', hash }] };
				}
				return { rows: [
					{ kind: 'customer', local: '', id: '101', unit_id: '', unit_name: '', rate: '' },
					{ kind: 'settlement', local: '', id: '1', unit_id: '', unit_name: '', rate: '' },
					{ kind: 'employee', local: '', id: '701', unit_id: '', unit_name: '', rate: '' },
					{ kind: 'department', local: '', id: '601', unit_id: '', unit_name: '', rate: '' },
					{ kind: 'currency', local: '', id: '1', unit_id: '', unit_name: '', rate: '1' },
					{ kind: 'item', local: 'line-retained', id: '301', unit_id: '401', unit_name: 'kg', rate: '' }
				] };
			})
		};
		expect(yield* submitOrder(amended, 'order-a:seal-b', ctx)).toBe('sales:0:9002:seal-a');
		expect(yield* submitOrder(amended, 'order-a:seal-b', ctx)).toBe('sales:0:9002:seal-a');
		const writes = calls.filter((operation) => operation.op === 'call' && operation.arguments.stmt === sourceAmendmentSql);
		expect(writes).toHaveLength(2);
		expect(writes[0]).toEqual(writes[1]);
		const write = writes[0];
		if (write?.op !== 'call') throw new Error('Amendment write required');
		expect(write.transaction).toBe('serializable');
		expect(write.arguments).toMatchObject({
			source_id: '9002', source_version: '007', source_exchange_rate: '1', correlation: amended.previous?.source_uuid,
			previous_document: previousOrderDocument(amended, previousBindings)
		});
		expect(write.arguments.document).toContain('FEntryID="4"');
		expect(write.arguments.correlation).not.toBe(yield* sourceOrderUuid(amended.order_id, amended.agreement_hash));
		ctx.configuration.billerId = '2';
		expect(yield* submitOrder(amended, 'order-a:seal-b', ctx)).toBe('sales:0:9002:seal-a');
		const replay = calls.at(-1);
		if (replay?.op !== 'call') throw new Error('Replay write required');
		expect(replay.arguments.change_cause).toBe(write.arguments.change_cause);
		expect(replay.arguments.fingerprint).not.toBe(write.arguments.fingerprint);
	})
);

it.effect('refuses a missing source basis or changed tax basis before making a request', () =>
	Effect.gen(function* () {
		let calls = 0;
		const ctx = {
			configuration,
			request: Effect.fnUntraced(function* (_operation: DatabaseRequest) {
				calls++;
				return { rows: [] };
			})
		};
		expect(yield* Effect.flip(submitOrder(withoutPrevious, 'order-a:seal-b', ctx)))
			.toMatchObject({ _tag: 'SourceRowInvalid', column: 'version' });
		expect(yield* Effect.flip(submitOrder({ ...amended, tax_inclusive: true }, 'order-a:seal-b', ctx)))
			.toMatchObject({ _tag: 'SourceRowInvalid', column: 'tax_inclusive' });
		expect(calls).toBe(0);
	})
);

it.effect('refuses foreign-exchange drift before submitting an amendment', () =>
	Effect.gen(function* () {
		const previous = amended.previous;
		if (!previous) throw new Error('Previous source proof required');
		let calls = 0;
		const ctx = {
			configuration: {
				...configuration,
				currencyBindings: JSON.stringify({ CNY: { id: '1', base: true }, USD: { id: '133', base: false } })
			},
			request: Effect.fnUntraced(function* (_operation: DatabaseRequest) {
				calls++;
				return { rows: [{ kind: 'currency', local: '', id: '133', unit_id: '', unit_name: '', rate: '7.2' }] };
			})
		};
		expect(yield* Effect.flip(submitOrder({
			...amended, currency: 'USD', previous: { ...previous, source_exchange_rate: '7.1' }
		}, 'order-a:seal-b', ctx))).toMatchObject({
			_tag: 'SourceRowInvalid', column: 'currency',
			reason: 'Source exchange rate changed since the previous contract observation'
		});
		expect(calls).toBe(1);
	})
);
