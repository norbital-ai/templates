import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import type { ActInput } from '@norbital-ai/bolt';
import { workspace } from '../kit.ts';

const NOW = '2026-10-13T00:00:00.000Z';
const kinds = [
	{
		code: 'CLOSURE',
		name: 'Closure',
		counts_as_attended: 'true',
		scheduled: 'true',
		pay: '0.6 * terms.base_salary / 26.0'
	}
];
const draft = {
	code: 'test',
	jurisdiction_code: 'test',
	name: 'Test version',
	payroll: { currency: 'USD' },
	sources: { entries: [] },
	effective_range: { from: '2026-01-01', to: null },
	suspension_kinds: kinds
} satisfies ActInput<'jurisdiction_settings.create'>[number];

it.live(
	'stores validated suspension kinds on their version, clones them and refuses sealed changes',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			const created = yield* admin.act('jurisdiction_settings.create', [draft]);
			expect(created.kind, JSON.stringify(created)).toBe('committed');
			if (created.kind !== 'committed') throw new Error('The draft did not commit.');
			const id = created.records.find((row) => row.model === 'jurisdiction_settings')?.id;
			if (id === undefined) throw new Error('The draft record is absent.');
			expect(
				(yield* admin.query({
					jurisdiction_settings: { where: { id: { eq: id } }, fields: ['suspension_kinds'] }
				})).jurisdiction_settings.rows[0]?.suspension_kinds
			).toEqual(kinds);
			for (const invalid of [[...kinds, ...kinds], [{ code: ' ', name: 'Blank' }]]) {
				const refused = yield* Effect.flip(
					admin.act('jurisdiction_settings.update', [
						{
							target: id,
							set: { suspension_kinds: invalid }
						}
					])
				);
				expect(refused).toMatchObject({
					_tag: 'ActRefused',
					message: expect.stringContaining('distinct non-empty codes')
				});
			}
			expect(
				(yield* admin.act('jurisdiction_settings.update', [
					{ target: id, set: { sealed_at: NOW } }
				])).kind
			).toBe('committed');
			expect(
				yield* Effect.flip(
					admin.act('jurisdiction_settings.update', [
						{
							target: id,
							set: { suspension_kinds: [] }
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const { suspension_kinds, ...cloneFields } = draft;
			const cloned = yield* admin.act('jurisdiction_settings.create', [
				{
					...cloneFields,
					cloned_from_id: id,
					effective_range: { from: '2027-01-01', to: null }
				}
			]);
			expect(cloned.kind, JSON.stringify(cloned)).toBe('committed');
			if (cloned.kind !== 'committed') throw new Error('The successor did not commit.');
			const successor = cloned.records.find((row) => row.model === 'jurisdiction_settings')?.id;
			if (successor === undefined) throw new Error('The successor record is absent.');
			expect(
				(yield* admin.query({
					jurisdiction_settings: {
						where: { id: { eq: successor } },
						fields: ['suspension_kinds', 'sealed_at']
					}
				})).jurisdiction_settings.rows[0]
			).toMatchObject({ suspension_kinds: kinds, sealed_at: null });
			expect(
				(yield* admin.act('jurisdiction_settings.update', [
					{
						target: successor,
						set: { suspension_kinds: [] }
					}
				])).kind
			).toBe('committed');
			expect(
				(yield* admin.query({
					jurisdiction_settings: { where: { id: { eq: id } }, fields: ['suspension_kinds'] }
				})).jurisdiction_settings.rows[0]?.suspension_kinds
			).toEqual(kinds);
		}).pipe(Effect.provide(workspace({ seed: 'none', now: NOW })), Effect.scoped)
);
