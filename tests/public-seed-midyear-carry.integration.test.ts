import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { bearerHeaders, postGuestCommand } from '@norbital-ai/test-utilities';
import { leaveAccountIdFor, leaveEntryIdFor } from '../src/lib/leave/entitlements.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const SUCCESSOR_ID = '33333333-3333-4333-8333-333333333333';

const annual2025 = leaveAccountIdFor({
	employment_id: EMPLOYMENT_ID,
	leave_code: 'ANNUAL',
	leave_year: 2025
});
const annual2026 = leaveAccountIdFor({
	employment_id: EMPLOYMENT_ID,
	leave_code: 'ANNUAL',
	leave_year: 2026
});

const sumDays = (
	rows: ReadonlyArray<unknown>,
	pick: (row: Record<string, unknown>) => boolean = () => true
): number =>
	rows.reduce((total, row) => {
		const record = row as Record<string, unknown>;
		return pick(record) ? total + Number(record.days) : total;
	}, 0);

const AWARD = (row: Record<string, unknown>): boolean =>
	['OPENING_ENTITLEMENT', 'ACCRUAL', 'STATUTORY_ADJUSTMENT', 'POLICY_ADJUSTMENT'].includes(
		String(row.kind)
	);

/**
 * HR9: mid-year statutory switch + carry-forward year boundary.
 *
 * Two SEALED PUB profiles split the 2026 leave year at 1 July: the predecessor
 * (8-day annual floor) governs January–June, the successor (14 days,
 * FULL_AT_EFFECTIVE_DATE) governs from 1 July. Refreshing the law family posts
 * one +6 statutory adjustment on the 2026 account. The 2025→2026 boundary, crossed
 * at seed time, already carries 5 of 8 days forward under the 5-day cap, forfeits
 * 3, and expires the unused carry after its March window.
 */
test(
	'public seed mid-year statutory switch adjusts entitlement and the year boundary carries',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-midyear-carry');
		try {
			// Year boundary first: the seed-time refresh already crossed 2025→2026.
			const previous = await session.query(`select id, status from leave_accounts where id = $1`, [
				annual2025
			]);
			assert.equal(previous.length, 1, 'the 2025 annual account exists');
			assert.equal((previous[0] as Record<string, unknown>).status, 'CLOSED');
			const previousEntries = (await session.query(
				`select kind, days, source_key from leave_entries where leave_account_id = $1`,
				[annual2025]
			)) as ReadonlyArray<Record<string, unknown>>;
			assert.equal(sumDays(previousEntries), 0, 'the closed balance transfers out fully');
			assert.deepEqual(
				previousEntries
					.filter((row) => String(row.source_key).startsWith(`close:${annual2025}`))
					.map((row) => [row.kind, Number(row.days)])
					.sort(),
				[
					['CARRY_TRANSFER_OUT', -5],
					['EXPIRED', -3]
				],
				'5 days carried under the cap, 3 forfeited above it'
			);

			const currentEntries = (await session.query(
				`select kind, days, source_key,
					to_char(effective_on, 'YYYY-MM-DD') as effective_on,
					to_char(expires_on, 'YYYY-MM-DD') as expires_on
				 from leave_entries where leave_account_id = $1`,
				[annual2026]
			)) as ReadonlyArray<Record<string, unknown>>;
			const carry = currentEntries.filter(
				(row) => String(row.source_key) === `carry:${annual2025}`
			);
			assert.equal(carry.length, 1, JSON.stringify(currentEntries));
			assert.equal(carry[0]?.kind, 'CARRY_FORWARD');
			assert.equal(Number(carry[0]?.days), 5);
			assert.equal(String(carry[0]?.expires_on).slice(0, 10), '2026-03-31');
			const carryExpiry = currentEntries.filter(
				(row) =>
					String(row.source_key) ===
					`expire:${leaveEntryIdFor({ leave_account_id: annual2026, source_key: `carry:${annual2025}` })}`
			);
			assert.equal(carryExpiry.length, 1, 'unused carry expires after its window');
			assert.equal(carryExpiry[0]?.kind, 'EXPIRED');
			assert.equal(Number(carryExpiry[0]?.days), -5);
			assert.equal(sumDays(currentEntries, AWARD), 8, 'no target change yet: 8 awarded');

			// Mid-year switch: end-date the predecessor at 30 June, seal the 14-day successor.
			await session.query(`update jurisdictions set effective_range = $1 where id = $2`, [
				{ start: '2020-01-01', end: '2026-06-30' },
				JURISDICTION_ID
			]);
			await session.query(
				`insert into jurisdictions (
					id, code, name, lifecycle, currency, tax_year_start_month,
					proration, ordinary_rate_basis, ordinary_rate_divisor, regime,
					statutory_leave, effective_range, supersedes_id
				) values ($1, $2, $3, 'SEALED', $4, 1, $5, 'DAYS_PER_MONTH', 26, $6, $7, $8, $9)`,
				[
					SUCCESSOR_ID,
					'PUB',
					'Public fixture profile (July revision)',
					'MYR',
					{ by: 'CALENDAR_DAYS' },
					{ overtime_coverage: null, overtime_rules: [], overtime_limits: [] },
					[
						{
							kind: 'ANNUAL',
							ladder: [{ band_from: 0, days: 14 }],
							per_child: null,
							max_days: null,
							transition: 'FULL_AT_EFFECTIVE_DATE',
							settlement: {
								settlement: 'CARRY',
								limit_days: null,
								expiry_months: 12,
								coverage: null
							},
							authority: 'Public fixture — July revision doubles the annual floor.'
						},
						{
							kind: 'HOSPITALIZATION',
							ladder: [{ band_from: 0, days: 60 }],
							per_child: null,
							max_days: null,
							transition: 'NEXT_LEAVE_YEAR',
							settlement: { settlement: 'FORFEIT' },
							authority: 'Public fixture — not a sealed statutory table.'
						},
						{
							kind: 'SHARED_PARENTAL',
							account_basis: 'EVENT',
							qualifying_service_months: 0,
							vesting: 'UPFRONT',
							event: {
								window_months: 12,
								allocation: 'HOUSEHOLD',
								unit: 'WEEKS',
								weekly_index_cap: 6
							},
							ladder: [{ band_from: 0, days: 10 }],
							per_child: null,
							max_days: null,
							transition: 'NEXT_LEAVE_YEAR',
							settlement: { settlement: 'FORFEIT' },
							authority: 'Public fixture — qualifying-event workflow test only.'
						}
					],
					{ start: '2026-07-01', end: null },
					JURISDICTION_ID
				]
			);
			const started = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'leave_ledger_refresh', input: { jurisdiction_code: 'PUB' } },
				bearerHeaders(session.credential)
			);
			assert.ok(
				started.status >= 200 && started.status < 300,
				`automations.start ${started.status}: ${JSON.stringify(started.value)}`
			);

			const deadline = Date.now() + 10_000;
			let adjusted: ReadonlyArray<Record<string, unknown>> = [];
			for (;;) {
				adjusted = (await session.query(
					`select kind, days, source_key,
						to_char(effective_on, 'YYYY-MM-DD') as effective_on
					 from leave_entries
					 where leave_account_id = $1 and kind = 'STATUTORY_ADJUSTMENT'`,
					[annual2026]
				)) as ReadonlyArray<Record<string, unknown>>;
				if (adjusted.length > 0 || Date.now() > deadline) break;
				await delay(50);
			}
			assert.equal(adjusted.length, 1, 'one mid-year statutory adjustment');
			assert.equal(Number(adjusted[0]?.days), 6);
			assert.equal(adjusted[0]?.source_key, `statutory:${SUCCESSOR_ID}`);
			assert.equal(String(adjusted[0]?.effective_on).slice(0, 10), '2026-07-01');

			const rerun = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'leave_ledger_refresh', input: { jurisdiction_code: 'PUB' } },
				bearerHeaders(session.credential)
			);
			assert.ok(rerun.status < 300, JSON.stringify(rerun.value));
			const after = (await session.query(
				`select kind, days from leave_entries where leave_account_id = $1`,
				[annual2026]
			)) as ReadonlyArray<Record<string, unknown>>;
			assert.equal(sumDays(after, AWARD), 14, '14 awarded: 8 opening + 6 July adjustment');
			assert.equal(
				sumDays(after),
				13,
				'13 remaining: 14 awarded + 5 carried − 5 expired − 1 April day taken'
			);
			assert.ok(
				(await session.query(`select id from companies where id = $1`, [COMPANY_ID])).length === 1
			);
		} finally {
			await session.stop();
		}
	}
);
