import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import type { ActInput, Id } from '@norbital-ai/bolt';
import { workspace } from '../kit.ts';

const NOW = '2026-10-13T00:00:00.000Z';
type Draft = ActInput<'jurisdiction_settings.create'>[number];
const draft = {
	code: 'test',
	name: 'Test version',
	payroll: { currency: 'USD' },
	sources: { entries: [] },
	effective_range: { from: '2026-01-01', to: null },
	// the PARAMETERS slots a version is sealed with
	rule_set: [
		{
			family: 'PARAMETERS',
			code: 'record_retention',
			name: 'Record retention',
			rules: { until: 'exit_on' }
		},
		{ family: 'PARAMETERS', code: 'exit_grounds', name: 'Exit grounds', rules: { kinds: [] } },
		{ family: 'PARAMETERS', code: 'holiday_kinds', name: 'Holiday kinds', rules: { kinds: [] } },
		{ family: 'PARAMETERS', code: 'salary_report', name: 'Salary report', rules: {} }
	]
} satisfies Draft;
/** A suspension kind with its pricing of one day. */
const kind = {
	code: 'CLOSURE',
	name: 'Closure',
	counts_as_attended: 'true',
	scheduled: 'true',
	eligibility: 'true',
	rate: 'terms.base_salary / 26.0'
} satisfies NonNullable<Draft['suspension_catalog']>[number];
/** The version's time pay: a clone carries it with the settings. */
const timePay = {
	BASIC: [
		{
			code: 'BASIC',
			eligibility: 'true',
			quantity: '1.0',
			rate: 'terms.base_salary',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: []
		}
	]
} satisfies NonNullable<Draft['time_pay']>;

it.live(
	'a version owns its suspension catalogue: a clone carries it and a sealed version refuses its edit',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			const created = yield* admin.act('jurisdiction_settings.create', [
				{ ...draft, suspension_catalog: [kind], time_pay: timePay }
			]);
			expect(created.kind, JSON.stringify(created)).toBe('committed');
			if (created.kind !== 'committed') throw new Error('The draft did not commit.');
			const id = created.records.find((row) => row.model === 'jurisdiction_settings')?.id;
			if (id === undefined) throw new Error('The draft record is absent.');
			const catalogue = (settings: Id<'jurisdiction_settings'>) =>
				admin.query({
					suspension_catalog: { where: { settings_id: { eq: settings } } },
					jurisdiction_settings: { where: { id: { eq: settings } }, fields: ['time_pay'] }
				});
			const own = yield* catalogue(id);
			expect(own.suspension_catalog.rows).toMatchObject([kind]);
			expect(
				(yield* admin.act('jurisdiction_settings.update', [
					{ target: id, set: { sealed_at: NOW } }
				])).kind
			).toBe('committed');
			const [row] = own.suspension_catalog.rows;
			if (row === undefined) throw new Error('The catalogue row is absent.');
			const hr = t.as(t.member(['hr_manager']));
			expect(
				yield* Effect.flip(
					hr.act('suspension_catalog.update', [{ target: row.id, set: { scheduled: 'false' } }])
				)
			).toMatchObject({ message: expect.stringContaining('Clone it into a draft') });
			const cloned = yield* admin.act('jurisdiction_settings.create', [
				{ ...draft, cloned_from_id: id, effective_range: { from: '2027-01-01', to: null } }
			]);
			expect(cloned.kind, JSON.stringify(cloned)).toBe('committed');
			if (cloned.kind !== 'committed') throw new Error('The successor did not commit.');
			const successor = cloned.records.find((held) => held.model === 'jurisdiction_settings')?.id;
			if (successor === undefined) throw new Error('The successor record is absent.');
			const copied = yield* catalogue(successor);
			expect(copied.suspension_catalog.rows).toMatchObject([kind]);
			expect(copied.jurisdiction_settings.rows).toMatchObject([{ time_pay: timePay }]);
			const [draftRow] = copied.suspension_catalog.rows;
			if (draftRow === undefined) throw new Error('The cloned catalogue row is absent.');
			// the draft's row is its own: editing it leaves the sealed version's untouched
			expect(
				(yield* hr.act('suspension_catalog.update', [
					{ target: draftRow.id, set: { scheduled: 'false' } }
				])).kind
			).toBe('committed');
			expect((yield* catalogue(id)).suspension_catalog.rows).toMatchObject([kind]);
		}).pipe(Effect.provide(workspace({ seed: 'none', now: NOW })), Effect.scoped)
);
