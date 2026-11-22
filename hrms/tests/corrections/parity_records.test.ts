// Parity tests for every other record a payroll run reads (claims, ad hoc, leave kind, roster, holidays, company hour,
// join date and date of birth).
import { describe, it } from '@effect/vitest';
import type { Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/reads.ts';
import { rostered } from '../amendment_kit.ts';
import { ENTITY, current, stintOf, uuid } from '../kit.ts';
import {
	DAY,
	MONTHS,
	NPL_DAYS,
	OVERTIME_DAY,
	awarded,
	bornEarlier,
	claimed,
	contractHour,
	holidayDeclared,
	keyed,
	nothing,
	parity,
	rosterDayGone,
	wrote,
	type Seed
} from './parity_kit.ts';

/** A holiday published before the month, on a day that was worked. */
const HOLIDAY = idOf('holiday', uuid(20));
const withHoliday = (): Seed => ({
	...rostered(MONTHS),
	holiday: [
		{
			id: HOLIDAY,
			entity_id: ENTITY,
			date: DAY,
			name: 'PUBLIC_HOLIDAY',
			kind: 'PUBLIC_HOLIDAY',
			given_to: 'EVERYONE',
			published_at: '2025-12-01T00:00:00.000Z'
		}
	]
});
const holidayGone = (t: Kit) =>
	Effect.gen(function* () {
		const target = yield* current(t, 'holiday', HOLIDAY);
		yield* wrote(t, (hr) => hr.act({ 'holiday.delete': [{ target }] }));
	});
/** The holiday on another day: a Sunday nobody is rostered on. */
const holidayMoved = (t: Kit) =>
	Effect.gen(function* () {
		const target = yield* current(t, 'holiday', HOLIDAY);
		yield* wrote(t, (hr) =>
			hr.act({ 'holiday.update': [{ target, set: { date: '2026-01-18' } }] })
		);
	});
const joinedLater = (t: Kit) =>
	Effect.gen(function* () {
		const held = yield* stintOf(t);
		yield* wrote(t, (hr) =>
			hr.act({
				'employment.update': [
					{ target: held, set: { effective_range: { from: '2026-01-12', to: null } } }
				]
			})
		);
	});

describe('every other record a run reads, corrected after its month was paid', () => {
	for (const [was, is] of [
		[80, 60],
		[60, 80]
	] as const)
		it.live(
			`a claim’s amount, ${was} to ${is}: the next payslip carries the difference, as B`,
			() =>
				parity(rostered(MONTHS), {
					wrong: (t) => claimed(t, was),
					correct: (t, entry) =>
						Effect.gen(function* () {
							const target = yield* current(t, 'claim_catalog_entry', entry);
							yield* wrote(t, (hr) =>
								hr.act({
									'claim_catalog_entry.update': [{ target, set: { quantity: String(is) } }]
								})
							);
						}),
					right: (t) => claimed(t, is)
				})
		);
	it.live('a claim that never was: deleted, the next payslip takes it back, as B', () =>
		parity(rostered(MONTHS), {
			wrong: (t) => claimed(t, 80),
			correct: (t, entry) =>
				Effect.gen(function* () {
					const target = yield* current(t, 'claim_catalog_entry', entry);
					yield* wrote(t, (hr) => hr.act({ 'claim_catalog_entry.delete': [{ target }] }));
				}),
			right: nothing
		})
	);
	it.live('a claim keyed after its month was paid: the next payslip pays it, as B', () =>
		parity(rostered(MONTHS), {
			wrong: nothing,
			correct: (t) => claimed(t, 80),
			right: (t) => claimed(t, 80)
		})
	);
	it.live('an ad hoc payment’s amount: the next payslip carries the difference, as B', () =>
		parity(rostered(MONTHS), {
			wrong: (t) => awarded(t, 'BONUS', 500),
			correct: (t, entry) =>
				Effect.gen(function* () {
					const target = yield* current(t, 'adhoc_catalog_entry', entry);
					yield* wrote(t, (hr) =>
						hr.act({ 'adhoc_catalog_entry.update': [{ target, set: { quantity: '300' } }] })
					);
				}),
			right: (t) => awarded(t, 'BONUS', 300)
		})
	);
	it.live('an ad hoc payment keyed as the wrong item: changed where it stands, as B', () =>
		parity(rostered(MONTHS), {
			wrong: (t) => awarded(t, 'BONUS', 500),
			correct: (t, entry) =>
				Effect.gen(function* () {
					const target = yield* current(t, 'adhoc_catalog_entry', entry);
					yield* wrote(t, (hr) =>
						hr.act({
							'adhoc_catalog_entry.update': [
								{
									target,
									set: { catalog_code: 'EXCELLENCE_AWARD', description: 'EXCELLENCE_AWARD' }
								}
							]
						})
					);
				}),
			right: (t) => awarded(t, 'EXCELLENCE_AWARD', 500)
		})
	);
	for (const [was, is] of [
		['ANNUAL_LEAVE', 'NPL'],
		['NPL', 'ANNUAL_LEAVE']
	] as const)
		it.live(
			`leave keyed as ${was} that was ${is}: changed where it stands, pay and days as B`,
			() =>
				parity(rostered(MONTHS), {
					wrong: (t) => keyed(t, was, NPL_DAYS),
					correct: (t, entry) =>
						Effect.gen(function* () {
							const target = yield* current(t, 'leave_catalog_entry', entry);
							yield* wrote(t, (hr) =>
								hr.act({ 'leave_catalog_entry.update': [{ target, set: { catalog_code: is } }] })
							);
						}),
					right: (t) => keyed(t, is, NPL_DAYS)
				})
		);
	it.live('a roster day that was not worked: deleted, as B', () =>
		parity(rostered(MONTHS), {
			wrong: nothing,
			correct: (t) => rosterDayGone(t),
			right: (t) => rosterDayGone(t)
		})
	);
	it.live('a holiday declared on a day already paid as worked: as B', () =>
		parity(rostered(MONTHS), { wrong: nothing, correct: holidayDeclared, right: holidayDeclared })
	);
	it.live('a holiday that never was, deleted after its day was paid as one worked: as B', () =>
		parity(withHoliday(), { wrong: nothing, correct: holidayGone, right: holidayGone })
	);
	it.live('a holiday moved off the day already paid as a holiday worked: as B', () =>
		parity(withHoliday(), { wrong: nothing, correct: holidayMoved, right: holidayMoved })
	);
	it.live('the company’s overtime hour, dated in the paid month: as B', () =>
		parity(rostered(MONTHS, OVERTIME_DAY), {
			wrong: nothing,
			correct: contractHour,
			right: contractHour
		})
	);
	it.live('the first day of work, moved into the paid month: as B', () =>
		parity(rostered(MONTHS), { wrong: nothing, correct: joinedLater, right: joinedLater })
	);
	it.live('the date of birth: the schemes that read the age are worked out again, as B', () =>
		parity(rostered(MONTHS), { wrong: nothing, correct: bornEarlier, right: bornEarlier })
	);
});
