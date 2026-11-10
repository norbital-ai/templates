// What the Employment Act 1955 conditions on Malaysian leave: who it covers, which confinement bears the allowance, which
// confinement a father still has, and what absence and unpaid leave do to annual leave; and how long a roster day runs.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Instant, PlainDate, addDays } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { payBasis } from '../src/lib/payroll_engine/engine.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	REST,
	WORK,
	accountsIn,
	catalogRow,
	measureOf,
	pack,
	read,
	sealedLeave,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	leaveCreate,
	reversalSlots
} from './kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const ABS = uuid(14);
const TERMS = {
	rate: { amount: 8000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Person = {
	readonly started?: string;
	readonly gender?: 'FEMALE' | 'MALE';
	readonly engagement?: string;
	readonly terms?: JsonObject;
	readonly events?: readonly JsonObject[];
	readonly facts?: JsonObject;
	readonly absent?: readonly string[];
};
const seedOf = ({
	started = '2024-01-01',
	gender = 'FEMALE',
	engagement = 'EMPLOYEE',
	terms = TERMS,
	events = [],
	facts = {},
	absent = []
}: Person) => {
	const seed = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		terms,
		{ events, facts },
		absent.map((date) => ({ date, shift: ABS, hours: 0 })),
		[],
		'2026-11-15'
	);
	return {
		...seed,
		shift_definition: [
			...(seed.shift_definition ?? []),
			{
				id: ABS,
				entity_id: ENTITY,
				code: 'ABSENT',
				name: 'ABSENT',
				effective_range: { from: '2020-01-01', to: null },
				variant: { day_type: 'ABS', ends_next_day: false, breaks: [] }
			}
		],
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			engagement,
			service_started_on: started,
			effective_range: { from: started, to: null },
			payroll: { date_of_birth: '1990-01-01', gender, marital_status: 'MARRIED' }
		}))
	};
};
type Seed = ReturnType<typeof seedOf>;
const born = (...dates: readonly string[]) => dates.map((on) => ({ kind: 'CHILD_BIRTH', on }));
const dates = (from: string, count: number) =>
	Array.from({ length: count }, (_, index) => String(addDays(PlainDate(from), index)));
const entitled = (t: Kit, code: string) =>
	accountsIn(t).pipe(Effect.map((accounts) => measureOf(accounts, 'leave', code, 'entitled')));
/** After sync, each row stands at its figure across its periods. */
const stands = (person: Person, want: Readonly<Record<string, number>>) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* syncAll(t);
		for (const [code, days] of Object.entries(want)) assert.equal(yield* entitled(t, code), days);
	}).pipe(Effect.provide(workspace({ seed: seedOf(person), now: NOW })));
const take = (
	t: Kit,
	seed: Seed,
	code: string,
	days: readonly string[],
	more: {
		readonly encashment?: boolean;
		readonly reverses?: ReturnType<typeof idOf<'leave_catalog_entry'>>;
	} = {}
) =>
	Effect.gen(function* () {
		const selected =
			more.reverses == null ? wholeDays(...days) : yield* reversalSlots(t, more.reverses);
		yield* t.as(t.admin).act('leave_catalog_entry.create', [
			leaveCreate({
				entity_id: ENTITY,
				employment_id: CONTRACT,
				catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
				days: selected,
				...more
			})
		]);
	});
const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const ANNUAL_DAY = ['2026-11-23'];

describe('a domestic employee', () => {
	const terms = { ...TERMS, statutory_work_category: 'DOMESTIC' };
	it.live('holds none of the leave Parts IX and XII give', () =>
		stands(
			{ terms, events: born('2026-03-02') },
			{
				ANNUAL_LEAVE: 0,
				MEDICAL_LEAVE: 0,
				HOSPITALIZATION_LEAVE: 0,
				MATERNITY_LEAVE: 0,
				MATERNITY_LEAVE_NO_ALLOWANCE: 0
			}
		)
	);
	it.live('nor paternity leave', () =>
		stands({ terms, gender: 'MALE', events: born('2026-03-02') }, { PATERNITY_LEAVE: 0 })
	);
});

describe('anyone else', () => {
	it.live('holds the days for their length of service', () =>
		stands(
			{},
			{ ANNUAL_LEAVE: 12, MEDICAL_LEAVE: 18, HOSPITALIZATION_LEAVE: 60, MATERNITY_LEAVE: 0 }
		)
	);
	it.live('on part time, the part-time ladder', () =>
		stands({ engagement: 'PART_TIME' }, { ANNUAL_LEAVE: 8, MEDICAL_LEAVE: 13 })
	);
	it.live('before the first band, a share by completed months', () =>
		stands({ started: '2026-05-01' }, { ANNUAL_LEAVE: 4, MEDICAL_LEAVE: 14 })
	);
});

describe('a confinement', () => {
	const allowance = { MATERNITY_LEAVE: 98, MATERNITY_LEAVE_NO_ALLOWANCE: 0 };
	const none = { MATERNITY_LEAVE: 0, MATERNITY_LEAVE_NO_ALLOWANCE: 98 };
	const earlier = ['2010-01-01', '2011-01-01', '2012-01-01', '2013-01-01'];
	it.live('bears the allowance after ninety days', () =>
		stands({ started: '2025-12-02', events: born('2026-03-02') }, allowance)
	);
	it.live('does not one day short of them, and her leave stands', () =>
		stands({ started: '2025-12-03', events: born('2026-03-02') }, none)
	);
	it.live('bears it with four surviving children', () =>
		stands({ started: '2025-01-01', events: born(...earlier, '2026-03-02') }, allowance)
	);
	it.live('does not with five', () =>
		stands({ started: '2025-01-01', events: born('2009-01-01', ...earlier, '2026-03-02') }, none)
	);
	it.live('bears it again when one died before it', () =>
		stands(
			{
				started: '2025-01-01',
				events: [
					...born('2009-01-01', ...earlier, '2026-03-02'),
					{ kind: 'CHILD_DEATH', on: '2020-05-05' }
				]
			},
			allowance
		)
	);
	it.live('counts no death after it', () =>
		stands(
			{
				started: '2025-01-01',
				events: [
					...born('2009-01-01', ...earlier, '2026-03-02'),
					{ kind: 'CHILD_DEATH', on: '2026-03-03' }
				]
			},
			none
		)
	);
	it.live('stated without allowance has none', () =>
		stands({ events: [{ kind: 'CHILD_BIRTH_NO_ALLOWANCE', on: '2026-03-02' }] }, none)
	);
	it.live('is one confinement however many it brought', () =>
		stands({ events: born('2026-03-02', '2026-03-02') }, allowance)
	);
	it.live('before this employment gives nothing here', () =>
		stands(
			{ started: '2025-01-01', events: born('2020-03-02') },
			{
				MATERNITY_LEAVE: 0,
				MATERNITY_LEAVE_NO_ALLOWANCE: 0
			}
		)
	);
	it.live('gives a man no maternity leave', () =>
		stands(
			{ gender: 'MALE', events: born('2026-03-02') },
			{
				MATERNITY_LEAVE: 0,
				MATERNITY_LEAVE_NO_ALLOWANCE: 0
			}
		)
	);
	it.live('with the allowance cannot be taken unpaid', () => {
		const seed = seedOf({ events: born('2026-03-02') });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const refused = yield* Effect.flip(
				take(t, seed, 'MATERNITY_LEAVE_NO_ALLOWANCE', ['2026-03-03'])
			);
			assert.match(String(refused), /insufficient balance/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('a father', () => {
	const father = (events: readonly JsonObject[], facts: JsonObject = {}): Person => ({
		started: '2025-01-01',
		gender: 'MALE',
		events,
		facts
	});
	const earlier = ['2010-01-01', '2011-01-01', '2012-01-01', '2013-01-01'];
	const birth = '2026-03-02';
	const record = (lifetime_number: number, notification_requirement_met: boolean) => ({
		paternity_confinements: [{ event_id: birth, lifetime_number, notification_requirement_met }]
	});
	it.live('has seven days for his fifth confinement', () =>
		stands(father(born(...earlier, birth)), { PATERNITY_LEAVE: 7 })
	);
	it.live('and none for his sixth', () =>
		stands(father(born('2009-01-01', ...earlier, birth)), { PATERNITY_LEAVE: 0 })
	);
	it.live('whose record counts earlier ones goes by the record', () =>
		stands(father(born(birth), record(6, true)), { PATERNITY_LEAVE: 0 })
	);
	it.live('who did not notify has none', () =>
		stands(father(born(birth), record(1, false)), { PATERNITY_LEAVE: 0 })
	);
	it.live('of twins has seven days', () =>
		stands(father(born(birth, birth), record(1, true)), { PATERNITY_LEAVE: 7 })
	);
	it.live('begins his leave only after twelve months with the employer', () => {
		const seed = seedOf({ started: '2025-11-10', gender: 'MALE', events: born('2026-11-02') });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const refused = yield* Effect.flip(take(t, seed, 'PATERNITY_LEAVE', ['2026-11-03']));
			assert.match(String(refused), /12 months with this employer/);
			yield* take(t, seed, 'PATERNITY_LEAVE', ['2026-11-10']);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
	it.live(
		'counts the stint before a rehire toward those months where the profile counts every stint',
		() => {
			const base = seedOf({ started: '2025-11-10', gender: 'MALE', events: born('2026-11-02') });
			const seed = {
				...base,
				employee_profile: [
					{ id: uuid(4), user_id: uuid(3), name: 'Worker', cumulative_service: true }
				],
				employee_contract: (base.employee_contract ?? []).flatMap((row) => [
					{
						...row,
						id: uuid(60),
						service_started_on: '2024-01-02',
						effective_range: { from: '2024-01-02', to: '2025-11-05' }
					},
					row
				])
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* take(t, base, 'PATERNITY_LEAVE', ['2026-11-03']);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		}
	);
});

describe('absence without leave', () => {
	const asks = (person: Person) => {
		const seed = seedOf(person);
		return { seed, layer: workspace({ seed, now: NOW }) };
	};
	const allowed = (person: Person) => {
		const { seed, layer } = asks(person);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* take(t, seed, 'ANNUAL_LEAVE', ANNUAL_DAY);
		}).pipe(Effect.provide(layer));
	};
	const refused = (person: Person) => {
		const { seed, layer } = asks(person);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const answer = yield* Effect.flip(take(t, seed, 'ANNUAL_LEAVE', ANNUAL_DAY));
			assert.match(String(answer), /no annual leave is due/);
		}).pipe(Effect.provide(layer));
	};
	it.live('up to a tenth of the working days keeps the leave', () =>
		allowed({ absent: dates('2026-02-01', 26) })
	);
	it.live('past a tenth forfeits it', () => refused({ absent: dates('2026-02-01', 27) }));
	it.live('in the service year before does not count', () =>
		allowed({ absent: dates('2025-02-01', 40) })
	);
	// B2: a contract without its ordinary week is refused, so the rule has no unrecorded-week fallback
	it.live('does not stop an exit pay-out or a reversal being written', () => {
		const { seed, layer } = asks({ absent: dates('2026-02-01', 27) });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* take(t, seed, 'ANNUAL_LEAVE', ANNUAL_DAY, { encashment: true });
			yield* run(t, '2026-11');
			yield* take(t, seed, 'ANNUAL_LEAVE', ['2026-12-01'], { reverses: yield* sealedLeave(t) });
		}).pipe(Effect.provide(layer));
	});
});

describe('unpaid leave', () => {
	// two full years' service at the 12-day band; a month less and it is the 8-day band
	const seed = seedOf({ started: '2024-11-01' });
	const nine = dates('2026-11-23', 9);
	const layer = workspace({ seed, now: NOW });
	const unpaid = (t: Kit, days: readonly string[]) => take(t, seed, 'NPL', days);
	it.live('of thirty days leaves service as it stands', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* unpaid(t, dates('2025-03-01', 30));
			yield* take(t, seed, 'ANNUAL_LEAVE', nine);
		}).pipe(Effect.provide(layer))
	);
	it.live('past thirty in twelve months comes out of service, all of it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* unpaid(t, dates('2025-03-01', 31));
			const refused = yield* Effect.flip(take(t, seed, 'ANNUAL_LEAVE', nine));
			assert.match(String(refused), /8 days are left/);
			yield* take(t, seed, 'ANNUAL_LEAVE', nine.slice(0, 8));
		}).pipe(Effect.provide(layer))
	);
	it.live('more than twelve months apart does not add up', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* unpaid(t, dates('2025-01-02', 16));
			yield* unpaid(t, dates('2026-02-01', 15));
			yield* take(t, seed, 'ANNUAL_LEAVE', nine);
		}).pipe(Effect.provide(layer))
	);
	it.live('reversed does not count', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* unpaid(t, dates('2026-03-01', 31));
			yield* run(t, '2026-03');
			yield* take(t, seed, 'NPL', ['2026-11-02'], { reverses: yield* sealedLeave(t) });
			yield* take(t, seed, 'ANNUAL_LEAVE', nine);
		}).pipe(Effect.provide(layer))
	);
});

describe('the day rate', () => {
	it('carries fixed allowances, and no variable one', () => {
		const [settings] = read('seed/public/jurisdiction/MY/version_5/jurisdiction_settings.json');
		assert.ok(settings !== undefined);
		const terms = {
			rate: { amount: 2600, unit: 'MONTHLY' },
			normal_hours_per_day: 8,
			normal_hours_per_week: 40,
			normal_days_per_week: 5,
			allowances: { FIXED: { amount: 260 }, TIPS: { amount: 100 } }
		};
		assert.equal(
			payBasis(
				{
					run: {},
					settings,
					subtotals: [],
					allowance: [
						{ code: 'FIXED', lookup: {}, include_in_rate: true },
						{ code: 'TIPS', lookup: {}, include_in_rate: false }
					],
					overtime: [],
					statutory: [],
					leave_catalog: [],
					claim_catalog: [],
					adhoc_catalog: [],
					loan_catalog: [],
					employee: {},
					employment: { terms },
					employer: { payment_schedule: { non_working_weekdays: [0, 6] } },
					balance: {},
					entries: {}
				},
				{ from: '2026-06-01', to: '2026-06-30' }
			).day_rate,
			// the fixed allowance is in the wage: (2,600 + 260) × 12 ÷ (52 × 5 days a week)
			132
		);
	});
});

describe('a roster day', () => {
	const at = (time: string, date = '2026-11-07') =>
		Instant(new Date(`${date}T${time}:00+08:00`).toISOString());
	const span = (from: string, to: string, ...breaks: readonly [string, string][]) => ({
		start: at(from),
		end: at(to),
		...(breaks.length === 0
			? {}
			: { breaks: breaks.map(([a, b]) => ({ start: at(a), end: at(b) })) })
	});
	const day = (shift: string, ...planned: ReturnType<typeof span>[]) => ({
		employment_id: CONTRACT,
		work_date: PlainDate('2026-11-07'),
		shift_definition_id: idOf('shift_definition', shift),
		planned_overtime_intervals: planned
	});
	const writes = (row: ReturnType<typeof day>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			return yield* t
				.as(t.admin)
				.act('roster_entry.create', [row])
				.pipe(
					Effect.as('written'),
					Effect.catch((refused) => Effect.succeed(String(refused)))
				);
		}).pipe(Effect.provide(workspace({ seed: seedOf({}), now: NOW })));
	// EA s.60A(7): twelve hours of work a day, the rostered shift's included; a rest day has none rostered
	it.live('on a rest day runs to twelve hours of planned work', () =>
		writes(day(REST, span('08:00', '20:00'))).pipe(
			Effect.map((got) => assert.equal(got, 'written'))
		)
	);
	it.live('on a rest day, not past them', () =>
		writes(day(REST, span('08:00', '20:30'))).pipe(
			Effect.map((got) => assert.match(got, /ROSTER_DAILY_TOTAL/))
		)
	);
	it.live('on a workday counts its eight-hour shift', () =>
		writes(day(WORK, span('16:00', '20:00'))).pipe(
			Effect.map((got) => assert.equal(got, 'written'))
		)
	);
	it.live('so overtime past four hours after it is refused', () =>
		writes(day(WORK, span('16:00', '20:30'))).pipe(
			Effect.map((got) => assert.match(got, /ROSTER_DAILY_TOTAL/))
		)
	);
	// EA s.60A(1)(a) and proviso (i): five hours at most between breaks of thirty minutes
	it.live('takes a recorded thirty-minute break after five hours', () =>
		writes(day(REST, span('08:00', '17:00', ['13:00', '13:30']))).pipe(
			Effect.map((got) => assert.equal(got, 'written'))
		)
	);
	it.live('but not a fifteen-minute one, which does not break the run', () =>
		writes(day(REST, span('08:00', '14:00', ['11:00', '11:15']))).pipe(
			Effect.map((got) => assert.match(got, /ROSTER_CONTINUOUS_HOURS/))
		)
	);
	it.live('nor a span that records no break at all', () =>
		writes(day(REST, { ...span('08:00', '14:00'), breaks: [] })).pipe(
			Effect.map((got) => assert.match(got, /ROSTER_CONTINUOUS_HOURS/))
		)
	);
	it.live('while a workbook span, net of breaks it cannot hold, is judged on its hours alone', () =>
		writes(day(REST, span('08:00', '16:00'))).pipe(
			Effect.map((got) => assert.equal(got, 'written'))
		)
	);
});

describe('the provident fund', () => {
	/** Each period's pay lines and what its statutory rows took from the employee. */
	const slips = (t: Kit) =>
		t.storedQuery({ payslip: { limit: 10 } }).pipe(
			Effect.map(({ payslip }) =>
				Object.fromEntries(
					payslip.rows.map((slip) => {
						const { lines, statutory } = Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown);
						return [
							slip.period,
							{
								lines: Object.fromEntries(lines.map((line) => [line.code, line.amount])),
								employee: Object.fromEntries(statutory.map((row) => [row.code, row.employee])),
								employer: Object.fromEntries(statutory.map((row) => [row.code, row.employer]))
							}
						];
					})
				)
			)
		);
	// EPF Act 1991 Third Schedule Part F: 2% each side of RM3,000; the pass ends 15 May, so its last two months open
	// on 15 March: February's wages carry the contribution, March's touch those months and carry none
	it.live(
		'of a non-citizen stops in a wage month touching the last two months of the work pass',
		() => {
			const seed = pack(
				'MY',
				'Asia/Kuala_Lumpur',
				{
					...TERMS,
					rate: { amount: 3000, unit: 'MONTHLY' },
					residency_status: 'FOREIGNER',
					work_authorisation_expires_on: '2026-05-15'
				},
				{},
				[],
				[],
				'2026-02-15'
			);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, '2026-02');
				yield* run(t, '2026-03');
				const paid = yield* slips(t);
				assert.equal(paid['2026-02']?.employee.EPF_NON_CITIZEN, 60);
				assert.equal(paid['2026-02']?.employer.EPF_NON_CITIZEN, 60);
				assert.equal(paid['2026-03']?.employee.EPF_NON_CITIZEN ?? 0, 0);
				assert.equal(paid['2026-03']?.employer.EPF_NON_CITIZEN ?? 0, 0);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })));
		}
	);
	// EPF Act 1991 s.2: overtime payments are not wages, and pay for work on a rest day or a public holiday is one;
	// the incentive (OT) is. RM3,120 on a five-day week is 144 a day: a rest day worked pays one day, a holiday two.
	it.live(
		'counts the incentive (OT), and no pay for work on a rest day or a public holiday',
		() => {
			const HOLIDAY = '2026-02-11';
			const seed = pack(
				'MY',
				'Asia/Kuala_Lumpur',
				{
					...TERMS,
					rate: { amount: 3120, unit: 'MONTHLY' },
					statutory_work_category: 'MANUAL_LABOUR'
				},
				{},
				// the roster is the cycle's source of truth: every weekday worked as planned, and the first Sunday too
				[
					{ date: '2026-02-01', shift: REST, hours: 8 },
					...dates('2026-02-01', 28)
						.filter((date) => ![0, 6].includes(new Date(date).getUTCDay()))
						.map((date) => ({ date, shift: WORK, hours: 8 }))
				],
				[{ date: HOLIDAY, kind: 'PUBLIC_HOLIDAY' }],
				'2026-02-15'
			);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* t.as(t.admin).act('adhoc_catalog_entry.create', [
					{
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('adhoc_catalog', catalogRow(seed, 'adhoc_catalog', 'INCENTIVE_OT')),
						description: 'Incentive (OT)',
						quantity: 200,
						incurred_on: PlainDate('2026-02-10')
					}
				]);
				yield* run(t, '2026-02');
				const paid = (yield* slips(t))['2026-02'];
				assert.deepEqual(
					[paid?.lines.REST_DAY_WORK, paid?.lines.HOLIDAY_WORK, paid?.lines.INCENTIVE_OT],
					[144, 288, 200]
				);
				// Third Schedule Part A: wages of 3,120 + 200 fall in the band to 3,320, 11% of it rounded up to the ringgit;
				// with the 432 of rest-day and holiday pay it would be the band to 3,760 and 414
				assert.equal(paid?.employee.EPF, 366);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
		}
	);
});
