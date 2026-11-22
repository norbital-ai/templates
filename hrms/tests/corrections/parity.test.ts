// Every change that alters a paid month, corrected at its source after the month was paid, reconciles on the next
// payslip: a history that paid January wrong, corrected the source and ran February has paid in all exactly what a
// history that was right before January paid, line by line, and its leave ledger ends the same. Ledger work run again
// changes nothing. The Malaysian pack is only the fixture; every figure compared is one the system produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Kit } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect } from 'effect';
import { idOf } from '../../src/lib/reads.ts';
import { rostered, rosteredNeutral } from '../amendment_kit.ts';
import {
	ENTITY,
	PARAMETERS,
	REST,
	WORK,
	current,
	lawWith,
	recordEvents,
	storedQuery,
	uuid,
	withParameters
} from '../kit.ts';
import { MONTHS, OVERTIME_DAY, STINT, nothing, parity, wrote, type Seed } from './parity_kit.ts';

// ---- the person's facts ---------------------------------------------------------------------------------------------

/** The spouse the seed keys: the pack's first dependant. */
const SPOUSE = idOf('dependant', uuid(40));
const reliefs = (children: Readonly<Record<string, number>>) => ({ statutory: { PCB: children } });
/** A married earner whose PCB the family and the declared child reliefs move. */
const married = (has_income: boolean, children: Readonly<Record<string, number>>): Seed => {
	const base = rostered(MONTHS, undefined, 8000);
	return {
		...base,
		employee_profile: (base.employee_profile ?? []).map((row) => ({
			...row,
			date_of_birth: '1985-01-01'
		})),
		statutory_parameters: withParameters(base, { marital_status: 'MARRIED', ...reliefs(children) }),
		dependant: [{ id: SPOUSE, employee_id: uuid(4), relation: 'SPOUSE', has_income }]
	};
};
/** A dependant is corrected on its own row: whether the spouse has an income. */
const spouseEarns = (has_income: boolean) => (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'dependant.update': [{ target: yield* current(t, 'dependant', SPOUSE), set: { has_income } }]
		});
		yield* t.run_due();
	});
/** What the law was told since the hire is corrected on the row that set it: the first parameters row. */
const declared = (children: Readonly<Record<string, number>>) => (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'statutory_parameters.update': [
				{
					target: yield* current(
						t,
						'statutory_parameters',
						idOf('statutory_parameters', PARAMETERS)
					),
					set: { parameters: reliefs(children) }
				}
			]
		});
		yield* t.run_due();
	});

describe('a fact of the person corrected after its month was paid', () => {
	for (const [was, is] of [
		[true, false],
		[false, true]
	] as const)
		it.live(
			`spouse ${was ? 'with' : 'without'} income corrected to ${is ? 'with' : 'without'}: the next payslip carries the PCB difference`,
			() => {
				const right = spouseEarns(is);
				return parity(married(was, {}), { wrong: nothing, correct: right, right });
			}
		);

	for (const [was, is] of [
		[1, 2],
		[2, 1]
	] as const)
		it.live(
			`children corrected from ${was} to ${is}: the next payslip carries the difference`,
			() => {
				const right = declared({ children_under_18_or_studying: is });
				return parity(married(true, { children_under_18_or_studying: was }), {
					wrong: nothing,
					correct: right,
					right
				});
			}
		);

	// the neutral law's tax is made to read the family, so no real law's reliefs are under test: divided by one more for
	// each child
	it.live(
		'a child keyed after the month it was born in was paid: the next payslip carries the tax difference, as B',
		() => {
			const seed = lawWith(rosteredNeutral(MONTHS), {
				statutory_contribution_catalog: {
					TAX: {
						employee_amount: [
							"const fund = Object.hasOwn(ctx.statutory, 'FUND') ? ctx.statutory.FUND.employee : 0;",
							"const children = get(ctx.subject.employment, 'family', []).filter((member) => member.relation === 'CHILD').length;",
							'return ((ctx.subtotals.ORDINARY_WAGES - fund) * ctx.lookup.rate) / (1 + children);'
						].join('\n')
					}
				}
			});
			const right = (t: Kit) =>
				Effect.gen(function* () {
					yield* (yield* t.as(t.admin)).act({
						'dependant.create': [
							{
								employee_id: idOf('employee_profile', uuid(4)),
								relation: 'CHILD',
								born_on: '2026-01-10'
							}
						]
					});
					yield* t.run_due();
				});
			return parity(seed, { wrong: nothing, correct: right, right });
		}
	);
});

// ---- a dated row or a life event keyed on the wrong day -------------------------------------------------------------

/** The declared children from a first of a month, on a parameters row of its own. */
const declaredFrom = (on: string) => (t: Kit) =>
	wrote(t, (hr) =>
		hr.act({
			'statutory_parameters.create': [
				{
					employment_id: STINT,
					effective_from: on,
					parameters: reliefs({ children_under_18_or_studying: 2 })
				}
			]
		})
	);
/** The parameters row dated `from` moved to `to`, on the row itself. */
const parametersMoved = (from: string, to: string) => (t: Kit) =>
	Effect.gen(function* () {
		const { statutory_parameters } = yield* storedQuery(t, {
			statutory_parameters: { where: { effective_from: { eq: from } }, limit: 1 }
		});
		const [target] = statutory_parameters.rows;
		assert.ok(target !== undefined, `No parameters row on ${from}`);
		yield* wrote(t, (hr) =>
			hr.act({ 'statutory_parameters.update': [{ target, set: { effective_from: to } }] })
		);
	});
/** A mother: a birth opens her maternity leave from its date. */
const mother = (): Seed => {
	const base = rostered(MONTHS);
	return {
		...base,
		employee_profile: (base.employee_profile ?? []).map((row) => ({ ...row, gender: 'FEMALE' }))
	};
};
/** The stint's life events are this birth, on this day. */
const bornOn = (on: string) => (t: Kit) =>
	recordEvents(t, [{ kind: 'CHILD_BIRTH', on }]).pipe(Effect.andThen(t.run_due()));

describe('a dated row or a life event keyed on the wrong day, moved after its month was paid', () => {
	it.live(
		'a statutory parameter dated a month late: moved to its first day, the next payslip carries the difference, as B',
		() =>
			parity(married(true, { children_under_18_or_studying: 1 }), {
				wrong: declaredFrom('2026-02-01'),
				correct: parametersMoved('2026-02-01', '2026-01-01'),
				right: declaredFrom('2026-01-01')
			})
	);
	it.live('a birth recorded a month late: moved to its day, the leave it opens as B', () =>
		parity(mother(), {
			wrong: bornOn('2026-02-12'),
			correct: bornOn('2026-01-12'),
			right: bornOn('2026-01-12'),
			carries: false
		})
	);
});

// ---- the clock ------------------------------------------------------------------------------------------------------

const MISSED_DAY = '2026-01-22';
/** January's roster with two hours of planned overtime clocked on one day and no punch at all on another. */
const clocked = (): Seed => {
	const base = rostered(MONTHS, OVERTIME_DAY);
	return {
		...base,
		roster_entry: (base.roster_entry ?? []).map((row) =>
			row.work_date === MISSED_DAY ? { ...row, actual_worked_intervals: [] } : row
		)
	};
};
/** The day's clocked intervals as eight ordinary hours. */
const punched = (date: string) => (t: Kit) =>
	Effect.gen(function* () {
		const { roster_entry } = yield* storedQuery(t, {
			roster_entry: { where: { work_date: { eq: date } }, limit: 1 }
		});
		const [day] = roster_entry.rows;
		assert.ok(day !== undefined);
		yield* (yield* t.as(t.admin)).act({
			'roster_entry.update': [
				{
					target: day,
					set: {
						actual_worked_intervals: [
							{
								start: DateTime.formatIso(DateTime.makeUnsafe(`${date}T00:00:00.000Z`)),
								end: DateTime.formatIso(DateTime.makeUnsafe(`${date}T08:00:00.000Z`))
							}
						]
					}
				}
			]
		});
		yield* t.run_due();
	});

describe('a paid day’s clock corrected', () => {
	it.live('the clock-out corrected so the overtime goes, and a missed punch added: as B', () => {
		const right = (t: Kit) => punched(OVERTIME_DAY)(t).pipe(Effect.andThen(punched(MISSED_DAY)(t)));
		return parity(clocked(), { wrong: nothing, correct: right, right });
	});
});

// ---- the shift and the pattern -------------------------------------------------------------------------------------

/** Two January days are rostered on a shift of their own. */
const ALT = idOf('shift_definition', uuid(910));
const ALT_DAYS = ['2026-01-13', '2026-01-14'];
const twoShifts = (): Seed => {
	const seed = rostered(MONTHS);
	const [work] = seed.shift_definition ?? [];
	assert.ok(work !== undefined);
	return {
		...seed,
		shift_definition: [...(seed.shift_definition ?? []), { ...work, id: ALT, code: 'ALT' }],
		roster_entry: (seed.roster_entry ?? []).map((row) =>
			ALT_DAYS.includes(String(row.work_date)) ? { ...row, shift_definition_id: ALT } : row
		)
	};
};
/** That shift, as a day of absence: the two days rostered on it are then days not worked. */
const shiftAsAbsence = (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'shift_definition.update': [
				{
					target: yield* current(t, 'shift_definition', ALT),
					set: { variant: { day_type: 'ABS', ends_next_day: false, breaks: [] } }
				}
			]
		});
		yield* t.run_due();
	});
const WEEK = idOf('shift_pattern', uuid(909));
const week = (sunday: string) => {
	const work = idOf('shift_definition', WORK);
	return {
		week_start: 'MONDAY' as const,
		days: {
			MONDAY: work,
			TUESDAY: work,
			WEDNESDAY: work,
			THURSDAY: work,
			FRIDAY: work,
			SATURDAY: work,
			SUNDAY: idOf('shift_definition', sunday)
		}
	};
};
/** The stint follows a weekly pattern whose Sunday is a rest day. */
const patterned = (): Seed => {
	const seed = rostered(MONTHS);
	return {
		...seed,
		shift_pattern: [{ id: WEEK, entity_id: ENTITY, code: 'WEEK', pattern: week(REST) }],
		contract_terms: (seed.contract_terms ?? []).map((row) => ({ ...row, shift_pattern_id: WEEK }))
	};
};
/** The pattern's Sunday, as a work day: the Sundays nobody clocked are then days not worked. */
const sundayWorked = (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'shift_pattern.update': [
				{ target: yield* current(t, 'shift_pattern', WEEK), set: { pattern: week(WORK) } }
			]
		});
		yield* t.run_due();
	});

describe('a shift or a pattern corrected after its month was paid', () => {
	it.live('the shift the paid days used: the next payslip carries the difference, as B', () =>
		parity(twoShifts(), { wrong: nothing, correct: shiftAsAbsence, right: shiftAsAbsence })
	);
	it.live('the pattern the person follows: the next payslip carries the difference, as B', () =>
		parity(patterned(), { wrong: nothing, correct: sundayWorked, right: sundayWorked })
	);
});
