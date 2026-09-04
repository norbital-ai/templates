import test from 'node:test';
import assert from 'node:assert/strict';
import { asRecord, bearerHeaders, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	ANNUAL_LEAVE_TYPE_ID,
	COMPANY_ID,
	EMPLOYMENT_ID,
	FEBRUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const H1_PROFILE_ID = '22222222-2222-4222-8222-222222222211';
const H2_PROFILE_ID = '22222222-2222-4222-8222-222222222212';
const CHILDCARE_LEAVE_TYPE_ID = 'ffffffff-ffff-4fff-8fff-fffffffffff3';
const CHILD_ONE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const CHILD_TWO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
const CARRY_LEAVE_REQUEST_ID = 'ffffffff-ffff-4fff-8fff-fffffffffff4';

const PUB_REGIME = {
	overtime_coverage: null,
	overtime_rules: [],
	overtime_limits: []
};

const PUB_PRORATION = { by: 'CALENDAR_DAYS' };

const childcareStatutoryLeave = (
	perChildDays: number,
	maxDays: number
): ReadonlyArray<Readonly<Record<string, unknown>>> => [
	{
		kind: 'ANNUAL',
		ladder: [{ band_from: 0, days: 8 }],
		per_child: null,
		max_days: null,
		authority: 'Public fixture — not a sealed statutory table.'
	},
	{
		kind: 'CHILDCARE',
		ladder: [{ band_from: 0, days: 0 }],
		per_child: { days: perChildDays, age_limit: 7, min_children: 1 },
		max_days: maxDays,
		authority: 'Public fixture childcare statute'
	}
];

const invokePreviewLeave = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	input: Readonly<Record<string, unknown>>
): Promise<Readonly<Record<string, unknown>>> => {
	const previewed = await postGuestCommand(
		session.host.baseUrl,
		'invoke.preview_leave',
		{ input },
		bearerHeaders(session.credential)
	);
	if (previewed.status < 200 || previewed.status >= 300) {
		throw new Error(
			`invoke.preview_leave returned ${previewed.status}: ${JSON.stringify(previewed.value)}`
		);
	}
	return asRecord(previewed.value, 'invoke.preview_leave');
};

const insertSealedProfile = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	profile: Readonly<{
		readonly id: string;
		readonly name: string;
		readonly effective_range: Readonly<{ readonly start: string; readonly end: string | null }>;
		readonly statutory_leave: ReadonlyArray<Readonly<Record<string, unknown>>>;
	}>
) => {
	await session.query(
		`insert into jurisdictions (
			id, code, name, lifecycle, currency, tax_year_start_month,
			proration, ordinary_rate_basis, ordinary_rate_divisor, regime,
			statutory_leave, effective_range
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		[
			profile.id,
			'SG',
			profile.name,
			'SEALED',
			'SGD',
			1,
			PUB_PRORATION,
			'DAYS_PER_MONTH',
			26,
			PUB_REGIME,
			profile.statutory_leave,
			profile.effective_range
		]
	);
};

test(
	'public seed preview_leave reflects midyear CHILDCARE uplift and annual carry-forward',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-p35-midyear');
		try {
			await insertSealedProfile(session, {
				id: H1_PROFILE_ID,
				name: 'Singapore 2026 H1',
				effective_range: { start: '2020-01-01', end: '2026-06-30' },
				statutory_leave: childcareStatutoryLeave(2, 6)
			});
			await insertSealedProfile(session, {
				id: H2_PROFILE_ID,
				name: 'Singapore 2026 H2',
				effective_range: { start: '2026-07-01', end: null },
				statutory_leave: childcareStatutoryLeave(4, 12)
			});

			await session.query(
				`insert into leave_types (
					id, company_id, statutory_profile_id, code, name, statutory_kind,
					eligibility, encash_on_exit, accrual, entitlement, payroll_effect
				) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
				[
					CHILDCARE_LEAVE_TYPE_ID,
					COMPANY_ID,
					H2_PROFILE_ID,
					'CHILDCARE',
					'Childcare leave',
					'CHILDCARE',
					[],
					false,
					{ kind: 'UPFRONT', carry: null },
					{ layers: [] },
					{ kind: 'PAID' }
				]
			);

			await session.query(
				`insert into employee_children (
					id, employment_id, child_birthdate, relationship, effective_range, supersedes_id
				) values ($1, $2, $3, $4, $5, $6), ($7, $2, $8, $4, $5, $6)`,
				[
					CHILD_ONE_ID,
					EMPLOYMENT_ID,
					'2022-03-01T00:00:00.000Z',
					'CHILD',
					null,
					null,
					CHILD_TWO_ID,
					'2023-04-02T00:00:00.000Z'
				]
			);

			await session.query(`update companies set jurisdiction_id = $1 where id = $2`, [
				H1_PROFILE_ID,
				COMPANY_ID
			]);

			const june = await invokePreviewLeave(session, {
				employment_id: EMPLOYMENT_ID,
				leave_type_id: CHILDCARE_LEAVE_TYPE_ID,
				calendar_month: '2026-06',
				range: {
					start: { date: '2026-06-15', half: 'FIRST' },
					end: { date: '2026-06-15', half: 'SECOND' }
				}
			});
			const july = await invokePreviewLeave(session, {
				employment_id: EMPLOYMENT_ID,
				leave_type_id: CHILDCARE_LEAVE_TYPE_ID,
				calendar_month: '2026-07',
				range: {
					start: { date: '2026-07-15', half: 'FIRST' },
					end: { date: '2026-07-15', half: 'SECOND' }
				}
			});

			assert.equal(typeof june.remaining_days, 'number');
			assert.equal(typeof july.remaining_days, 'number');
			const juneRemaining = Number(june.remaining_days);
			const julyRemaining = Number(july.remaining_days);
			assert.ok(
				Math.abs(juneRemaining - 4) <= 0.01,
				`June remaining_days expected 4, got ${juneRemaining}`
			);
			assert.ok(
				Math.abs(julyRemaining - 8) <= 0.01,
				`July remaining_days expected 8, got ${julyRemaining}`
			);
			assert.ok(julyRemaining > juneRemaining);

			await session.query(`update leave_types set accrual = $1 where id = $2`, [
				{ kind: 'MONTHLY', carry: { limit_days: 5, expiry_months: 3 } },
				ANNUAL_LEAVE_TYPE_ID
			]);
			await session.query(
				`insert into leave_requests (id, employment_id, leave_type_id, event) values ($1, $2, $3, $4)`,
				[
					CARRY_LEAVE_REQUEST_ID,
					EMPLOYMENT_ID,
					ANNUAL_LEAVE_TYPE_ID,
					{
						kind: 'TIME_OFF',
						range: {
							start: { date: '2025-08-01', half: 'FIRST' },
							end: { date: '2025-08-01', half: 'SECOND' }
						},
						chargeable_days: 1,
						reason: null
					}
				]
			);

			const february = await invokePreviewLeave(session, {
				employment_id: EMPLOYMENT_ID,
				leave_type_id: ANNUAL_LEAVE_TYPE_ID,
				calendar_month: FEBRUARY_2026,
				range: {
					start: { date: '2026-02-15', half: 'FIRST' },
					end: { date: '2026-02-15', half: 'SECOND' }
				}
			});
			assert.equal(typeof february.remaining_days, 'number');
			assert.ok(Number(february.remaining_days) > 0);
		} finally {
			await session.stop();
		}
	}
);
