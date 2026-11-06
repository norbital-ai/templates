// Everyone's leave comes from the catalog row. A change moves the balance by the difference from what was applied, a new
// window starts it again, and running it twice changes nothing.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
	NO_CAP_DAYS,
	settleLeave,
	type LeaveAccount,
	type LeavePerson,
	type LeaveRow
} from '../src/lib/leave/entitlement.ts';

const PERSON: LeavePerson = {
	started: '2023-01-01',
	partTime: false,
	gender: 'MALE',
	maritalStatus: 'MARRIED'
};
const EMPTY: LeaveAccount = { leave: {}, windows: {} };
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
const NO_PAY: LeaveRow = { code: 'NO_PAY', lookup: { no_cap: true } };
const NO_FIGURE: LeaveRow = { code: 'COMPASSIONATE', lookup: {} };
const take = (account: LeaveAccount, code: string, days: number): LeaveAccount => ({
	...account,
	leave: { ...account.leave, [code]: (account.leave[code] ?? 0) - days }
});
const withBands = (row: LeaveRow, days: number): LeaveRow => ({
	...row,
	lookup: { ...row.lookup, service_bands: [{ service_months: 0, days }] }
});

describe('a newcomer', () => {
	it('opens each row at its figure', () => {
		const { leave, moves } = settleLeave(
			[MEDICAL],
			{ ...PERSON, started: '2026-11-01' },
			EMPTY,
			'2026-11-01'
		);
		assert.equal(leave['MEDICAL'], 14);
		assert.deepEqual(moves, [{ code: 'MEDICAL', operation: 'ADD', amount: 14 }]);
	});
	it('takes the band their service reaches', () => {
		assert.equal(settleLeave([MEDICAL], PERSON, EMPTY, '2026-11-01').leave['MEDICAL'], 18);
	});
	it('takes the part-time bands on a part-time contract', () => {
		const person = { ...PERSON, started: '2026-11-01', partTime: true };
		assert.equal(settleLeave([MEDICAL], person, EMPTY, '2026-11-01').leave['MEDICAL'], 10);
	});
	it('opens a row with no figure, or no_cap, too large to refuse', () => {
		const { leave } = settleLeave([NO_PAY, NO_FIGURE], PERSON, EMPTY, '2026-11-01');
		assert.deepEqual(leave, { NO_PAY: NO_CAP_DAYS, COMPASSIONATE: NO_CAP_DAYS });
	});
	it('gets nothing from a row for someone else', () => {
		const row = {
			code: 'MATERNITY',
			lookup: { grant_days: 98, window: 'EVENT', eligibility: { gender: 'FEMALE' } }
		};
		assert.equal(settleLeave([row], PERSON, EMPTY, '2026-11-01').leave['MATERNITY'], 0);
	});
	it('waits out the service a row asks for, then gets it', () => {
		const row = {
			code: 'SICK',
			lookup: { grant_days: 14, window: 'CALENDAR_YEAR', eligibility_months: 3 }
		};
		const person = { ...PERSON, started: '2026-09-01' };
		const joined = settleLeave([row], person, EMPTY, '2026-09-01');
		assert.equal(joined.leave['SICK'], 0);
		assert.equal(settleLeave([row], person, joined, '2026-12-01').leave['SICK'], 14);
	});
});

describe('running it again', () => {
	it('moves nothing, on any row', () => {
		const rows = [MEDICAL, ANNUAL, NO_PAY, NO_FIGURE];
		const first = settleLeave(rows, PERSON, EMPTY, '2026-11-01');
		const second = settleLeave(rows, PERSON, first, '2026-11-01');
		assert.deepEqual(second.moves, []);
		assert.deepEqual(second.leave, first.leave);
		assert.deepEqual(second.windows, first.windows);
	});
	it('moves nothing after days are taken', () => {
		const opened = take(settleLeave([MEDICAL], PERSON, EMPTY, '2026-03-01'), 'MEDICAL', 3);
		const again = settleLeave([MEDICAL], PERSON, opened, '2026-03-01');
		assert.deepEqual(again.moves, []);
		assert.equal(again.leave['MEDICAL'], 15);
	});
	it('holds for any order of days within a window', () => {
		let account = settleLeave([MEDICAL, ANNUAL], PERSON, EMPTY, '2026-01-02');
		for (const day of ['2026-03-05', '2026-03-06', '2026-07-01', '2026-07-01', '2026-12-31']) {
			account = settleLeave([MEDICAL], PERSON, account, day);
			assert.deepEqual(settleLeave([MEDICAL], PERSON, account, day).moves, []);
		}
	});
});

describe('a catalog change', () => {
	const opened = take(
		settleLeave([withBands(MEDICAL, 14)], PERSON, EMPTY, '2026-03-01'),
		'MEDICAL',
		3
	);
	it('a raise adds the difference, and days taken stay taken', () => {
		const { leave, moves } = settleLeave([withBands(MEDICAL, 18)], PERSON, opened, '2026-04-01');
		assert.equal(leave['MEDICAL'], 15);
		assert.deepEqual(moves, [{ code: 'MEDICAL', operation: 'ADD', amount: 4 }]);
	});
	it('a cut takes the difference', () => {
		const { leave, moves } = settleLeave([withBands(MEDICAL, 12)], PERSON, opened, '2026-04-01');
		assert.equal(leave['MEDICAL'], 9);
		assert.deepEqual(moves, [{ code: 'MEDICAL', operation: 'DEDUCT', amount: 2 }]);
	});
	it('a cut stops at zero: days taken are never clawed back', () => {
		const used = take(opened, 'MEDICAL', 10);
		assert.equal(
			settleLeave([withBands(MEDICAL, 5)], PERSON, used, '2026-04-01').leave['MEDICAL'],
			0
		);
	});
	it('applied once, whatever runs next', () => {
		const changed = settleLeave([withBands(MEDICAL, 18)], PERSON, opened, '2026-04-01');
		assert.deepEqual(
			settleLeave([withBands(MEDICAL, 18)], PERSON, changed, '2026-05-01').moves,
			[]
		);
	});
	it('a row gaining a figure keeps what it held', () => {
		const open = settleLeave([NO_FIGURE], PERSON, EMPTY, '2026-03-01');
		const capped = { code: 'COMPASSIONATE', lookup: { grant_days: 3, window: 'CALENDAR_YEAR' } };
		const next = settleLeave([capped], PERSON, open, '2026-04-01');
		assert.deepEqual(next.moves, []);
		assert.equal(settleLeave([capped], PERSON, next, '2027-01-01').leave['COMPASSIONATE'], 3);
	});
});

describe('service moves on', () => {
	it('a new band adds its difference inside the window', () => {
		const person = { ...PERSON, started: '2024-06-01' };
		const opened = take(settleLeave([MEDICAL], person, EMPTY, '2026-01-02'), 'MEDICAL', 2);
		assert.equal(opened.leave['MEDICAL'], 12);
		const { leave, moves } = settleLeave([MEDICAL], person, opened, '2026-06-01');
		assert.equal(leave['MEDICAL'], 16);
		assert.deepEqual(moves, [{ code: 'MEDICAL', operation: 'ADD', amount: 4 }]);
	});
	it('a first year earns by completed months', () => {
		const person = { ...PERSON, started: '2026-01-01' };
		let account = settleLeave([ANNUAL], person, EMPTY, '2026-01-01');
		assert.equal(account.leave['ANNUAL'], 0);
		for (const [day, days] of [
			['2026-04-01', 2],
			['2026-07-01', 4],
			['2026-10-01', 6],
			['2026-12-01', 7]
		] as const) {
			account = settleLeave([ANNUAL], person, account, day);
			assert.equal(account.leave['ANNUAL'], days, day);
		}
	});
	it('a first year keeps days taken out of what it earned', () => {
		const person = { ...PERSON, started: '2026-01-01' };
		const earned = take(settleLeave([ANNUAL], person, EMPTY, '2026-07-01'), 'ANNUAL', 3);
		assert.equal(settleLeave([ANNUAL], person, earned, '2026-10-01').leave['ANNUAL'], 3);
	});
});

describe('a new window', () => {
	it('a calendar year restores days used', () => {
		const used = take(settleLeave([MEDICAL], PERSON, EMPTY, '2026-03-01'), 'MEDICAL', 15);
		const { leave, moves } = settleLeave([MEDICAL], PERSON, used, '2027-01-01');
		assert.equal(leave['MEDICAL'], 18);
		assert.deepEqual(moves, [{ code: 'MEDICAL', operation: 'ADD', amount: 15 }]);
	});
	it('unused days without a carry rule lapse', () => {
		const { leave, moves } = settleLeave(
			[MEDICAL],
			PERSON,
			settleLeave([MEDICAL], PERSON, EMPTY, '2026-03-01'),
			'2028-01-02'
		);
		assert.equal(leave['MEDICAL'], 22);
		assert.deepEqual(moves, [{ code: 'MEDICAL', operation: 'ADD', amount: 4 }]);
	});
	it('runs once on any day of the window', () => {
		const used = take(settleLeave([MEDICAL], PERSON, EMPTY, '2026-03-01'), 'MEDICAL', 5);
		const first = settleLeave([MEDICAL], PERSON, used, '2027-01-01');
		const late = take(first, 'MEDICAL', 2);
		assert.deepEqual(settleLeave([MEDICAL], PERSON, late, '2027-06-01').moves, []);
	});
	it('a skipped year still lands on the entitlement, not twice', () => {
		const used = take(settleLeave([MEDICAL], PERSON, EMPTY, '2026-03-01'), 'MEDICAL', 5);
		assert.equal(settleLeave([MEDICAL], PERSON, used, '2028-02-01').leave['MEDICAL'], 22);
	});
	it('a service year turns on the anniversary, not 1 January', () => {
		const person = { ...PERSON, started: '2024-07-01' };
		const opened = take(settleLeave([ANNUAL], person, EMPTY, '2026-08-01'), 'ANNUAL', 2);
		assert.equal(opened.leave['ANNUAL'], 10);
		assert.deepEqual(settleLeave([ANNUAL], person, opened, '2027-01-01').moves, []);
		assert.equal(settleLeave([ANNUAL], person, opened, '2027-07-01').leave['ANNUAL'], 22);
	});
});

describe('an event row', () => {
	const row = { code: 'BEREAVEMENT', lookup: { grant_days: 3, window: 'EVENT' } };
	it('refills for the next event, within the same year', () => {
		const used = take(settleLeave([row], PERSON, EMPTY, '2026-03-01'), 'BEREAVEMENT', 3);
		assert.equal(settleLeave([row], PERSON, used, '2026-03-20').leave['BEREAVEMENT'], 0);
		assert.equal(settleLeave([row], PERSON, used, '2026-04-01').leave['BEREAVEMENT'], 3);
	});
});

describe('carry forward', () => {
	const person = { ...PERSON, started: '2022-07-01' };
	it('unused days carry on top of the new grant', () => {
		const opened = take(settleLeave([ANNUAL], person, EMPTY, '2026-08-01'), 'ANNUAL', 10);
		assert.equal(opened.leave['ANNUAL'], 2);
		assert.equal(settleLeave([ANNUAL], person, opened, '2027-07-01').leave['ANNUAL'], 18);
	});
	it('carries at most one window: last year’s carry lapses', () => {
		const opened = settleLeave([ANNUAL], person, EMPTY, '2026-08-01');
		const carried = settleLeave([ANNUAL], person, opened, '2027-07-01');
		assert.equal(carried.leave['ANNUAL'], 28);
		assert.equal(settleLeave([ANNUAL], person, carried, '2028-07-01').leave['ANNUAL'], 32);
	});
	it('holds to a cap on the row', () => {
		const capped = { ...ANNUAL, lookup: { ...ANNUAL.lookup, carry: { windows: 1, max_days: 5 } } };
		const opened = settleLeave([capped], person, EMPTY, '2026-08-01');
		assert.equal(settleLeave([capped], person, opened, '2027-07-01').leave['ANNUAL'], 21);
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
		const used = take(settleLeave([capped], person, EMPTY, '2026-08-01'), 'ANNUAL', 3);
		assert.equal(settleLeave([capped], person, used, '2027-07-01').leave['ANNUAL'], 17);
	});
	it('a row that accrues adds each window and never lapses', () => {
		const row = {
			code: 'SIL',
			lookup: { grant_days: 5, per_months: 12, service_months: 12, window: 'LIFETIME' }
		};
		const held = settleLeave([row], person, EMPTY, '2026-08-01');
		assert.equal(settleLeave([row], person, held, '2027-07-01').leave['SIL'], 10);
	});
});

describe('the rules a statute adds', () => {
	const start = '2024-06-01';
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
		assert.equal(settleLeave([row], person, EMPTY, '2026-11-01').leave['ANNUAL'], 5);
		assert.equal(
			settleLeave([row], { ...person, partTime: false }, EMPTY, '2026-11-01').leave['ANNUAL'],
			10
		);
	});
	it('a row for part-timers gives a full-timer nothing', () => {
		const row = {
			code: 'PT',
			lookup: { window: 'CALENDAR_YEAR', grant_days: 10, eligibility: { engagement: 'PART_TIME' } }
		};
		assert.equal(settleLeave([row], PERSON, EMPTY, '2026-11-01').leave['PT'], 0);
	});
	it('few weekly days and hours take the statute’s table by year of service', () => {
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
		assert.equal(settleLeave([row], person, EMPTY, '2026-05-01').leave['ANNUAL'], 5);
		const full = { ...person, terms: { normal_days_per_week: 5, normal_hours_per_week: 40 } };
		assert.equal(settleLeave([row], full, EMPTY, '2026-05-01').leave['ANNUAL'], 10);
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
		assert.equal(
			settleLeave([row], { ...PERSON, facts: { disabled: true } }, EMPTY, '2026-11-01').leave[
				'ANNUAL'
			],
			14
		);
		assert.equal(
			settleLeave(
				[row],
				{ ...PERSON, terms: { statutory_work_category: 'ESPECIALLY_HEAVY_HAZARDOUS' } },
				EMPTY,
				'2026-11-01'
			).leave['ANNUAL'],
			16
		);
		assert.equal(settleLeave([row], PERSON, EMPTY, '2026-11-01').leave['ANNUAL'], 12);
	});
	it('a window of several years opens once in that span', () => {
		const row = {
			code: 'HOME',
			lookup: { rolling_months: 24, grant_days: 45, state_owned_employer: true }
		};
		const person = { ...PERSON, started: '2024-01-01', stateOwned: true };
		const used = take(settleLeave([row], person, EMPTY, '2026-02-01'), 'HOME', 45);
		assert.equal(settleLeave([row], person, used, '2027-06-01').leave['HOME'], 0);
		assert.equal(settleLeave([row], person, used, '2028-02-01').leave['HOME'], 45);
	});
	it('a state-sector row gives a private employer nothing', () => {
		const row = {
			code: 'HOME',
			lookup: { window: 'CALENDAR_YEAR', grant_days: 20, state_owned_employer: true }
		};
		assert.equal(settleLeave([row], PERSON, EMPTY, '2026-11-01').leave['HOME'], 0);
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
		assert.equal(settleLeave([row], person, EMPTY, '2026-08-01').leave['ANNUAL'], 2);
		assert.equal(settleLeave([row], person, EMPTY, '2027-02-01').leave['ANNUAL'], 5);
	});
	it('a contract’s carry limit holds', () => {
		const person = {
			...PERSON,
			started: '2022-07-01',
			terms: { annual_leave_carry_limit_days: 3 }
		};
		const opened = settleLeave([ANNUAL], person, EMPTY, '2026-08-01');
		assert.equal(settleLeave([ANNUAL], person, opened, '2027-07-01').leave['ANNUAL'], 19);
	});
});

describe('an account from before this', () => {
	const seeded: LeaveAccount = { leave: { ANNUAL: 7 }, windows: {} };
	it('keeps what it holds, however the figure compares', () => {
		const { leave, moves } = settleLeave([ANNUAL], PERSON, seeded, '2026-11-01');
		assert.equal(leave['ANNUAL'], 7);
		assert.deepEqual(moves, []);
	});
	it('then counts like any other', () => {
		const first = settleLeave([ANNUAL], PERSON, seeded, '2026-11-01');
		assert.deepEqual(settleLeave([ANNUAL], PERSON, first, '2026-11-02').moves, []);
		// 16 for the new band, and the 7 held carry
		assert.equal(settleLeave([ANNUAL], PERSON, first, '2028-01-01').leave['ANNUAL'], 23);
	});
});

describe('whatever the sequence', () => {
	it('never goes negative, and a repeat is always a no-op', () => {
		// a fixed walk through three years of leave taken, catalog changes and repeated runs
		const person = { ...PERSON, started: '2024-02-10' };
		const rows = (figure: number): readonly LeaveRow[] => [
			withBands(MEDICAL, figure),
			ANNUAL,
			NO_PAY
		];
		let account = EMPTY;
		let seed = 7;
		const next = (limit: number) => (seed = (seed * 31 + 11) % 1009) % limit;
		for (let month = 0; month < 36; month += 1) {
			const day = `${2025 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}-15`;
			const catalog = rows([10, 14, 18][next(3)] ?? 14);
			account = settleLeave(catalog, person, account, day);
			assert.deepEqual(settleLeave(catalog, person, account, day).moves, [], day);
			for (const code of ['MEDICAL', 'ANNUAL']) {
				const held = account.leave[code] ?? 0;
				account = take(account, code, Math.min(held, next(3)));
				assert.ok((account.leave[code] ?? 0) >= 0, `${code} on ${day}`);
			}
		}
	});
});
