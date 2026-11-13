// Everyone's leave comes from the catalog row. A change posts the difference from what its period holds, a new window is
// a new key, and running it twice posts nothing. This drives sync's own plans over the ledger's pure core, in memory.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
	apply,
	diff,
	leftOn,
	type Accounts,
	unlimited,
	type Event,
	type Movement
} from '../../src/lib/ledger/core.ts';
import {
	entitlementOf,
	type LeavePerson,
	type LeaveRow
} from '../../src/lib/ledger/entitlement.ts';
import {
	entitlementPlans,
	leaveWanted,
	type ClosingRule,
	type Plan
} from '../../src/lib/ledger/service.ts';

type Held = {
	readonly accounts: Accounts;
	readonly ledger: readonly Movement[];
	readonly moves: readonly Movement[];
};
const EMPTY: Held = { accounts: {}, ledger: [], moves: [] };
const subjectOf = (person: LeavePerson, events: readonly Event[]) => ({
	scope: 'MY',
	started: person.started,
	events
});
const settled = (held: Held, plans: readonly Plan[]): Held => {
	const moves = plans.flatMap((plan) =>
		diff(
			plan.source,
			plan.wanted,
			held.ledger.filter((row) => row.source === plan.source)
		)
	);
	return { accounts: apply(held.accounts, moves), ledger: [...held.ledger, ...moves], moves };
};
const sync = (
	rows: readonly LeaveRow[],
	person: LeavePerson,
	held: Held,
	on: string,
	events: readonly Event[] = [],
	closing?: ClosingRule
) =>
	settled(
		held,
		entitlementPlans(
			rows.map((row) => ({ ...row, account: 'leave' })),
			person,
			subjectOf(person, events),
			'balance',
			held.accounts,
			on,
			closing
		)
	);
/** Whole days taken on one day, posted as an entry posts. */
const take = (
	held: Held,
	row: LeaveRow,
	person: LeavePerson,
	days: number,
	on: string,
	events: readonly Event[] = []
) =>
	settled(held, [
		{
			source: `leave_catalog_entry:${held.ledger.length}`,
			balance_id: 'balance',
			wanted: leaveWanted(
				{ days: Array.from({ length: days * 2 }, () => ({ date: on })) },
				row,
				() => row,
				subjectOf(person, events),
				8
			)
		}
	]);
const left = (
	held: Held,
	row: LeaveRow,
	person: LeavePerson,
	on: string,
	events: readonly Event[] = []
) => leftOn(held.accounts, 'leave', row.code, row.lookup, subjectOf(person, events), on);
const moved = ({ moves }: Held) =>
	moves.map(({ code, operation, measure, amount }) => [code, operation, measure, amount]);

const PERSON: LeavePerson = {
	started: '2023-01-01',
	partTime: false,
	gender: 'MALE',
	maritalStatus: 'MARRIED'
};
const MEDICAL: LeaveRow = {
	code: 'MEDICAL',
	lookup: {
		window: 'CALENDAR_YEAR',
		service_bands: [
			{ service_months: 0, days: 14 },
			{ service_months: 24, days: 18 },
			{ service_months: 60, days: 22 }
		],
		part_time_service_bands: [
			{ service_months: 0, days: 10 },
			{ service_months: 24, days: 13 }
		]
	}
};
const ANNUAL: LeaveRow = {
	code: 'ANNUAL',
	lookup: {
		window: 'SERVICE_YEAR',
		service_bands: [
			{ service_months: 12, days: 8 },
			{ service_months: 24, days: 12 },
			{ service_months: 60, days: 16 }
		],
		proration: 'COMPLETED_MONTHS',
		carry: { windows: 1 }
	}
};
const NO_PAY: LeaveRow = { code: 'NO_PAY', lookup: { opened_by: { LONG_ILLNESS: { days: 0 } } } };
const NO_FIGURE: LeaveRow = { code: 'COMPASSIONATE', lookup: {} };
const withBands = (row: LeaveRow, days: number): LeaveRow => ({
	...row,
	lookup: { ...row.lookup, service_bands: [{ service_months: 0, days }] }
});

describe('a newcomer', () => {
	it('opens each row at its figure', () => {
		const person = { ...PERSON, started: '2026-11-01' };
		const opened = sync([MEDICAL], person, EMPTY, '2026-11-01');
		assert.equal(left(opened, MEDICAL, person, '2026-11-01'), 14);
		assert.deepEqual(moved(opened), [['MEDICAL', 'ADD', 'entitled', 14]]);
		assert.equal(opened.moves[0]?.period, 'MY.Y.2026-01-01');
		assert.equal(opened.moves[0]?.source, 'entitlement:balance:MEDICAL:MY.Y.2026-01-01');
	});
	it('takes the band their service reaches', () => {
		assert.equal(
			left(sync([MEDICAL], PERSON, EMPTY, '2026-11-01'), MEDICAL, PERSON, '2026-11-01'),
			18
		);
	});
	it('takes the part-time bands on a part-time contract', () => {
		const person = { ...PERSON, started: '2026-11-01', partTime: true };
		assert.equal(
			left(sync([MEDICAL], person, EMPTY, '2026-11-01'), MEDICAL, person, '2026-11-01'),
			10
		);
	});
	it('opens no account for a row with no figure, or an event that opens no days: it has no limit', () => {
		const opened = sync([NO_PAY, NO_FIGURE], PERSON, EMPTY, '2026-11-01');
		assert.deepEqual(opened.accounts, {});
		assert.equal(unlimited(NO_PAY.lookup), true);
		assert.equal(unlimited(NO_FIGURE.lookup), true);
		assert.equal(unlimited(MEDICAL.lookup), false);
	});
	it('gets nothing from a row for someone else', () => {
		const row = {
			code: 'MATERNITY',
			lookup: { grant_days: 98, opened_by: { CHILD_BIRTH: {} }, eligibility: { gender: 'FEMALE' } }
		};
		const birth = [{ kind: 'CHILD_BIRTH', on: '2026-03-02' }];
		assert.deepEqual(sync([row], PERSON, EMPTY, '2026-11-01', birth).accounts, {});
	});
	it('waits out the service a row asks for, then gets it', () => {
		const row = {
			code: 'SICK',
			lookup: { grant_days: 14, window: 'CALENDAR_YEAR', eligibility_months: 3 }
		};
		const person = { ...PERSON, started: '2026-09-01' };
		const joined = sync([row], person, EMPTY, '2026-09-01');
		assert.equal(left(joined, row, person, '2026-09-01'), 0);
		assert.equal(left(sync([row], person, joined, '2026-12-01'), row, person, '2026-12-01'), 14);
	});
});

describe('running it again', () => {
	it('moves nothing, on any row', () => {
		const rows = [MEDICAL, ANNUAL, NO_PAY, NO_FIGURE];
		const first = sync(rows, PERSON, EMPTY, '2026-11-01');
		const second = sync(rows, PERSON, first, '2026-11-01');
		assert.deepEqual(second.moves, []);
		assert.deepEqual(second.accounts, first.accounts);
	});
	it('moves nothing after days are taken', () => {
		const opened = take(
			sync([MEDICAL], PERSON, EMPTY, '2026-03-01'),
			MEDICAL,
			PERSON,
			3,
			'2026-03-01'
		);
		const again = sync([MEDICAL], PERSON, opened, '2026-03-01');
		assert.deepEqual(again.moves, []);
		assert.equal(left(again, MEDICAL, PERSON, '2026-03-01'), 15);
	});
	it('holds for any order of days within a window', () => {
		let held = sync([MEDICAL, ANNUAL], PERSON, EMPTY, '2026-01-02');
		for (const day of ['2026-03-05', '2026-03-06', '2026-07-01', '2026-07-01', '2026-12-31']) {
			held = sync([MEDICAL], PERSON, held, day);
			assert.deepEqual(sync([MEDICAL], PERSON, held, day).moves, []);
		}
	});
});

describe('a catalog change', () => {
	const opened = take(
		sync([withBands(MEDICAL, 14)], PERSON, EMPTY, '2026-03-01'),
		MEDICAL,
		PERSON,
		3,
		'2026-03-01'
	);
	it('a raise adds the difference, and days taken stay taken', () => {
		const raised = sync([withBands(MEDICAL, 18)], PERSON, opened, '2026-04-01');
		assert.equal(left(raised, MEDICAL, PERSON, '2026-04-01'), 15);
		assert.deepEqual(moved(raised), [['MEDICAL', 'ADD', 'entitled', 4]]);
	});
	it('a cut takes the difference', () => {
		const cut = sync([withBands(MEDICAL, 12)], PERSON, opened, '2026-04-01');
		assert.equal(left(cut, MEDICAL, PERSON, '2026-04-01'), 9);
		assert.deepEqual(moved(cut), [['MEDICAL', 'DEDUCT', 'entitled', 2]]);
	});
	it('a cut past what is left leaves days taken alone, and carries nothing', () => {
		const row = {
			...withBands(MEDICAL, 14),
			lookup: { ...withBands(MEDICAL, 14).lookup, carry: {} }
		};
		const used = take(opened, MEDICAL, PERSON, 10, '2026-03-02');
		const lower = {
			...row,
			lookup: { ...row.lookup, service_bands: [{ service_months: 0, days: 5 }] }
		};
		const cut = sync([lower], PERSON, used, '2026-04-01');
		assert.deepEqual(cut.accounts.leave?.['MEDICAL']?.['MY.Y.2026-01-01'], {
			entitled: 5,
			used: 13
		});
		// 2026 closes under its own law, the cut
		const next = sync([row], PERSON, cut, '2027-01-01', [], () => ({
			lookup: lower.lookup,
			person: PERSON
		}));
		assert.deepEqual(next.accounts.leave?.['MEDICAL']?.['MY.Y.2027-01-01'], { entitled: 14 });
	});
	it('applied once, whatever runs next', () => {
		const changed = sync([withBands(MEDICAL, 18)], PERSON, opened, '2026-04-01');
		assert.deepEqual(sync([withBands(MEDICAL, 18)], PERSON, changed, '2026-05-01').moves, []);
	});
	it('a row gaining a figure opens at it, and what was taken counts', () => {
		const capped = { code: 'COMPASSIONATE', lookup: { grant_days: 3, window: 'CALENDAR_YEAR' } };
		const open = take(
			sync([NO_FIGURE], PERSON, EMPTY, '2026-03-01'),
			NO_FIGURE,
			PERSON,
			1,
			'2026-03-01'
		);
		const next = sync([capped], PERSON, open, '2026-04-01');
		assert.deepEqual(moved(next), [['COMPASSIONATE', 'ADD', 'entitled', 3]]);
		assert.equal(left(next, capped, PERSON, '2026-04-01'), 2);
		assert.equal(left(sync([capped], PERSON, next, '2027-01-01'), capped, PERSON, '2027-01-01'), 3);
	});
});

describe('service moves on', () => {
	it('a new band adds its difference inside the window', () => {
		const person = { ...PERSON, started: '2024-06-01' };
		const opened = take(
			sync([MEDICAL], person, EMPTY, '2026-01-02'),
			MEDICAL,
			person,
			2,
			'2026-01-02'
		);
		assert.equal(left(opened, MEDICAL, person, '2026-01-02'), 12);
		const reached = sync([MEDICAL], person, opened, '2026-06-01');
		assert.equal(left(reached, MEDICAL, person, '2026-06-01'), 16);
		assert.deepEqual(moved(reached), [['MEDICAL', 'ADD', 'entitled', 4]]);
	});
	it('a first year earns by completed months', () => {
		const person = { ...PERSON, started: '2026-01-01' };
		let held = sync([ANNUAL], person, EMPTY, '2026-01-01');
		assert.equal(left(held, ANNUAL, person, '2026-01-01'), 0);
		for (const [day, days] of [
			['2026-04-01', 2],
			['2026-07-01', 4],
			['2026-10-01', 6],
			['2026-12-01', 7]
		] as const) {
			held = sync([ANNUAL], person, held, day);
			assert.equal(left(held, ANNUAL, person, day), days, day);
		}
	});
	it('a closing window settles once on its last day, which counts as served, in the band it started in', () => {
		const person = { ...PERSON, started: '2026-01-01' };
		const firstYear = sync([ANNUAL], person, EMPTY, '2026-12-01');
		assert.equal(left(firstYear, ANNUAL, person, '2026-12-01'), 7);
		// the first year closes on 31 December, twelve months served: it settles at the full first band
		const second = sync([ANNUAL], person, firstYear, '2027-01-01');
		assert.equal(left(second, ANNUAL, person, '2026-12-31'), 8);
		assert.equal(left(second, ANNUAL, person, '2027-01-01'), 16);
		assert.deepEqual(moved(second), [
			['ANNUAL', 'ADD', 'entitled', 8],
			['ANNUAL', 'ADD', 'carried', 8],
			['ANNUAL', 'ADD', 'entitled', 1]
		]);
		// the second year ends twenty-four months in, yet it started in the 12-month band: its settlement moves nothing
		const third = sync(
			[ANNUAL],
			person,
			sync([ANNUAL], person, second, '2027-12-01'),
			'2028-01-01'
		);
		assert.deepEqual(
			moved(third).filter(([, , measure]) => measure === 'entitled'),
			[['ANNUAL', 'ADD', 'entitled', 12]]
		);
		// and it settles once: the day after posts nothing more
		assert.deepEqual(moved(sync([ANNUAL], person, third, '2028-01-02')), []);
	});
	it('a first year keeps days taken out of what it earned', () => {
		const person = { ...PERSON, started: '2026-01-01' };
		const earned = take(
			sync([ANNUAL], person, EMPTY, '2026-07-01'),
			ANNUAL,
			person,
			3,
			'2026-07-01'
		);
		assert.equal(
			left(sync([ANNUAL], person, earned, '2026-10-01'), ANNUAL, person, '2026-10-01'),
			3
		);
	});
});

describe('a new window', () => {
	it('a calendar year restores days used, and the old window stays', () => {
		const used = take(
			sync([MEDICAL], PERSON, EMPTY, '2026-03-01'),
			MEDICAL,
			PERSON,
			15,
			'2026-03-01'
		);
		const next = sync([MEDICAL], PERSON, used, '2027-01-01');
		assert.equal(left(next, MEDICAL, PERSON, '2027-01-01'), 18);
		assert.deepEqual(moved(next), [['MEDICAL', 'ADD', 'entitled', 18]]);
		assert.equal(next.moves[0]?.period, 'MY.Y.2027-01-01');
		assert.deepEqual(next.accounts.leave?.['MEDICAL']?.['MY.Y.2026-01-01'], {
			entitled: 18,
			used: 15
		});
	});
	it('unused days without a carry rule lapse', () => {
		const next = sync(
			[MEDICAL],
			PERSON,
			sync([MEDICAL], PERSON, EMPTY, '2026-03-01'),
			'2028-01-02'
		);
		assert.equal(left(next, MEDICAL, PERSON, '2028-01-02'), 22);
		assert.deepEqual(moved(next), [['MEDICAL', 'ADD', 'entitled', 22]]);
	});
	it('runs once on any day of the window', () => {
		const used = take(
			sync([MEDICAL], PERSON, EMPTY, '2026-03-01'),
			MEDICAL,
			PERSON,
			5,
			'2026-03-01'
		);
		const first = sync([MEDICAL], PERSON, used, '2027-01-01');
		const late = take(first, MEDICAL, PERSON, 2, '2027-02-01');
		assert.deepEqual(sync([MEDICAL], PERSON, late, '2027-06-01').moves, []);
	});
	it('a skipped year still lands on the entitlement, not twice', () => {
		const used = take(
			sync([MEDICAL], PERSON, EMPTY, '2026-03-01'),
			MEDICAL,
			PERSON,
			5,
			'2026-03-01'
		);
		assert.equal(
			left(sync([MEDICAL], PERSON, used, '2028-02-01'), MEDICAL, PERSON, '2028-02-01'),
			22
		);
	});
	it('a service year turns on the anniversary, not 1 January', () => {
		const person = { ...PERSON, started: '2024-07-01' };
		const opened = take(
			sync([ANNUAL], person, EMPTY, '2026-08-01'),
			ANNUAL,
			person,
			2,
			'2026-08-01'
		);
		assert.equal(left(opened, ANNUAL, person, '2026-08-01'), 10);
		assert.deepEqual(sync([ANNUAL], person, opened, '2027-01-01').moves, []);
		assert.equal(
			left(sync([ANNUAL], person, opened, '2027-07-01'), ANNUAL, person, '2027-07-01'),
			22
		);
	});
});

describe('an event row', () => {
	const row = { code: 'BEREAVEMENT', lookup: { grant_days: 3, opened_by: { BEREAVEMENT: {} } } };
	const first = [{ kind: 'BEREAVEMENT', on: '2026-02-10' }];
	const both = [...first, { kind: 'BEREAVEMENT', on: '2026-09-07' }];
	const opened = sync([row], PERSON, EMPTY, '2026-03-01', first);
	it('gives nothing by itself: a dated fact opens its days', () => {
		assert.deepEqual(sync([row], PERSON, EMPTY, '2026-03-01').accounts, {});
		assert.deepEqual(moved(opened), [['BEREAVEMENT', 'ADD', 'entitled', 3]]);
		assert.equal(opened.moves[0]?.period, 'MY.E.2026-02-10');
	});
	it('keeps what a fact opened, month after month', () => {
		assert.equal(
			left(sync([row], PERSON, opened, '2026-04-01', first), row, PERSON, '2026-04-01', first),
			3
		);
		assert.deepEqual(sync([row], PERSON, opened, '2027-01-01', first).moves, []);
	});
	it('days taken stay taken: nothing refills them', () => {
		const used = take(opened, row, PERSON, 3, '2026-02-11', first);
		assert.equal(
			left(sync([row], PERSON, used, '2026-04-01', first), row, PERSON, '2026-04-01', first),
			0
		);
		assert.equal(
			left(sync([row], PERSON, used, '2027-01-01', first), row, PERSON, '2027-01-01', first),
			0
		);
	});
	it('a second fact is its own period, so what is left does not stack', () => {
		const used = take(opened, row, PERSON, 1, '2026-02-11', first);
		const second = sync([row], PERSON, used, '2026-09-08', both);
		assert.deepEqual(moved(second), [['BEREAVEMENT', 'ADD', 'entitled', 3]]);
		assert.equal(left(second, row, PERSON, '2026-09-08', both), 3);
		assert.equal(left(second, row, PERSON, '2026-03-01', both), 2);
	});
	it('a fact that changes the grant posts the difference, on the same date', () => {
		const birth = {
			code: 'BIRTH',
			lookup: { grant_days: 90, opened_by: { CHILD_BIRTH: {}, BIRTH_COMPLICATION: { days: 90 } } }
		};
		const born = [{ kind: 'CHILD_BIRTH', on: '2026-03-02' }];
		const plain = sync([birth], PERSON, EMPTY, '2026-03-03', born);
		const hard = sync([birth], PERSON, plain, '2026-05-20', [
			...born,
			{ kind: 'BIRTH_COMPLICATION', on: '2026-03-02' }
		]);
		assert.deepEqual(moved(hard), [['BIRTH', 'ADD', 'entitled', 90]]);
		assert.equal(hard.accounts.leave?.['BIRTH']?.['MY.E.2026-03-02']?.['entitled'], 180);
	});
	it('a fact that grants nothing opens nothing', () => {
		const sick = {
			code: 'SICK',
			lookup: { opened_by: { LONG_ILLNESS: { days: 0 } } }
		};
		assert.deepEqual(
			sync([sick], PERSON, EMPTY, '2026-03-01', [{ kind: 'LONG_ILLNESS', on: '2026-02-02' }])
				.accounts,
			{}
		);
	});
});

describe('carry forward', () => {
	const person = { ...PERSON, started: '2022-07-01' };
	it('unused days carry on top of the new grant', () => {
		const opened = take(
			sync([ANNUAL], person, EMPTY, '2026-08-01'),
			ANNUAL,
			person,
			10,
			'2026-08-01'
		);
		assert.equal(left(opened, ANNUAL, person, '2026-08-01'), 2);
		const next = sync([ANNUAL], person, opened, '2027-07-01');
		assert.equal(left(next, ANNUAL, person, '2027-07-01'), 18);
		assert.deepEqual(moved(next), [
			['ANNUAL', 'ADD', 'entitled', 16],
			['ANNUAL', 'ADD', 'carried', 2]
		]);
	});
	it('carries at most one window: last year’s carry lapses', () => {
		const opened = sync([ANNUAL], person, EMPTY, '2026-08-01');
		const carried = sync([ANNUAL], person, opened, '2027-07-01');
		assert.equal(left(carried, ANNUAL, person, '2027-07-01'), 28);
		assert.equal(
			left(sync([ANNUAL], person, carried, '2028-07-01'), ANNUAL, person, '2028-07-01'),
			32
		);
	});
	it('holds to a cap on the row', () => {
		const capped = { ...ANNUAL, lookup: { ...ANNUAL.lookup, carry: { windows: 1, max_days: 5 } } };
		const opened = sync([capped], person, EMPTY, '2026-08-01');
		assert.equal(
			left(sync([capped], person, opened, '2027-07-01'), capped, person, '2027-07-01'),
			21
		);
	});
	it('a capped carry holds in the row’s own terms', () => {
		const capped = {
			code: 'ANNUAL',
			lookup: {
				window: 'SERVICE_YEAR',
				service_months: 12,
				grant_days: 12,
				carry: { windows: 1, max_days: 5 }
			}
		};
		const used = take(sync([capped], person, EMPTY, '2026-08-01'), capped, person, 3, '2026-08-01');
		assert.equal(
			left(sync([capped], person, used, '2027-07-01'), capped, person, '2027-07-01'),
			17
		);
	});
	it('a row that accrues adds each window and never lapses', () => {
		const row = {
			code: 'SIL',
			lookup: { grant_days: 5, per_months: 12, service_months: 12, window: 'LIFETIME' }
		};
		const held = sync([row], person, EMPTY, '2026-08-01');
		assert.equal(left(sync([row], person, held, '2027-07-01'), row, person, '2027-07-01'), 10);
	});
});

describe('the rules a row adds', () => {
	const start = '2024-06-01';
	const figure = (row: LeaveRow, person: LeavePerson, on: string) =>
		left(sync([row], person, EMPTY, on), row, person, on);
	it('a part-timer takes hours pro rata', () => {
		const row = {
			code: 'ANNUAL',
			lookup: {
				window: 'SERVICE_YEAR',
				grant_days: 10,
				part_time_pro_rata: true,
				full_time_weekly_hours: 40
			}
		};
		const person = {
			...PERSON,
			started: start,
			partTime: true,
			terms: { normal_hours_per_week: 20 }
		};
		assert.equal(figure(row, person, '2026-11-01'), 5);
		assert.equal(figure(row, { ...person, partTime: false }, '2026-11-01'), 10);
	});
	it('a row for part-timers gives a full-timer nothing', () => {
		const row = {
			code: 'PT',
			lookup: { window: 'CALENDAR_YEAR', grant_days: 10, eligibility: { engagement: 'PART_TIME' } }
		};
		assert.equal(figure(row, PERSON, '2026-11-01'), 0);
	});
	it('few weekly days and hours take the row’s table by year of service', () => {
		const row = {
			code: 'ANNUAL',
			lookup: {
				window: 'SERVICE_YEAR',
				service_offset_months: 6,
				full_time_weekly_hours: 30,
				service_bands: [{ service_months: 6, days: 10 }],
				grant_days_by_normal_days_per_week: [
					{ normal_days_per_week: 3, service_year: 1, days: 5 },
					{ normal_days_per_week: 3, service_year: 2, days: 6 }
				]
			}
		};
		const person = {
			...PERSON,
			started: '2025-11-01',
			terms: { normal_days_per_week: 3, normal_hours_per_week: 18 }
		};
		assert.equal(figure(row, person, '2026-05-01'), 5);
		const full = { ...person, terms: { normal_days_per_week: 5, normal_hours_per_week: 40 } };
		assert.equal(figure(row, full, '2026-05-01'), 10);
	});
	it('a class of work or a fact on the contract adds its days', () => {
		const row = {
			code: 'ANNUAL',
			lookup: {
				window: 'CALENDAR_YEAR',
				grant_days: 12,
				extra_days: [
					{ fact: 'disabled', days: 2 },
					{ category: 'ESPECIALLY_HEAVY_HAZARDOUS', days: 4 }
				]
			}
		};
		assert.equal(figure(row, { ...PERSON, facts: { disabled: true } }, '2026-11-01'), 14);
		assert.equal(
			figure(
				row,
				{ ...PERSON, terms: { statutory_work_category: 'ESPECIALLY_HEAVY_HAZARDOUS' } },
				'2026-11-01'
			),
			16
		);
		assert.equal(figure(row, PERSON, '2026-11-01'), 12);
	});
	it('a window of several years opens once in that span', () => {
		const row = {
			code: 'HOME',
			lookup: { rolling_months: 24, grant_days: 45, state_owned_employer: true }
		};
		const person = { ...PERSON, started: '2024-01-01', stateOwned: true };
		const used = take(sync([row], person, EMPTY, '2026-02-01'), row, person, 45, '2026-02-01');
		assert.equal(left(sync([row], person, used, '2027-06-01'), row, person, '2027-06-01'), 0);
		assert.equal(left(sync([row], person, used, '2028-02-01'), row, person, '2028-02-01'), 45);
	});
	it('a state-sector row gives a private employer nothing', () => {
		const row = {
			code: 'HOME',
			lookup: { window: 'CALENDAR_YEAR', grant_days: 20, state_owned_employer: true }
		};
		assert.equal(figure(row, PERSON, '2026-11-01'), 0);
	});
	it('the first year counts the calendar days left, whole days only', () => {
		const row = {
			code: 'ANNUAL',
			lookup: {
				window: 'CALENDAR_YEAR',
				qualifying_service_months: 12,
				first_year_proration_days: 365,
				service_bands: [{ service_months: 12, days: 5 }]
			}
		};
		const person = { ...PERSON, started: '2025-07-02' };
		// qualifies on 2 July 2026: 183 days left, so 5 × 183 ÷ 365 is 2 whole days
		assert.equal(figure(row, person, '2026-08-01'), 2);
		assert.equal(figure(row, person, '2027-02-01'), 5);
	});
	it('a contract’s carry limit holds', () => {
		const person = {
			...PERSON,
			started: '2022-07-01',
			terms: { annual_leave_carry_limit_days: 3 }
		};
		const opened = sync([ANNUAL], person, EMPTY, '2026-08-01');
		assert.equal(
			left(sync([ANNUAL], person, opened, '2027-07-01'), ANNUAL, person, '2027-07-01'),
			19
		);
	});
});

describe('whatever the sequence', () => {
	it('never takes more than is left, and a repeat is always a no-op', () => {
		// a fixed walk through three years of leave taken, catalog changes and repeated runs
		const person = { ...PERSON, started: '2024-02-10' };
		const rows = (figure: number) => [withBands(MEDICAL, figure), ANNUAL, NO_PAY];
		let held = EMPTY;
		let seed = 7;
		const next = (limit: number) => (seed = (seed * 31 + 11) % 1009) % limit;
		for (let month = 0; month < 36; month += 1) {
			const day = `${2025 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}-15`;
			const catalog = rows([10, 14, 18][next(3)] ?? 14);
			held = sync(catalog, person, held, day);
			assert.deepEqual(sync(catalog, person, held, day).moves, [], day);
			for (const row of [MEDICAL, ANNUAL]) {
				const free = Math.floor(Math.max(0, left(held, row, person, day)));
				const days = Math.min(free, next(3));
				if (days > 0) held = take(held, row, person, days, day);
				assert.ok(left(held, row, person, day) >= 0 || free === 0, `${row.code} on ${day}`);
			}
		}
	});
});

describe('a row’s own entitlement expression', () => {
	it('reads the dated work events', () => {
		const lookup = {
			entitlement:
				'return (ctx.work_events ?? []).some((event) => event.code === "NATURAL_DISASTER") ? 3 : 0;'
		};
		assert.equal(entitlementOf(lookup, PERSON, '2026-07-15'), 0);
		assert.equal(
			entitlementOf(
				lookup,
				{
					...PERSON,
					workEvents: [{ code: 'NATURAL_DISASTER', from: '2026-07-01', to: '2026-07-31' }]
				},
				'2026-07-15'
			),
			3
		);
	});
	it('withholding a window’s grant still carries what the last window left', () => {
		const row = {
			code: 'ANNUAL',
			lookup: {
				window: 'SERVICE_YEAR',
				service_offset_months: 6,
				carry: { windows: 1 },
				entitlement:
					"return get(ctx.subject.employment, 'events', []).some((event) => event.kind === 'GRANT_WITHHELD' && event.on <= ctx.as_of) ? 0 : 7;"
			}
		};
		const person = {
			...PERSON,
			started: '2024-01-01',
			employment: { events: [{ kind: 'GRANT_WITHHELD', on: '2025-07-01' }] }
		};
		const plans = entitlementPlans(
			[{ ...row, account: 'leave' }],
			person,
			subjectOf(person, []),
			'balance',
			{ leave: { ANNUAL: { 'MY.S.2024-07-01': { entitled: 7, used: 3 } } } },
			'2025-07-01'
		);
		assert.deepEqual(
			plans
				.flatMap((plan) => plan.wanted)
				.filter((row) => row.period === 'MY.S.2025-07-01')
				.map((row) => [row.measure, row.amount]),
			[['carried', 7 - 3]]
		);
	});
});
