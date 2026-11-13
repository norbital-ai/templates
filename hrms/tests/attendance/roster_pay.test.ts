// The roster is the cycle's source of truth, as an HR controller and a kiosk drive it: a planned day pays only when the
// clock covers it, an absence comes off the basic at its checkpoint, nothing is priced twice, and a work event or a
// holiday changes pay only through the rows that read it. The MY pack is the fixture, never the subject.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import type { Instant } from '@norbital-ai/bolt';
import { DateTime, Duration, Effect, Schema } from 'effect';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	OFF,
	REST,
	WORK,
	accountsIn,
	lawWith,
	leaveCreate,
	measureOf,
	pack,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	storedQuery
} from '../kit.ts';

type Seed = ReturnType<typeof pack>;
const NOW = '2026-02-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const TERMS = {
	rate: { amount: 3120, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};

/** A clock time on a date in the fixture's zone (UTC+8), as an instant. */
const at = (date: string, clock: string) => new Date(`${date}T${clock}:00+08:00`).toISOString();
type Span = readonly [from: string, to: string];
// the fixture's day shift, 08:00–16:00
const SHIFT: Span = ['08:00', '16:00'];
type Day = {
	readonly date: string;
	readonly shift: string;
	readonly clock?: Span;
	readonly plan?: Span;
};
const span = (date: string, [from, to]: Span) => ({ start: at(date, from), end: at(date, to) });
const rosterRow = (id: string, employment: string, day: Day): JsonObject => ({
	id,
	employment_id: employment,
	work_date: day.date,
	shift_definition_id: day.shift,
	actual_worked_intervals: day.clock === undefined ? [] : [span(day.date, day.clock)],
	planned_overtime_intervals: day.plan === undefined ? null : [span(day.date, day.plan)],
	findings: []
});
const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
/** February as rostered: every weekday a clocked day shift, the weekend off. `over` replaces a day, or with null leaves it out. */
const month = (
	over: Readonly<Record<string, Day | null>> = {},
	until = '2026-02-28'
): readonly Day[] =>
	Array.from(
		{
			length:
				Duration.toDays(
					DateTime.distance(DateTime.makeUnsafe('2026-02-01'), DateTime.makeUnsafe(until))
				) + 1
		},
		(_, i) => DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe('2026-02-01'), { days: i }))
	)
		.map(String)
		.flatMap((date) => {
			const own = over[date];
			if (own === null) return [];
			return [own ?? (weekend(date) ? { date, shift: OFF } : { date, shift: WORK, clock: SHIFT })];
		});
const seedOf = (days: readonly Day[], code = 'MY', zone = 'Asia/Kuala_Lumpur'): Seed => {
	const seed = pack(code, zone, TERMS, {}, [], []);
	return {
		...seed,
		roster_entry: days.map((day, index) => rosterRow(uuid(1000 + index), uuid(6), day))
	};
};
/** The same company with `count` people: each a copy of the first, with a roster of their own. */
const withPeople = (seed: Seed, count: number): Seed => {
	const [user] = seed.sys_user ?? [];
	const [profile] = seed.employee_profile ?? [];
	const [balance] = seed.employee_balance ?? [];
	const [contract] = seed.employee_contract ?? [];
	assert.ok(user !== undefined && profile !== undefined);
	assert.ok(balance !== undefined && contract !== undefined);
	const more = Array.from({ length: count - 1 }, (_, index) => index + 1);
	const id = (person: number, part: number) => uuid(9000 + person * 10 + part);
	return {
		...seed,
		sys_user: [
			...(seed.sys_user ?? []),
			...more.map((n) => ({ ...user, id: id(n, 3), email: `worker${n}@example.test` }))
		],
		employee_profile: [
			...(seed.employee_profile ?? []),
			...more.map((n) => ({ ...profile, id: id(n, 4), user_id: id(n, 3) }))
		],
		employee_balance: [
			...(seed.employee_balance ?? []),
			...more.map((n) => ({ ...balance, id: id(n, 5), employee_id: id(n, 4) }))
		],
		employee_contract: [
			...(seed.employee_contract ?? []),
			...more.map((n) => ({
				...contract,
				id: id(n, 6),
				employee_id: id(n, 4),
				employee_number: `W${n + 1}`
			}))
		],
		roster_entry: [
			...(seed.roster_entry ?? []),
			...more.flatMap((n) =>
				(seed.roster_entry ?? []).map((row, index) => ({
					...row,
					id: uuid(100_000 * n + index),
					employment_id: id(n, 6)
				}))
			)
		]
	};
};
/** The second person `withPeople` adds. */
const SECOND = { employee: uuid(9014), contract: uuid(9016) };

const run = (t: Kit, period = '2026-02') =>
	t
		.as(t.admin)
		.pipe(
			Effect.flatMap((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
/** One person's payslip of a period's run: net, checkpoints by code and lines, without the ids a workspace mints. */
const slipOf = (t: Kit, period = '2026-02', employment: string = uuid(6)) =>
	storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) => {
			const ran = got.payroll_run.rows.find((row) => row.period === period);
			const slip = got.payslip.rows.find(
				(row) => row.payroll_run_id === ran?.id && row.employment_id === employment
			);
			assert.ok(slip !== undefined, `no payslip for ${period}`);
			const { checkpoints, lines } = Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown);
			return {
				net: Number(slip.net_pay),
				checkpoints: checkpoints.map(({ code, value }) => [code, value] as const),
				lines: lines.map(({ code, amount, direction, source }) => ({
					code,
					amount,
					direction,
					source
				}))
			};
		})
	);
type Slip = Effect.Success<ReturnType<typeof slipOf>>;
const checkpoint = (slip: Slip, code: string): number => {
	const found = slip.checkpoints.find(([name]) => name === code);
	assert.ok(found !== undefined, `no ${code} checkpoint`);
	return found[1];
};
const line = (slip: Slip, code: string): number =>
	slip.lines.filter((row) => row.code === code).reduce((total, row) => total + row.amount, 0);
const net = (slip: Slip): number => {
	assert.ok(slip.net !== undefined);
	return slip.net;
};
/** February's payslip of a seed, in a workspace of its own, after what HR does first. */
const paid = <E = never>(
	seed: Seed,
	first: (t: Kit) => Effect.Effect<unknown, E> = () => Effect.void
) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* first(t);
		yield* run(t);
		return yield* slipOf(t);
	}).pipe(Effect.provide(workspace({ seed, now: NOW })));
const rosterOn = (t: Kit, date: string) =>
	storedQuery(t, { roster_entry: { limit: 1000 } }).pipe(
		Effect.map(({ roster_entry }) => {
			const row = roster_entry.rows.find(
				(entry) => String(entry.work_date) === date && entry.employment_id === uuid(6)
			);
			assert.ok(row !== undefined, `no roster day on ${date}`);
			return row;
		})
	);
const clockIn = (date: string, [from, to]: Span) => [
	{
		start: DateTime.formatIso(DateTime.makeUnsafe(at(date, from))),
		end: DateTime.formatIso(DateTime.makeUnsafe(at(date, to)))
	}
];
const runsHeld = (t: Kit) =>
	storedQuery(t, { payroll_run: { limit: 100 } }).pipe(Effect.map((got) => got.payroll_run.rows));
// each of these workspaces has run once, unpaid, when a roster day is refused under it
const HELD = /Run 1 holds this person and is not paid yet/;

// a Tuesday and a Sunday of the month
const DAY = '2026-02-10';
const SUNDAY = '2026-02-08';
const unclocked = month({ [DAY]: { date: DAY, shift: WORK } });

describe('an absence, read from the roster by a real run', () => {
	it.live('comes off the basic at its checkpoint, with no line of its own', () =>
		Effect.gen(function* () {
			const worked = yield* paid(seedOf(month()));
			const absent = yield* paid(seedOf(unclocked));
			// the day the roster leaves out altogether is the same absence
			const leftOut = yield* paid(seedOf(month({ [DAY]: null })));
			assert.equal(checkpoint(worked, 'PRORATED'), checkpoint(worked, 'BASIC'));
			assert.equal(checkpoint(absent, 'BASIC'), checkpoint(worked, 'BASIC'));
			assert.ok(checkpoint(absent, 'PRORATED') < checkpoint(absent, 'BASIC'));
			assert.ok(checkpoint(absent, 'PRORATED') > 0);
			assert.equal(line(absent, 'BASIC'), line(worked, 'BASIC'));
			assert.deepEqual(
				absent.lines.filter((row) => row.code === 'ABS'),
				[]
			);
			assert.ok(net(absent) < net(worked));
			assert.equal(checkpoint(leftOut, 'PRORATED'), checkpoint(absent, 'PRORATED'));
		})
	);

	it.live(
		'is not also taken when leave holds the day: the leave line is all that comes off',
		() => {
			const seed = seedOf(unclocked);
			return paid(seed, (t) =>
				t.as(t.admin).pipe(
					Effect.flatMap((caller) =>
						caller.act({
							'leave_catalog_entry.create': [
								leaveCreate({
									entity_id: ENTITY,
									employment_id: CONTRACT,
									catalog_code: 'NPL',
									days: wholeDays(DAY)
								})
							]
						})
					)
				)
			).pipe(
				Effect.map((slip) => {
					assert.equal(checkpoint(slip, 'PRORATED'), checkpoint(slip, 'BASIC'));
					assert.ok(line(slip, 'NPL') > 0);
					assert.ok(
						Math.abs(
							checkpoint(slip, 'PAID_BASIC') - (checkpoint(slip, 'BASIC') - line(slip, 'NPL'))
						) < 1e-6,
						JSON.stringify(slip.checkpoints)
					);
				})
			);
		}
	);

	it.live(
		'a clock entered under an unpaid run is refused; deleting the run lets it in, and the rerun pays the day once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t);
				const before = yield* slipOf(t);
				assert.ok(checkpoint(before, 'PRORATED') < checkpoint(before, 'BASIC'));
				const sealed = yield* rosterOn(t, DAY);
				assert.ok(sealed.payroll_run_id != null);
				// the day as stored at each try: deleting the run unlinks it, a new revision
				const late = () =>
					Effect.all([t.as(t.admin), rosterOn(t, DAY)]).pipe(
						Effect.flatMap(([caller, target]) =>
							caller.act({
								'roster_entry.update': [
									{ target, set: { actual_worked_intervals: clockIn(DAY, SHIFT) } }
								]
							})
						)
					);
				assert.match(String(yield* Effect.flip(late())), HELD);
				// the way out while the run is unpaid: delete it, which frees the days it sealed
				const [first] = yield* runsHeld(t);
				assert.ok(first !== undefined);
				yield* (yield* t.as(t.admin)).act({ 'payroll_run.delete': [{ target: first }] });
				yield* t.run_due();
				assert.equal((yield* rosterOn(t, DAY)).payroll_run_id ?? null, null);
				yield* late();
				yield* run(t);
				const after = yield* slipOf(t);
				assert.equal(checkpoint(after, 'PRORATED'), checkpoint(after, 'BASIC'));
				assert.equal((yield* runsHeld(t)).length, 1);
				assert.equal((yield* storedQuery(t, { payslip: { limit: 100 } })).payslip.rows.length, 1);
			}).pipe(Effect.provide(workspace({ seed: seedOf(unclocked), now: NOW })))
	);

	it.live(
		'once the run is paid the clock is entered on the day itself: the payslip stands and the next run takes the month up',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t);
				const february = yield* slipOf(t);
				const [first] = yield* runsHeld(t);
				assert.ok(first !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.update': [{ target: first, set: { state: 'PAID' } }]
				});
				yield* t.run_due();
				const sealed = yield* rosterOn(t, DAY);
				yield* (yield* t.as(t.admin)).act({
					'roster_entry.update': [
						{ target: sealed, set: { actual_worked_intervals: clockIn(DAY, SHIFT) } }
					]
				});
				const amendments = storedQuery(t, { pay_amendment: { limit: 100 } }).pipe(
					Effect.map(({ pay_amendment }) =>
						pay_amendment.rows.map((row) => [row.period, row.payroll_run_id])
					)
				);
				// the correction left one open row for the person's February
				assert.deepEqual(yield* amendments, [['2026-02', null]]);
				// the run as stored now: paying it made a new revision
				const paidRun = (yield* runsHeld(t)).find((row) => row.id === first.id);
				assert.ok(paidRun !== undefined);
				const dropped = t
					.as(t.admin)
					.pipe(
						Effect.flatMap((caller) => caller.act({ 'payroll_run.delete': [{ target: paidRun }] }))
					);
				assert.match(
					String(yield* Effect.flip(dropped)),
					/This record is locked and cannot be changed/
				);
				yield* run(t, '2026-03');
				const march = (yield* runsHeld(t)).find((row) => row.period === '2026-03');
				assert.ok(march !== undefined);
				assert.deepEqual(yield* amendments, [['2026-02', march.id]]);
				assert.deepEqual(yield* slipOf(t), february);
			}).pipe(
				Effect.provide(workspace({ seed: seedOf(unclocked), now: '2026-03-28T02:00:00.000Z' }))
			)
	);
});

describe('a clock the plan does not back', () => {
	it.live('on a rest day with no planned overtime pays nothing', () =>
		Effect.gen(function* () {
			const rest = (day: Omit<Day, 'date' | 'shift'>) =>
				paid(seedOf(month({ [SUNDAY]: { date: SUNDAY, shift: REST, ...day } })));
			const quiet = yield* rest({});
			const clocked = yield* rest({ clock: SHIFT });
			const planned = yield* rest({ clock: SHIFT, plan: SHIFT });
			assert.deepEqual(clocked, quiet);
			// the same clock under a plan is paid: the plan, not the clock, is what was missing
			assert.ok(net(planned) > net(quiet));
		})
	);

	it.live('pays planned overtime only as far as the clock covers it', () =>
		Effect.gen(function* () {
			const overtime = (until: string, seed = (days: readonly Day[]) => seedOf(days)) =>
				paid(
					seed(
						month({
							[DAY]: { date: DAY, shift: WORK, clock: ['08:00', until], plan: ['16:00', '18:00'] }
						})
					)
				).pipe(Effect.map((slip) => line(slip, 'OVERTIME')));
			const none = yield* overtime('16:00');
			const half = yield* overtime('17:00');
			const whole = yield* overtime('18:00');
			assert.equal(none, 0);
			assert.ok(half > 0 && half < whole, `${half} of ${whole}`);
			// the company's own threshold awards the whole plan from half of it clocked
			const lenient = yield* overtime('17:00', (days) => {
				const seed = seedOf(days);
				return {
					...seed,
					entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
						...row,
						overtime_full_award_percent: 50
					}))
				};
			});
			assert.equal(lenient, whole);
		})
	);
});

describe('a roster the employment does not cover', () => {
	const LAST = '2026-02-11';
	const leaver = (days: readonly Day[]): Seed => {
		const seed = seedOf(days);
		return {
			...seed,
			employee_contract: (seed.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: '2025-01-01', to: LAST }
			}))
		};
	};
	// the month was planned before the exit was sealed: the days after it are still on the roster
	const planned = month().map((day) =>
		day.date <= LAST || day.shift !== WORK
			? day
			: day.date === '2026-02-17'
				? { ...day, clock: ['08:00', '18:00'] as const, plan: ['16:00', '18:00'] as const }
				: { date: day.date, shift: WORK }
	);
	it.live('days rostered past the last day are neither absences nor pay', () =>
		Effect.gen(function* () {
			const control = yield* paid(leaver(month({}, LAST)));
			assert.ok(checkpoint(control, 'PRORATED') > 0);
			assert.deepEqual(yield* paid(leaver(planned)), control);
		})
	);
});

describe('one roster day a person', () => {
	it.live('a second row for the same day is refused; the day is changed on its own row', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const again = yield* Effect.flip(
				t.as(t.admin).pipe(
					Effect.flatMap((caller) =>
						caller.act({
							'roster_entry.create': [
								{
									employment_id: CONTRACT,
									work_date: DAY,
									shift_definition_id: idOf('shift_definition', WORK)
								}
							]
						})
					)
				)
			);
			assert.match(String(again), /another record already has this/);
			const held = yield* rosterOn(t, DAY);
			yield* (yield* t.as(t.admin)).act({
				'roster_entry.update': [
					{
						target: held,
						set: { planned_overtime_intervals: clockIn(DAY, ['16:00', '18:00']) }
					}
				]
			});
			const { roster_entry } = yield* storedQuery(t, { roster_entry: { limit: 1000 } });
			assert.equal(roster_entry.rows.filter((row) => String(row.work_date) === DAY).length, 1);
		}).pipe(Effect.provide(workspace({ seed: seedOf(month()), now: NOW })))
	);
});

describe('a kiosk punch', () => {
	const seed = seedOf(month({ [DAY]: null }));
	const punch = (t: Kit, intervals: readonly { start: Instant; end?: Instant }[]) =>
		t.as(t.member(['kiosk'])).pipe(
			Effect.flatMap((caller) =>
				caller.act({
					'roster_entry.create': [
						{
							employment_id: CONTRACT,
							work_date: DAY,
							actual_worked_intervals: [...intervals]
						}
					]
				})
			)
		);
	it.live('with nothing but its clock commits, and the run reads it as the day attended', () =>
		Effect.gen(function* () {
			const absent = yield* paid(seed);
			const punched = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const written = yield* punch(t, clockIn(DAY, SHIFT));
				assert.equal(written.kind, 'committed');
				yield* run(t);
				const [ran] = yield* runsHeld(t);
				assert.equal((yield* rosterOn(t, DAY)).payroll_run_id, ran?.id);
				return yield* slipOf(t);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
			assert.ok(checkpoint(absent, 'PRORATED') < checkpoint(absent, 'BASIC'));
			assert.equal(checkpoint(punched, 'PRORATED'), checkpoint(punched, 'BASIC'));
			// the clock proves the day, it adds no time of its own
			assert.equal(line(punched, 'OVERTIME'), 0);
		})
	);

	it.live(
		'left open neither pays the day nor stops the run; closed once the unpaid run is deleted, it pays',
		() =>
			Effect.gen(function* () {
				const absent = yield* paid(seed);
				const t = yield* TestWorkspace;
				yield* punch(t, [{ start: DateTime.formatIso(DateTime.makeUnsafe(at(DAY, '08:00'))) }]);
				yield* run(t);
				assert.deepEqual(yield* slipOf(t), absent);
				// the run took the open punch with the day: it is closed only by taking the unpaid run back
				const close = () =>
					Effect.all([t.as(t.member(['kiosk'])), rosterOn(t, DAY)]).pipe(
						Effect.flatMap(([caller, target]) =>
							caller.act({
								'roster_entry.update': [
									{ target, set: { actual_worked_intervals: clockIn(DAY, SHIFT) } }
								]
							})
						)
					);
				assert.match(String(yield* Effect.flip(close())), HELD);
				const [first] = yield* runsHeld(t);
				assert.ok(first !== undefined);
				yield* (yield* t.as(t.admin)).act({ 'payroll_run.delete': [{ target: first }] });
				yield* t.run_due();
				yield* close();
				yield* run(t);
				const closed = yield* slipOf(t);
				assert.equal(checkpoint(closed, 'PRORATED'), checkpoint(closed, 'BASIC'));
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a work event', () => {
	const ALLOWANCE = 'MEAL_ALLOWANCE';
	const EVENT = 'EMPLOYER_SHUTDOWN';
	// the fixture's own rule: its allowance pays 300 while an event of this code covers the period's as-of day
	const heat = (people = 1): Seed =>
		withPeople(
			lawWith(seedOf(month()), {
				allowance_catalog: {
					[ALLOWANCE]: {
						eligibility: `return (ctx.work_events ?? []).some((event) => {
  if (get(event, 'code', '') !== '${EVENT}') return false;
  const from = String(get(event, 'from', ''));
  const to = get(event, 'to', null);
  return from !== '' && from <= ctx.as_of && ctx.as_of <= String(to ?? from);
});`,
						conversion: 'return 300;'
					}
				}
			}),
			people
		);
	const record = (t: Kit, code: string, from: string, to: string, employment?: string) =>
		t.as(t.admin).pipe(
			Effect.flatMap((caller) =>
				caller.act({
					'work_event.create': [
						{
							entity_id: ENTITY,
							catalog_code: code,
							from,
							to,
							...(employment === undefined
								? {}
								: { employment_id: idOf('employee_contract', employment) })
						}
					]
				})
			)
		);
	const february = (seed: Seed, events: readonly (readonly [from: string, to: string])[]) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const [from, to] of events) yield* record(t, EVENT, from, to);
			yield* run(t);
			return yield* slipOf(t);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));

	it.live(
		'posts no line of its own: the allowance that reads it pays, inside its dates only',
		() => {
			const seed = heat();
			return Effect.gen(function* () {
				const none = yield* february(seed, []);
				const inside = yield* february(seed, [['2026-02-01', '2026-02-28']]);
				const ended = yield* february(seed, [['2026-02-01', '2026-02-10']]);
				const later = yield* february(seed, [['2026-03-01', '2026-03-31']]);
				assert.equal(line(none, ALLOWANCE), 0);
				assert.ok(line(inside, ALLOWANCE) > 0);
				assert.equal(line(ended, ALLOWANCE), 0);
				assert.equal(line(later, ALLOWANCE), 0);
				// the event is no pay line: the allowance is the only difference it makes
				assert.deepEqual(
					inside.lines.filter((row) => row.source === 'work_event' || row.code === EVENT),
					[]
				);
				assert.deepEqual(
					inside.lines.filter((row) => row.code !== ALLOWANCE).map((row) => row.code),
					none.lines.map((row) => row.code)
				);
				// two events over the same days are still one condition: the allowance is paid once
				const twice = yield* february(seed, [
					['2026-02-01', '2026-02-28'],
					['2026-02-10', '2026-02-28']
				]);
				assert.equal(line(twice, ALLOWANCE), line(inside, ALLOWANCE));
			});
		}
	);

	it.live('narrowed to one employment reaches that person alone in the run', () => {
		const seed = heat(2);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* record(t, EVENT, '2026-02-01', '2026-02-28', SECOND.contract);
			yield* run(t);
			assert.equal(line(yield* slipOf(t), ALLOWANCE), 0);
			assert.ok(line(yield* slipOf(t, '2026-02', SECOND.contract), ALLOWANCE) > 0);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live(
		'reaches the entitlement sync company-wide or for one employment, and a second sync adds nothing',
		() => {
			const CODE = 'PUBLIC_HOLIDAY_IN_LIEU';
			const base = withPeople(seedOf([]), 2);
			// a synthetic rule on the fixture's row: two days while the company records a shutdown
			const seed = lawWith(base, {
				leave_catalog: {
					[CODE]: {
						lookup: {
							unit: 'DAY',
							entitlement:
								'return (ctx.work_events ?? []).some((event) => event.code === "EMPLOYER_SHUTDOWN") ? 2 : 0;'
						}
					}
				}
			});
			const entitled = (t: Kit, employee: string) =>
				accountsIn(t, employee).pipe(
					Effect.map((accounts) => measureOf(accounts, 'leave', CODE, 'entitled'))
				);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				assert.equal(yield* entitled(t, uuid(4)), 0);
				assert.equal(yield* entitled(t, SECOND.employee), 0);
				yield* record(t, 'EMPLOYER_SHUTDOWN', '2026-02-02', '2026-02-06', SECOND.contract);
				yield* syncAll(t);
				assert.equal(yield* entitled(t, uuid(4)), 0);
				assert.equal(yield* entitled(t, SECOND.employee), 2);
				yield* record(t, 'EMPLOYER_SHUTDOWN', '2026-02-09', '2026-02-13');
				yield* syncAll(t);
				yield* syncAll(t);
				assert.equal(yield* entitled(t, uuid(4)), 2);
				assert.equal(yield* entitled(t, SECOND.employee), 2);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		}
	);
});

describe('a holiday and the days around it', () => {
	const SATURDAY = '2026-02-07';
	const WEEKDAY = '2026-02-04';
	const HOLIDAY = '2026-02-10';
	const published = {
		entity_id: ENTITY,
		kind: 'PUBLIC_HOLIDAY',
		given_to: 'EVERYONE',
		published_at: '2025-12-01T00:00:00.000Z'
	};
	const contract = (daysPerWeek: number, days: Parameters<typeof pack>[4]) =>
		pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{ ...TERMS, normal_hours_per_week: daysPerWeek * 8, normal_days_per_week: daysPerWeek },
			{},
			days,
			[]
		);
	// a holiday kept on a Saturday, and the weekday in lieu for those off that Saturday
	const inLieu = (daysPerWeek: number, saturday: string): Seed => ({
		...contract(daysPerWeek, [
			{ date: WEEKDAY, shift: WORK, hours: 8 },
			{ date: SATURDAY, shift: saturday, hours: 0 }
		]),
		holiday: [
			{ ...published, id: uuid(20), date: SATURDAY, name: 'Kept on Saturday' },
			{
				...published,
				id: uuid(21),
				date: WEEKDAY,
				name: 'Off in lieu',
				given_to: 'ONLY_IF_OFF_ON_REPLACED_DATE',
				replaces: SATURDAY
			}
		]
	});
	it.live('in lieu follows the roster of the replaced day, whatever the contract week says', () =>
		Effect.gen(function* () {
			// a six-day worker whose rest day was swapped onto that Saturday is off on it: the weekday is their holiday
			const swapped = yield* paid(inLieu(6, REST));
			assert.ok(line(swapped, 'HOLIDAY_WORK') > 0);
			// a five-day worker rostered to work that Saturday keeps the Saturday: the weekday is an ordinary day
			const rostered = yield* paid(inLieu(5, WORK));
			assert.equal(line(rostered, 'HOLIDAY_WORK'), 0);
		})
	);

	const kept = (hours: number, personal: boolean): Seed => ({
		...contract(5, [{ date: HOLIDAY, shift: WORK, hours }]),
		holiday: [
			{ ...published, id: uuid(20), date: HOLIDAY, name: 'Public' },
			...(personal
				? [{ ...published, id: uuid(21), date: HOLIDAY, name: 'Kept by one', employee_id: uuid(4) }]
				: [])
		]
	});
	it.live('a person’s own holiday on the public one’s date is one holiday, worked or not', () =>
		Effect.gen(function* () {
			const worked = yield* paid(kept(8, false));
			assert.ok(line(worked, 'HOLIDAY_WORK') > 0);
			assert.deepEqual(yield* paid(kept(8, true)), worked);
			assert.deepEqual(yield* paid(kept(0, true)), yield* paid(kept(0, false)));
		})
	);

	it.live(
		'a holiday inside leave pays the month as it stood, and grants nothing in lieu by itself',
		() => {
			const seed: Seed = {
				...contract(5, []),
				holiday: [{ ...published, id: uuid(20), date: HOLIDAY, name: 'Public' }]
			};
			return Effect.gen(function* () {
				const plain = yield* paid(seed);
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* (yield* t.as(t.admin)).act({
					'leave_catalog_entry.create': [
						leaveCreate({
							entity_id: ENTITY,
							employment_id: CONTRACT,
							catalog_code: 'MEDICAL_LEAVE',
							days: wholeDays('2026-02-09', HOLIDAY, '2026-02-11')
						})
					]
				});
				yield* run(t);
				const onLeave = yield* slipOf(t);
				assert.deepEqual(onLeave.checkpoints, plain.checkpoints);
				assert.equal(net(onLeave), net(plain));
				assert.equal(line(onLeave, 'HOLIDAY_WORK'), 0);
				// the substitute day is HR's manual adjustment on the in-lieu row: nothing posts it
				const accounts = yield* accountsIn(t);
				assert.equal(measureOf(accounts, 'leave', 'PUBLIC_HOLIDAY_IN_LIEU', 'entitled'), 0);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		}
	);
});

describe('a run reads once', () => {
	// every database read of the whole `payroll_run.create`, policy and callbacks included, counted by the test kit
	const reads = (people: number) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			// the administrator is minted before the count starts
			const admin = yield* t.as(t.admin);
			t.count.reset();
			yield* admin.act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]
			});
			const counted = t.count.reads;
			const { payslip } = yield* storedQuery(t, { payslip: { limit: 100 } });
			assert.equal(payslip.rows.length, people);
			return counted;
		}).pipe(Effect.provide(workspace({ seed: withPeople(seedOf(unclocked), people), now: NOW })));
	it.live('the reads of a run do not grow with its headcount', () =>
		Effect.gen(function* () {
			const one = yield* reads(1);
			assert.ok(one > 0);
			assert.equal(yield* reads(6), one);
		})
	);
});
