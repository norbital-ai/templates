import assert from 'node:assert/strict';
import type { ActFailure } from '@norbital-ai/bolt/errors';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { layer } from '@effect/vitest';
import { Effect } from 'effect';
import { bankConfigurationRefusal } from '../src/lib/bank_template.ts';
import { workspace } from './kit.ts';

const template = {
	file: '"example-payments.txt"',
	format: 'FIXED' as const,
	columns: [
		{ header: 'account', value: 'contract.bank.bank_account_number', width: 34 },
		{ header: 'amount', value: 'string(int(round(totals.net * 100.0, 1.0)))', width: 17 }
	]
};

layer(workspace({ seed: 'none' }))('native reusable bank template configuration', (it) => {
	it.effect(
		'saves an incomplete draft, refuses incomplete enabling, and enables a complete template',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = t.as(t.member(['hr_manager']));
				const created = yield* admin.act('bank.create', [
					{
						code: 'EXAMPLE_DRAFT',
						name: 'Example draft bank'
					}
				]);
				assert.equal(created.kind, 'committed');
				const [draft] = (yield* admin.query({
					bank: {
						where: { code: { eq: 'EXAMPLE_DRAFT' } },
						fields: ['enabled', 'bank_codes', 'currencies', 'template']
					}
				})).bank.rows;
				assert.ok(draft);
				assert.equal(draft.enabled, false);
				assert.deepEqual(draft.bank_codes, []);
				assert.deepEqual(draft.currencies, []);
				assert.deepEqual(draft.template, {});
				const incomplete = yield* Effect.flip(
					admin.act('bank.update', [{ target: draft.id, set: { enabled: true } }])
				);
				assert.equal(incomplete._tag, 'ActRefused');
				assert.equal(
					((yield* admin.query({ bank: { where: { id: { eq: draft.id } } } })).bank.rows[0] ?? null)
						?.enabled,
					false
				);
				const completed = yield* admin.act('bank.update', [
					{
						target: draft.id,
						set: { bank_codes: ['EXAMPLEBANK'], currencies: ['SGD'], template, enabled: true }
					}
				]);
				assert.equal(completed.kind, 'committed');
				const saved =
					(yield* admin.query({ bank: { where: { id: { eq: draft.id } } } })).bank.rows[0] ?? null;
				assert.ok(saved);
				assert.equal(saved.enabled, true);
				assert.equal(saved.template.file, '"example-payments.txt"');
			})
	);

	it.effect(
		'refuses invalid enabled definitions atomically through the native write pipeline',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = t.as(t.member(['hr_manager']));
				yield* admin.act('bank.create', [
					{
						code: 'EXAMPLE_VALIDATION',
						name: 'Example validation bank',
						bank_codes: ['EXAMPLEBANK'],
						currencies: ['SGD'],
						template
					}
				]);
				const [draft] = (yield* admin.query({
					bank: {
						where: { code: { eq: 'EXAMPLE_VALIDATION' } }
					}
				})).bank.rows;
				assert.ok(draft);
				const id = draft.id;
				const badTemplates = [
					{},
					{ ...template, file: 'runs[' },
					{ ...template, columns: [] },
					{ ...template, columns: [{ value: '"example"' }] },
					{ ...template, columns: [{ value: '"example"', width: 12, pad: '' }] },
					{
						...template,
						bank_file_validation: { file: [{ test: 'true', message: '' }], row: [] }
					}
				];
				for (const invalidTemplate of badTemplates) {
					const refused: ActFailure = yield* Effect.flip(
						admin.act('bank.update', [
							{
								target: id,
								set: { template: invalidTemplate, enabled: true }
							}
						])
					);
					assert.equal(refused._tag, 'ActRefused');
					const saved =
						(yield* admin.query({ bank: { where: { id: { eq: id } } } })).bank.rows[0] ?? null;
					assert.ok(saved);
					assert.equal(saved.enabled, false);
					assert.equal(saved.template.file, template.file);
				}
				for (const currencies of [[], ['sgd'], ['SGD', 'SGD']]) {
					const refused: ActFailure = yield* Effect.flip(
						admin.act('bank.update', [{ target: id, set: { currencies, enabled: true } }])
					);
					assert.equal(refused._tag, 'ActRefused');
				}
				const emptyBanks = yield* Effect.flip(
					admin.act('bank.update', [{ target: id, set: { bank_codes: [], enabled: true } }])
				);
				assert.equal(emptyBanks._tag, 'ActRefused');
			})
	);

	it.effect('validates edits to enabled records and permits an explicit return to draft', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.member(['hr_manager']));
			yield* admin.act('bank.create', [
				{
					code: 'EXAMPLE_ENABLED',
					name: 'Example enabled bank',
					bank_codes: ['EXAMPLEBANK'],
					currencies: ['SGD'],
					template,
					enabled: true
				}
			]);
			const [bank] = (yield* admin.query({
				bank: {
					where: { code: { eq: 'EXAMPLE_ENABLED' } }
				}
			})).bank.rows;
			assert.ok(bank);
			const refused = yield* Effect.flip(
				admin.act('bank.update', [{ target: bank.id, set: { template: {} } }])
			);
			assert.equal(refused._tag, 'ActRefused');
			assert.equal(
				((yield* admin.query({ bank: { where: { id: { eq: bank.id } } } })).bank.rows[0] ?? null)
					?.enabled,
				true
			);
			yield* admin.act('bank.update', [
				{
					target: bank.id,
					set: { enabled: false, template: {} }
				}
			]);
			const draft =
				(yield* admin.query({ bank: { where: { id: { eq: bank.id } } } })).bank.rows[0] ?? null;
			assert.ok(draft);
			assert.equal(draft.enabled, false);
			assert.deepEqual(draft.template, {});
		})
	);

	it('accepts supported optional shapes and rejects invalid widths without evaluating expressions', () => {
		const configuration = {
			enabled: true,
			bank_codes: ['EXAMPLEBANK'],
			currencies: ['SGD']
		};
		assert.equal(
			bankConfigurationRefusal({
				...configuration,
				template: {
					...template,
					applies_when: null,
					when: null,
					header: null,
					trailer: null,
					records: null,
					summary: null,
					bank_file_validation: null
				}
			}),
			undefined
		);
		assert.equal(
			bankConfigurationRefusal({
				...configuration,
				template: {
					file: '"records.txt"',
					format: 'FIXED',
					columns: [],
					records: [{ each: 'entries', fields: [{ value: 'item.amount', width: 17 }] }]
				}
			}),
			undefined
		);
		for (const width of [0, -1, 1.5, Infinity, NaN])
			assert.notEqual(
				bankConfigurationRefusal({
					...configuration,
					template: {
						...template,
						columns: [{ value: '"example"', width }]
					}
				}),
				undefined
			);
	});
});
