// Leave falls on days the person works. One check answers for the form and the server: the roster's day, else the
// pattern's or the ordinary week's, exactly as a run plans it, and the holidays that are theirs.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect } from 'effect';
import { lawsOf } from '../../src/lib/law.ts';
import { knownOf, leaveShort, leaveTaken } from '../../src/lib/ledger/service.ts';
import { leaveOffDay, type LeaveDays } from '../../src/lib/payroll_engine/attendance.ts';
import { jsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { idOf, queryRows } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	leaveCreate,
	pack,
	packTerms,
	refusal,
	storedReader,
	syncAll,
	uuid,
	wholeDays,
	workspace
} from '../kit.ts';

// 2026-07-18 is a Saturday, 2026-07-19 a Sunday, 2026-07-20 a Monday
const [SATURDAY, SUNDAY, MONDAY] = ['2026-07-18', '2026-07-19', '2026-07-20'] as const;
const days = (own: Partial<LeaveDays> & { readonly week?: number }): LeaveDays => ({
	terms: () => (own.week === undefined ? {} : { normal_days_per_week: own.week }),
	employer: () => ({ payment_schedule: { non_working_weekdays: [0, 6] } }),
	shifts: new Map(),
	patterns: new Map(),
	roster: new Map(),
	holidays: [],
	employee: 'p1',
	...own
});
const holiday = (date: string, more: Record<string, unknown> = {}) => ({
	date,
	published_at: '2026-01-01T00:00:00.000Z',
	employee_id: null,
	given_to: 'EVERYONE',
	...more
});

describe('the day leave may fall on', () => {
	it('is a day of the ordinary week, which a six-day contract widens', () => {
		assert.equal(leaveOffDay(MONDAY, days({})), undefined);
		assert.equal(leaveOffDay(SATURDAY, days({})), 'REST');
		assert.equal(leaveOffDay(SATURDAY, days({ week: 6 })), undefined);
		assert.equal(leaveOffDay(SUNDAY, days({ week: 6 })), 'REST');
	});
	it('follows the roster before the plan: a rostered Sunday is worked, a rostered-off Monday is not', () => {
		const shifts = new Map([
			['work', { variant: { day_type: 'WORK' } }],
			['off', { variant: { day_type: 'REST' } }]
		]);
		const roster = new Map([
			[SUNDAY, { shift_definition_id: 'work' }],
			[MONDAY, { shift_definition_id: 'off' }]
		]);
		assert.equal(leaveOffDay(SUNDAY, days({ shifts, roster })), undefined);
		assert.equal(leaveOffDay(MONDAY, days({ shifts, roster })), 'REST');
	});
	it('is no holiday of theirs: unpublished, another person’s, or one in lieu of a day they worked is not', () => {
		assert.equal(leaveOffDay(MONDAY, days({ holidays: [holiday(MONDAY)] })), 'HOLIDAY');
		assert.equal(
			leaveOffDay(MONDAY, days({ holidays: [holiday(MONDAY, { published_at: null })] })),
			undefined
		);
		assert.equal(
			leaveOffDay(MONDAY, days({ holidays: [holiday(MONDAY, { employee_id: 'p2' })] })),
			undefined
		);
		const inLieu = holiday(MONDAY, {
			given_to: 'ONLY_IF_OFF_ON_REPLACED_DATE',
			replaces: SATURDAY
		});
		// off on the Saturday it replaces: the Monday is theirs; a six-day week worked it, so it is not
		assert.equal(leaveOffDay(MONDAY, days({ holidays: [inLieu] })), 'HOLIDAY');
		assert.equal(leaveOffDay(MONDAY, days({ week: 6, holidays: [inLieu] })), undefined);
	});
});

describe('a leave entry written to the server', () => {
	const seed = {
		...pack('MY', 'Asia/Kuala_Lumpur', packTerms(3120, 'MANUAL_LABOUR'), {}, [], []),
		holiday: [
			{
				id: uuid(20),
				entity_id: ENTITY,
				kind: 'PUBLIC_HOLIDAY',
				given_to: 'EVERYONE',
				published_at: '2025-12-01T00:00:00.000Z',
				date: '2026-07-21',
				name: 'Public'
			}
		]
	};
	const ask = (date: string) =>
		leaveCreate({
			entity_id: ENTITY,
			employment_id: idOf('employment', uuid(6)),
			catalog_code: 'ANNUAL_LEAVE',
			days: wholeDays(date)
		});
	it.live(
		'is refused on a rest day and on a holiday, whoever writes it, and taken on a working day',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const admin = yield* t.as(t.admin);
				const me = yield* t.as(t.member(['employee'], { id: uuid(3) }));
				for (const by of [admin, me]) {
					const rest = yield* refusal(by.act({ 'leave_catalog_entry.create': [ask(SATURDAY)] }));
					assert.match(String(rest.message), /2026-07-18 is a rest day/);
					const off = yield* refusal(by.act({ 'leave_catalog_entry.create': [ask('2026-07-21')] }));
					assert.match(String(off.message), /2026-07-21 is a holiday/);
				}
				yield* admin.act({ 'leave_catalog_entry.create': [ask(MONDAY)] });
			}).pipe(Effect.provide(workspace({ seed, now: '2026-08-05T02:00:00.000Z' })))
	);
	it.live(
		'is judged by the form, from the rows a page reads, in the words the write refuses with',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const admin = yield* t.as(t.admin);
				yield* admin.act({ 'leave_catalog_entry.create': [ask(MONDAY)] });
				yield* t.run_due();
				// the roots the leave form queries, with an entry's half-days under it
				const found = yield* queryRows(storedReader(t), {
					employment: { limit: 100, entity_id: { fields: ['settings_code'] } },
					contract_terms: { limit: 100 },
					statutory_parameters: { limit: 100 },
					employee_profile: { limit: 100 },
					dependant: { limit: 100 },
					employee_balance: { limit: 100 },
					ledger_entry: { where: { source: { like: 'leave_catalog_entry:%' } }, limit: 1000 },
					leave_catalog_entry: { limit: 100, leave_catalog_entry_day: { limit: 1000 } },
					jurisdiction: { limit: 100 },
					jurisdiction_change: { limit: 1000, finding_id: { fields: ['status'] } }
				});
				const filed = found.leave_catalog_entry ?? [];
				const known = knownOf(
					found,
					filed,
					filed.flatMap((row) =>
						(Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : []).map(
							jsonObject
						)
					),
					lawsOf(found)
				);
				assert.deepEqual(
					[...leaveTaken(known)].map((slot) => slot.slice(slot.indexOf('/') + 1)).toSorted(),
					[`${MONDAY}/AM`, `${MONDAY}/PM`]
				);
				const weekdays = Array.from({ length: 400 }, (_, index) =>
					DateTime.formatIsoDateUtc(
						DateTime.add(DateTime.makeUnsafe('2026-08-10'), { days: index })
					)
				).filter(
					(date) => ![0, 6].includes(DateTime.toPartsUtc(DateTime.makeUnsafe(date)).weekDay)
				);
				for (const [days, said] of [
					[wholeDays(MONDAY), /^Leave already covers 2026-07-20\.$/],
					[wholeDays(...weekdays.slice(0, 40)), /^ANNUAL_LEAVE: insufficient balance\.$/]
				] as const) {
					const entry = {
						entity_id: ENTITY,
						employment_id: idOf('employment', uuid(6)),
						catalog_code: 'ANNUAL_LEAVE',
						days
					};
					const verdict = leaveShort(known, [jsonObject(entry)], '2026-08-05');
					assert.match(String(verdict), said);
					const refused = yield* refusal(
						admin.act({ 'leave_catalog_entry.create': [leaveCreate(entry)] })
					);
					assert.equal(refused.message, verdict);
				}
			}).pipe(Effect.provide(workspace({ seed, now: '2026-08-05T02:00:00.000Z' })))
	);
});
