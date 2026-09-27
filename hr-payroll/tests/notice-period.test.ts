import assert from 'node:assert/strict';
import test from 'node:test';
import {
	noticeDaysRemaining,
	noticeMonthlyWages,
	serviceYearsOn
} from '../src/lib/expressions/notice-period.ts';

// Direct probes of the production interval arithmetic, using the installed public date API.
// Full catalogue/gather/payroll evidence is separately in statutory-my-notice.test.ts.
const employment = { service_start: '2025-01-01', exit_date: '2026-01-31' };
const cents = (value: number) => Math.round(value * 100) / 100;

test('notice includes its written giving day; full service and whole waiver leave zero', () => {
	assert.equal(noticeDaysRemaining(employment, 28, '2026-01-04', 0), 0);
	assert.equal(noticeDaysRemaining(employment, 28, '2026-01-20', 0), 16);
	assert.equal(noticeDaysRemaining(employment, 28, '2026-01-20', 16), 0);
	assert.equal(noticeMonthlyWages(employment, 3000, 28, '2026-01-20', 16), 0);
});

test('no notice and partial/waived notice price only the prospective interval', () => {
	assert.equal(noticeMonthlyWages(employment, 3000, 28, '', 0), 3000);
	assert.equal(cents(noticeMonthlyWages(employment, 3000, 28, '2026-01-20', 0)), 1714.29);
	assert.equal(cents(noticeMonthlyWages(employment, 3000, 28, '2026-01-20', 6)), 1071.43);
	assert.equal(noticeMonthlyWages(employment, 3000, 60, '', 0), 6100);
});

test('cross-month and leap-year intervals use actual calendar months', () => {
	assert.equal(
		cents(
			noticeMonthlyWages({ ...employment, exit_date: '2026-02-23' }, 3000, 28, '2026-02-07', 0)
		),
		1116.36
	);
	assert.equal(
		noticeMonthlyWages({ ...employment, exit_date: '2028-01-31' }, 2900, 29, '', 0),
		2900
	);
	assert.equal(noticeDaysRemaining(employment, 0, '', 0), 0);
});

test('notice-date service does not advance to the later departure anniversary', () => {
	const person = { service_start: '2024-02-01', exit_date: '2026-02-15' };
	assert.equal(serviceYearsOn(person, '2026-01-31'), 1n);
	assert.equal(serviceYearsOn(person, '2026-02-01'), 2n);
	assert.equal(cents(noticeMonthlyWages(person, 3000, 28, '2026-01-31', 0)), 1285.71);
});

test('invalid dates, fractional days and excessive waivers refuse', () => {
	for (const date of ['2026-02-30', '2024-12-31', '2026-02-01'])
		assert.throws(() => noticeDaysRemaining(employment, 28, date, 0));
	for (const waiver of [-1, 0.5, 29])
		assert.throws(() => noticeDaysRemaining(employment, 28, '', waiver));
	assert.throws(() => noticeDaysRemaining(employment, 28.5, '', 0));
	assert.throws(() => noticeMonthlyWages(employment, NaN, 28, '', 0));
});
