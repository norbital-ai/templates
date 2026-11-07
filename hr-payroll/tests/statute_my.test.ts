// What the Employment Act 1955 conditions on Malaysian leave: who it covers, which confinement bears the allowance, which
// confinement a father still has, and what absence and unpaid leave do to annual leave.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate, addDays } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	measureOf,
	pack,
	read,
	sealedLeave,
	syncAll,
	uuid,
	wholeDays,
	workspace
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
	t.as(t.admin).act('leave_catalog_entry.create', [
		{
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
			days: wholeDays(...days),
			...more
		}
	]);
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
	const { normal_days_per_week: _, ...unrecorded } = TERMS;
	it.live('with the week unrecorded, a six-day week is assumed', () =>
		allowed({ terms: unrecorded, absent: dates('2026-02-01', 31) })
	);
	it.live('past a tenth of that week forfeits it too', () =>
		refused({ terms: unrecorded, absent: dates('2026-02-01', 32) })
	);
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
	const unpaid = (t: Kit, days: readonly string[]) => take(t, seed, 'UNPAID_LEAVE', days);
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
			yield* take(t, seed, 'UNPAID_LEAVE', ['2026-11-02'], { reverses: yield* sealedLeave(t) });
			yield* take(t, seed, 'ANNUAL_LEAVE', nine);
		}).pipe(Effect.provide(layer))
	);
});

describe('the day rate', () => {
	it('carries fixed allowances, and no variable one', () => {
		const [settings] = read('seed/public/jurisdiction/MY/version_8/jurisdiction_settings.json');
		const lookup = objectValue(settings?.lookup);
		const terms = {
			rate: { amount: 2600, unit: 'MONTHLY' },
			allowances: { FIXED: { amount: 260 }, TIPS: { amount: 100, variability: 'VARIABLE' } }
		};
		assert.equal(
			evaluate(
				String(lookup.day_rate),
				'CALCULATION',
				{ subject: { employment: { terms } }, lookup },
				'day_rate'
			),
			110
		);
	});
});
