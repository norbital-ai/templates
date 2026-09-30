import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHolidays, type HolidayRow } from '../src/lib/holiday-calendar.ts';
import { EXPRESSION_CONTEXTS } from '../src/lib/expressions/contexts.ts';
import type { PersonContext } from '../src/lib/payroll/run/eligibility.ts';
import {
	instanceKey,
	obligationStatus,
	type DutyType
} from '../src/lib/obligations/materialise.ts';
import { assertNotCaptured } from '../src/lib/scheduling/lock.ts';
import {
	dueDays,
	holidaysOf,
	personCondition,
	planOccurrences,
	scheduledDuty,
	scheduledInstance,
	scheduledRef
} from '../src/lib/scheduled/entries.ts';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const EMPLOYMENT = '22222222-2222-4222-8222-222222222222';
const THIRTEENTH = '[string(year) + "-12-24"]';
const THR = 'holidays.filter(h, employee.religion in h.religions).map(h, add_days(h.date, -7))';
const DUTY: DutyType = {
	code: 'THIRTEENTH_MONTH_PAY_OWED',
	authority: 'PD 851 s.1',
	subject: 'EMPLOYMENT',
	trigger: { on: 'SCHEDULED' },
	due: 'trigger.date'
};

const person = (religion: string): PersonContext => {
	const blank = EXPRESSION_CONTEXTS.person.blank as PersonContext;
	return { ...blank, employee: { ...blank.employee, religion } } as PersonContext;
};

const holiday = (changes: Partial<HolidayRow & { religion: string }>) => ({
	id: changes.date ?? 'day',
	company_id: COMPANY,
	date: '2026-03-20',
	name: 'Day',
	kind: 'PUBLIC_HOLIDAY' as const,
	replaces: null,
	given_to: 'EVERYONE' as const,
	worksite: null,
	published_at: '2026-01-01T00:00:00Z',
	...changes
});

/** One day of the sweep for one person and class: what it raises and what the ledger then holds. */
const sweep = (options: {
	today: string;
	ledger: Set<string>;
	entryDates?: readonly string[];
	owed?: (due: string) => boolean;
}) => {
	const dues = [2025, 2026, 2027].flatMap((year) => dueDays(THIRTEENTH, { year: BigInt(year) }));
	const plan = planOccurrences({
		today: options.today,
		dues,
		raiseDaysBefore: 30,
		recorded: (due) =>
			options.ledger.has(
				instanceKey({
					duty_code: DUTY.code,
					subject_kind: 'EMPLOYMENT',
					subject_id: EMPLOYMENT,
					trigger_ref: scheduledRef('THIRTEENTH_MONTH_PAY_YEAR_END', due)
				})
			),
		entryDates: options.entryDates ?? [],
		owed: options.owed ?? (() => true)
	});
	const recorded = plan.flatMap(({ due }) => {
		const row = scheduledInstance({
			duty: DUTY,
			settingsId: 'v1',
			companyId: COMPANY,
			employmentId: EMPLOYMENT,
			code: 'THIRTEENTH_MONTH_PAY_YEAR_END',
			due,
			today: options.today,
			existing: options.ledger
		});
		if (row != null) options.ledger.add(instanceKey(row));
		return row == null ? [] : [row];
	});
	return { plan, recorded };
};

test('a scheduled occurrence is raised once from its lead day, and never again once the ledger holds it', () => {
	const ledger = new Set<string>();
	assert.deepEqual(sweep({ today: '2026-11-23', ledger }).plan, [], 'before the lead day');
	const first = sweep({ today: '2026-11-24', ledger });
	assert.deepEqual(first.plan, [{ due: '2026-12-24', raise: true }]);
	// the next days, and a re-run of the same day, raise nothing: the ledger instance is the mark
	assert.deepEqual(sweep({ today: '2026-11-24', ledger }).plan, []);
	assert.deepEqual(sweep({ today: '2026-12-20', ledger }).plan, []);
	// a missed sweep catches up for a month after the due day, and no longer
	assert.deepEqual(sweep({ today: '2027-01-24', ledger: new Set() }).plan, [
		{ due: '2026-12-24', raise: true }
	]);
	assert.deepEqual(sweep({ today: '2027-01-25', ledger: new Set() }).plan, []);
	// nobody outside the population, or out of service on the day, is owed it
	assert.deepEqual(sweep({ today: '2026-12-01', ledger: new Set(), owed: () => false }).plan, []);
});

test('an entry already on file — raised by hand, or consumed by a payslip — is recorded, never raised again', () => {
	// HR paid the year's 13th month by hand on 15 December: it stands for the 24 December occurrence
	const manual = sweep({ today: '2026-12-01', ledger: new Set(), entryDates: ['2026-12-15'] });
	assert.deepEqual(manual.plan, [{ due: '2026-12-24', raise: false }]);
	assert.equal(manual.recorded.length, 1);
	// last year's consumed entry claims last year's occurrence, not this one
	assert.deepEqual(
		sweep({ today: '2026-12-01', ledger: new Set(), entryDates: ['2025-12-20'] }).plan,
		[{ due: '2026-12-24', raise: true }]
	);
	// an occurrence in the ledger is never re-raised, even after its request was rejected or deleted
	const ledger = new Set<string>();
	sweep({ today: '2026-12-01', ledger });
	assert.deepEqual(sweep({ today: '2026-12-02', ledger, entryDates: [] }).plan, []);
});

test('a consumed entry is locked: the settlement pin refuses an edit, and the sweep only creates', () => {
	assert.throws(
		() => assertNotCaptured({ payslip_id: 'slip-1', approval_id: null }, 'Ad hoc payment'),
		/already taken this record into account/
	);
	assert.doesNotThrow(() =>
		assertNotCaptured({ payslip_id: null, approval_id: null }, 'Ad hoc payment')
	);
	const plan = sweep({ today: '2026-12-01', ledger: new Set(), entryDates: ['2026-12-24'] }).plan;
	assert.deepEqual(plan, [{ due: '2026-12-24', raise: false }]);
});

test('each occurrence is a ledger instance due on the legal day, LATE while it is unpaid', () => {
	const { recorded } = sweep({ today: '2026-11-24', ledger: new Set() });
	const [row] = recorded;
	assert.ok(row != null);
	assert.equal(row.duty_code, 'THIRTEENTH_MONTH_PAY_OWED');
	assert.equal(row.subject_kind, 'EMPLOYMENT');
	assert.equal(row.subject_id, EMPLOYMENT);
	assert.equal(row.trigger_ref, 'THIRTEENTH_MONTH_PAY_YEAR_END:2026-12-24');
	assert.equal(row.due_on, '2026-12-24');
	assert.equal(row.triggered_on, '2026-11-24');
	assert.equal(row.state, 'OPEN');
	assert.equal(obligationStatus(row, '2026-12-24'), 'OPEN');
	assert.equal(obligationStatus(row, '2026-12-25'), 'LATE');
	assert.equal(obligationStatus({ ...row, state: 'FULFILLED' }, '2027-01-10'), 'FULFILLED');
	// only a SCHEDULED employment duty records an occurrence
	assert.equal(scheduledDuty([DUTY], DUTY.code), DUTY);
	assert.equal(scheduledDuty([{ ...DUTY, subject: 'COMPANY' }], DUTY.code), null);
	assert.equal(
		scheduledDuty([{ ...DUTY, trigger: { on: 'CALENDAR', every: 'YEAR' } }], DUTY.code),
		null
	);
});

test('a religion-conditioned holiday is read per person; THR falls due seven days before the worker’s own', () => {
	const rows = [
		holiday({ date: '2026-03-20', name: 'Idul Fitri', religion: 'ISLAM' }),
		holiday({ date: '2026-12-25', name: 'Natal', religion: 'CHRISTIAN, CATHOLIC' }),
		holiday({ date: '2026-10-20', name: 'Deepavali', applies_when: 'employee.religion == "HINDU"' })
	];
	const between = (religion: string) =>
		resolveHolidays(
			rows,
			COMPANY,
			'2026-01-01',
			'2026-12-31',
			() => null,
			personCondition(() => person(religion))
		);
	// the company-wide calendar has no conditioned day; each person's has it only where it holds
	assert.deepEqual(
		[...resolveHolidays(rows, COMPANY, '2026-01-01', '2026-12-31').keys()],
		['2026-03-20', '2026-12-25']
	);
	assert.ok(between('HINDU').has('2026-10-20'));
	assert.ok(!between('ISLAM').has('2026-10-20'));

	const thr = (religion: string) =>
		dueDays(THR, {
			...person(religion),
			year: 2026n,
			holidays: holidaysOf(
				rows,
				COMPANY,
				2026,
				() => null,
				personCondition(() => person(religion))
			)
		});
	assert.deepEqual(thr('ISLAM'), ['2026-03-13']);
	assert.deepEqual(thr('CATHOLIC'), ['2026-12-18']);
	assert.deepEqual(thr(''), [], 'no recorded religion dates no THR');
	// a holiday that falls twice in one year is two occurrences (Permenaker 6/2016 art.5(2))
	const twice = [...rows, holiday({ date: '2026-12-30', name: 'Idul Fitri', religion: 'ISLAM' })];
	assert.deepEqual(
		dueDays(THR, {
			...person('ISLAM'),
			year: 2026n,
			holidays: holidaysOf(
				twice,
				COMPANY,
				2026,
				() => null,
				() => false
			)
		}),
		['2026-03-13', '2026-12-23']
	);
});

test('a due expression that yields something other than days is refused by name', () => {
	assert.throws(() => dueDays('"soon"', {}), /not a YYYY-MM-DD day/);
	assert.deepEqual(dueDays('"2026-12-24"', {}), ['2026-12-24']);
});
