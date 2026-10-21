/** A time-off range charges the employment's real seeded plan in its class's unit. */
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { DbError } from '@norbital-ai/bolt/engine';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Effect, Schema } from 'effect';
import { requestDays } from '../src/lib/payroll_engine/leave_days.ts';
import type { CallerRead } from '../src/lib/payroll_engine/foundation.js';
import { lineage } from './jurisdiction_kit.js';
import { faultWorkspace, ReadFault } from './native_db.js';

const COMPANY = 'd0000000-0000-4000-8000-000000000001';
const PERSON = 'd0000000-0000-4000-8000-000000000002';
const EMPLOYMENT = 'd0000000-0000-4000-8000-000000000003';
const PATTERN = 'd0000000-0000-4000-8000-000000000004';
const SHIFTS = {
	W: 'd0000000-0000-4000-8000-000000000005',
	R: 'd0000000-0000-4000-8000-000000000006',
	O: 'd0000000-0000-4000-8000-000000000007'
} as const;
const CLASSES = {
	day: 'd0000000-0000-4000-8000-000000000008',
	calendar: 'd0000000-0000-4000-8000-000000000009',
	hour: 'd0000000-0000-4000-8000-00000000000a',
	refuse: 'd0000000-0000-4000-8000-00000000000d',
	unstated: 'd0000000-0000-4000-8000-00000000000e'
} as const;
const LAW = lineage('SG');
const annual = LAW.byCode('version_2', 'leave_catalog', 'ANNUAL_LEAVE');
const Seed = Schema.Record(Schema.String, Schema.Array(Schema.Record(Schema.String, Schema.Json)));
const fixture = Effect.fnUntraced(function* <A, E>(
	patternId: string | null,
	run: (ids: {
		employment_id: Parameters<typeof requestDays>[0]['employment_id'];
		classes: ReadonlyMap<string, Parameters<typeof requestDays>[0]['catalog_id']>;
		read: CallerRead;
		t: TestWorkspace['Service'];
		fault: ReadFault['Service'];
	}) => Effect.Effect<A, E>
) {
	const seed = Schema.decodeUnknownSync(Seed)({
		...Object.fromEntries(LAW.law()),
		entity: [
			{
				id: COMPANY,
				name: 'Omni',
				settings_code: 'SG',
				pay_cutoff_day: 1,
				effective_range: { from: '2020-01-01', to: null }
			}
		],
		employment_profile: [{ id: PERSON, name: 'Test employee' }],
		employment_contract: [
			{
				id: EMPLOYMENT,
				company_id: COMPANY,
				employee_id: PERSON,
				employee_number: 'E1',
				contract_number: 1,
				effective_range: { from: '2020-01-01', to: null },
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2020-01-01', to: null },
							base_salary: { value: 1, currency: 'SGD' },
							...(patternId === null ? {} : { shift_pattern_id: patternId })
						}
					]
				}
			}
		],
		leave_catalog: Object.entries(CLASSES).map(([code, id]) => ({
			...annual,
			id,
			code,
			unit: code === 'calendar' ? 'CALENDAR_DAY' : code === 'hour' ? 'HOUR' : 'DAY',
			unplanned_days:
				code === 'refuse' ? 'REFUSE' : code === 'unstated' ? null : annual['unplanned_days']
		})),
		roster_entry: [
			{
				id: 'd0000000-0000-4000-8000-00000000000b',
				employment_id: EMPLOYMENT,
				work_date: '2026-03-07',
				shift_definition_id: SHIFTS.W
			}
		],
		shift_definition: Object.entries(SHIFTS).map(([code, id]) => ({
			id,
			company_id: COMPANY,
			code,
			variant: {
				day_type: code === 'W' ? 'WORK' : code === 'R' ? 'REST' : 'OFF',
				start_time: '09:00',
				end_time: '18:00',
				break_minutes: 60
			}
		})),
		shift_pattern: [
			{
				id: PATTERN,
				company_id: COMPANY,
				code: 'WEEK',
				effective_range: { from: '2026-03-02', to: null },
				pattern: {
					days: ['W', 'W', 'W', 'W', 'W', 'R', 'O'].map((code) => ({
						roster_code_id: code === 'W' ? SHIFTS.W : code === 'R' ? SHIFTS.R : SHIFTS.O
					}))
				}
			}
		],
		holiday: [
			{
				id: 'd0000000-0000-4000-8000-00000000000c',
				company_id: COMPANY,
				date: '2026-03-04',
				name: 'Published holiday',
				kind: 'PUBLIC_HOLIDAY',
				published_at: '2026-01-01T00:00:00.000Z'
			}
		]
	});
	return yield* Effect.gen(function* () {
		const t = yield* TestWorkspace;
		const fault = yield* ReadFault;
		const read = t.as(t.admin).read;
		const got = yield* read({
			employment: { collection: 'employment_contract', all: true },
			classes: { collection: 'leave_catalog', select: { code: true }, all: true }
		});
		const employment = got.employment.rows[0];
		assert.ok(employment);
		const classes = new Map<string, Parameters<typeof requestDays>[0]['catalog_id']>();
		for (const row of got.classes.rows) {
			assert.ok(typeof row.code === 'string');
			classes.set(row.code, row.id);
		}
		t.count.reset();
		fault.clear();
		return yield* run({ employment_id: employment.id, classes, read, t, fault });
	}).pipe(Effect.provide(faultWorkspace({ seed })));
});
const count = Effect.fnUntraced(function* (
	code: string,
	extra: Omit<Parameters<typeof requestDays>[0], 'employment_id' | 'catalog_id' | 'from'> = {},
	patternId: string | null = PATTERN
) {
	return yield* fixture(patternId, ({ employment_id, classes, read }) =>
		Effect.gen(function* () {
			const catalog_id = classes.get(code);
			assert.ok(catalog_id);
			return yield* requestDays(
				{ employment_id, catalog_id, from: '2026-03-02', to: '2026-03-08', ...extra },
				read
			);
		})
	);
});

describe('leave days', () => {
	it.effect('refuses an invalid range before starting any reads', () =>
		fixture(PATTERN, ({ employment_id, classes, read, t }) =>
			Effect.gen(function* () {
				const catalog_id = classes.get('day');
				assert.ok(catalog_id);
				assert.equal(
					yield* requestDays(
						{ employment_id, catalog_id, from: '2026-03-08', to: '2026-03-02' },
						read
					),
					'Choose the first and last day of the leave.'
				);
				assert.equal(t.count.reads, 0);
			})
		)
	);

	it.effect('preserves a failed catalogue lookup instead of treating it as an absent class', () =>
		fixture(PATTERN, ({ employment_id, classes, read, t, fault }) =>
			Effect.gen(function* () {
				const catalog_id = classes.get('day');
				assert.ok(catalog_id);
				const failure = DbError.make('XX000', 'Catalogue unavailable');
				fault.arm(failure);
				assert.equal(yield* Effect.flip(t.db.read([])), failure);
				const nativeFailure = yield* Effect.flip(
					read('leave_catalog', { where: { id: { eq: catalog_id } }, limit: 1 })
				);
				const refused = yield* Effect.flip(
					requestDays({ employment_id, catalog_id, from: '2026-03-02' }, read)
				);
				assert.equal(refused.message, nativeFailure.message);
				fault.clear();
			})
		)
	);

	it.effect(
		'charges the planned working days less published holidays, the roster day winning over the pattern',
		Effect.fnUntraced(function* () {
			assert.deepEqual(yield* count('day'), {
				days: 5,
				unit: 'DAY',
				off: ['2026-03-04', '2026-03-08']
			});
			const half = yield* count('day', { half_day_start: true });
			assert.ok(half && typeof half !== 'string');
			assert.equal(half.days, 4.5);
		})
	);

	it.effect(
		'a calendar-day class charges every day, an hour class the scheduled hours',
		Effect.fnUntraced(function* () {
			assert.deepEqual(yield* count('calendar'), { days: 7, unit: 'CALENDAR_DAY', off: [] });
			const hours = yield* count('hour');
			assert.ok(hours && typeof hours !== 'string');
			assert.equal(hours.days, 40);
			const half = yield* count('hour', { half_day_end: true });
			assert.ok(half && typeof half !== 'string');
			assert.equal(half.days, 36);
		})
	);

	it.effect(
		'nothing planned charges the calendar days less published holidays; hours need a plan; a reversed range refuses',
		Effect.fnUntraced(function* () {
			const rostered = yield* count('day', {}, null);
			assert.ok(rostered && typeof rostered !== 'string');
			assert.equal(rostered.days, 1);
			const unplanned = { to: '2026-03-06' };
			assert.deepEqual(yield* count('day', unplanned, null), {
				days: 4,
				unit: 'DAY',
				off: ['2026-03-04']
			});
			assert.equal(typeof (yield* count('hour', unplanned, null)), 'string');
			assert.equal(typeof (yield* count('day', { to: '2026-03-01' })), 'string');
		})
	);

	it.effect(
		'a range with nothing planned charges as the class’s unplanned_days states; a class stating none is refused',
		Effect.fnUntraced(function* () {
			const unplanned = { to: '2026-03-06' };
			assert.equal(annual['unplanned_days'], 'EVERY_DAY_BUT_HOLIDAYS');
			assert.equal(
				yield* count('refuse', unplanned, null),
				'Nothing is planned in this range: plan the shifts first.'
			);
			assert.match(
				String(yield* count('unstated', unplanned, null)),
				/Leave class unstated \(leave_catalog\) needs unplanned_days/
			);
			// A planned range never reads it.
			const planned = yield* count('refuse');
			assert.ok(planned && typeof planned !== 'string');
			assert.equal(planned.days, 5);
		})
	);
});
