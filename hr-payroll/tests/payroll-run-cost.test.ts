/**
 * The cost guard of a payroll run. A company's month is priced inside one invocation's 2 s of guest CPU,
 * which the isolate meters at about 3× what a host profile shows, and most of it is CEL: every `when` of
 * every ladder a person reaches, every rule a work day reads. The guard counts those evaluations over a
 * Malaysian month of sixty people (the EPF Third Schedule is the catalogue's longest ladder) — a count, so
 * it holds on any machine — and fails when a change multiplies the per-person work again.
 *
 * Measured 2026-10-01: 76,841 evaluations (1,281 a person). Nihon's January in the isolate (89 slips) went
 * from 1.40 s to 0.67 s of guest CPU with the same round of cuts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assessStatutory, type Person } from './fixtures/statutory-world.ts';
import { evaluationCount } from '../src/lib/expressions/evaluate.ts';

const OUT = { kind: 'NOT_REGISTERED' } as const;
const LOCAL = { EPF_NON_CITIZEN: OUT };
const FOREIGN = { EPF: OUT, EPF_PR: OUT, EIS: OUT };
const PEOPLE = 60;
/** Evaluations a person may cost: the measure above and a tenth of headroom. */
const CEILING = 1_400;

const people: Person[] = Array.from({ length: PEOPLE }, (_, index) => {
	const citizenship =
		index % 10 === 9 ? 'FOREIGNER' : index % 10 === 8 ? 'PERMANENT_RESIDENT' : 'CITIZEN';
	return {
		key: `COST-${index}`,
		wage: 1_700 + index * 173.25,
		age: 22 + (index % 40),
		citizenship,
		registrations: citizenship === 'FOREIGNER' ? FOREIGN : LOCAL
	};
});

test(`a sixty-person Malaysian month evaluates under ${CEILING} expressions a person`, () => {
	const before = evaluationCount();
	assert.equal(assessStatutory({ code: 'MY', period: '2026-01', people }).size, PEOPLE);
	const perPerson = (evaluationCount() - before) / PEOPLE;
	assert.ok(perPerson < CEILING, `${perPerson.toFixed(0)} evaluations a person`);
});
