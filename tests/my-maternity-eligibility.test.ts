import assert from 'node:assert/strict';
import test from 'node:test';
import { leaveCatalogue } from './fixtures/statutory-world.ts';
import { evaluateNumberOver, personContext } from '../src/lib/payroll/run/eligibility.ts';

/** Act265 s37(1)(c),(d)(i): five or more surviving natural children AT confinement,
 * irrespective of age. This tests allowance qualification, not the separate leave right.
 * Official AGC reprint (cached source inspected):
 * https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf
 */
type Child = NonNullable<Parameters<typeof personContext>[0]['children']>[number];
const natural = (year: number): Child => ({
	child_birthdate: `${year}-01-01`,
	relationship: 'CHILD'
});
const four = Array.from({ length: 4 }, (_, index) => natural(1998 + index));
function context(children: readonly Child[]) {
	return {
		...personContext({
			employee: { gender: 'FEMALE' },
			employment: { service_start: '2024-01-01' },
			servicePeriods: [{ start: '2024-01-01', end: null }],
			terms: { base_salary: 100, pay_frequency: 'DAILY', employment_type: 'PERMANENT' },
			event: { kind: 'BIRTH', date: '2026-01-21' },
			asOf: '2026-02-21',
			children
		}),
		ordinary_day: 100
	};
}
const cases: readonly { name: string; children: readonly Child[]; paid: boolean }[] = [
	{ name: 'four surviving natural children including adult children', children: four, paid: true },
	{ name: 'five surviving natural children', children: [...four, natural(2002)], paid: false },
	{
		name: 'adopted child does not add to four natural children',
		children: [...four, { ...natural(2002), relationship: 'ADOPTED' }],
		paid: true
	},
	{
		name: 'natural child dead before confinement does not add to four survivors',
		children: [...four, { ...natural(2002), child_deathdate: '2026-01-20' }],
		paid: true
	},
	{
		name: 'future birth before settlement does not add to confinement count',
		children: [...four, { child_birthdate: '2026-01-22', relationship: 'CHILD' }],
		paid: true
	},
	{
		name: 'child born on confinement day is included in at-confinement count',
		children: [...four, { child_birthdate: '2026-01-21', relationship: 'CHILD' }],
		paid: false
	},
	{
		name: 'death after confinement does not retrospectively reduce the count',
		children: [...four, { ...natural(2002), child_deathdate: '2026-01-22' }],
		paid: false
	}
];
for (const scenario of cases)
	test(`MY maternity qualification — ${scenario.name}`, () => {
		for (const row of leaveCatalogue('MY').filter((item) => item.code === 'MATERNITY_LEAVE')) {
			const person = context(scenario.children);
			assert.equal(
				evaluateNumberOver(row.pay_fraction, person),
				scenario.paid ? 1 : 0,
				row.settings_id
			);
			assert.equal(
				evaluateNumberOver(row.time_off_amount, person),
				scenario.paid ? 100 : 0,
				row.settings_id
			);
		}
	});
test('MY maternity qualification — same-day death requires survival determination rather than inferred eligibility', () => {
	const person = context([
		...four,
		{ child_birthdate: '2026-01-21', child_deathdate: '2026-01-21', relationship: 'CHILD' }
	]);
	const row = leaveCatalogue('MY').find((item) => item.code === 'MATERNITY_LEAVE')!;
	assert.throws(() => evaluateNumberOver(row.pay_fraction, person), /time-specific determination/);
});
