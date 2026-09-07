import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand
} from '@norbital-ai/test-utilities';
import {
	ANNUAL_LEAVE_ENTITLEMENT_ID,
	ANNUAL_LEAVE_TYPE_ID,
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	HOSPITALIZATION_LEAVE_ENTITLEMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	publicSeedDirectory,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { leaveEntitlementIdFor } from '../src/lib/leave/entitlements.ts';
import { roundHalfDay } from '../src/collections/payroll_runs/lib/rounding.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;

const teamHeaders = (session: Session, team: string) => ({
	...bearerHeaders(session.credential),
	'x-colony-impersonated-team': team
});

const seedRows = (name: string): ReadonlyArray<Row> =>
	JSON.parse(readFileSync(new URL(`${name}.json`, `file://${publicSeedDirectory}`), 'utf8'));

const refresh = async (session: Session) => {
	const started = await postGuestCommand(
		session.host.baseUrl,
		'automations.start',
		{ name: 'leave_ledger_refresh', input: { company_id: COMPANY_ID } },
		bearerHeaders(session.credential)
	);
	assert.ok(started.status < 300, JSON.stringify(started.value));
};

const balance = async (session: Session, entitlementId: string): Promise<number> => {
	const rows = (await session.query(
		`select coalesce(sum(days), 0)::text as balance from leave_entries
		 where leave_entitlement_id = $1 and effective_on <= now()`,
		[entitlementId]
	)) as ReadonlyArray<{ readonly balance: string }>;
	return Number(rows[0]?.balance ?? 0);
};

const postAdjustment = (
	session: Session,
	headers: Readonly<Record<string, string>>,
	reference: string
) =>
	postGuestCommand(
		session.host.baseUrl,
		'collections.mutate',
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection: 'leave_entries',
			rows: [
				{
					action: 'create',
					values: {
						id: crypto.randomUUID(),
						leave_entitlement_id: ANNUAL_LEAVE_ENTITLEMENT_ID,
						kind: 'MANUAL_ADJUSTMENT',
						effective_on: '2026-09-01',
						days: -2,
						reason: 'Two days taken before the ledger existed',
						source_key: reference
					}
				}
			]
		}),
		headers
	);

/** Month ends of 2026 on or before today: how many MONTHLY lines the reconciler has posted. */
const monthEndsElapsed = (): number => {
	const today = new Date().toISOString().slice(0, 10);
	let count = 0;
	for (let month = 1; month <= 12; month += 1) {
		const end = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
		if (end <= today) count += 1;
	}
	return count;
};

/**
 * HR12, HR13 and HR19(a) on the public seed.
 *
 * The catalogue is the mechanism: every eligible employment gets one entitlement per type per
 * leave year, nobody gets a row for a type that excludes them, a statutory row cites its law, and
 * the balances are the numbers the old model produced (ANNUAL 7 after the seeded day, HOSPITALIZATION
 * 60). A band raised by two posts exactly one ADJUSTMENT per open entitlement, keyed by the row's
 * updated_at, however often the reconciler runs. A manual adjustment is held for the HR manager and
 * moves the balance once approved; the same reference cannot be posted twice; an employee cannot post one.
 */
test(
	'public seed leave catalogue generates entitlements, settles a band change once and holds manual adjustments',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS * 2 },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-leave-catalogue');
		try {
			// HR12: rows = eligible employments × types × the leave years each employment overlaps.
			const employments = seedRows('employments');
			const types = seedRows('leave_types');
			const currentYear = new Date().getUTCFullYear();
			const overlapping = (hire: string) =>
				[currentYear - 1, currentYear, currentYear + 1].filter((year) => hire <= `${year}-12-31`)
					.length;
			const expectedRows = employments.reduce(
				(total, row) => total + overlapping(String(row.hire_date)) * types.length,
				0
			);
			const rows = (await session.query(
				`select e.employee_number, t.leave_code, t.leave_year, t.entitlement_days, t.status
				 from leave_entitlements t join employments e on e.id = t.employment_id order by 1, 2, 3`
			)) as ReadonlyArray<Row>;
			assert.equal(rows.length, expectedRows, JSON.stringify(rows));
			assert.ok(
				types.every((type) => type.is_statutory === true && String(type.authority ?? '') !== ''),
				'every public type is statutory and cites its authority'
			);
			const catalogue = (await session.query(
				`select code, is_statutory, authority from leave_types where settings_id = $1 order by code`,
				[JURISDICTION_ID]
			)) as ReadonlyArray<Row>;
			assert.deepEqual(
				catalogue.map((row) => [row.code, row.is_statutory, String(row.authority ?? '') !== '']),
				[
					['ANNUAL', true, true],
					['HOSPITALIZATION', true, true]
				]
			);
			assert.equal(
				await balance(session, ANNUAL_LEAVE_ENTITLEMENT_ID),
				7,
				'ANNUAL: 8 less the seeded day'
			);
			assert.equal(await balance(session, HOSPITALIZATION_LEAVE_ENTITLEMENT_ID), 60);

			// HR12: a type that excludes someone generates nothing for them.
			const maternityId = crypto.randomUUID();
			await session.query(
				`insert into leave_types (id, settings_id, code, name, is_statutory, authority, eligibility, entitlement, accrual, exit_settlement, payroll_effect)
				 values ($1, $2, 'MATERNITY', 'Maternity leave', true, 'Public fixture s.37', 'employee.gender == "FEMALE" && employment.service_months >= 3', $3, $4, $5, $6)`,
				[
					maternityId,
					JURISDICTION_ID,
					{ layers: [{ level: 'ORGANISATION', band_from: 0, days: 98 }] },
					{ kind: 'UPFRONT', settlement: { settlement: 'FORFEIT' } },
					{ exit: 'FORFEIT' },
					{ kind: 'PAID' }
				]
			);
			await refresh(session);
			const maternity = (await session.query(
				`select p.gender, t.leave_year from leave_entitlements t
				 join employments e on e.id = t.employment_id join employees p on p.id = e.employee_id
				 where t.leave_type_id = $1`,
				[maternityId]
			)) as ReadonlyArray<Row>;
			const women = seedRows('employees').filter((row) => row.gender === 'FEMALE');
			assert.ok(maternity.length > 0 && maternity.every((row) => row.gender === 'FEMALE'));
			assert.equal(
				new Set(maternity.map((row) => row.leave_year)).size,
				3,
				'three leave years for the eligible women'
			);
			assert.equal(women.length, 2, 'the fixture has two women');

			// HR13: raise the ANNUAL band by two; one ADJUSTMENT of +2 per open entitlement, once.
			await session.query(
				`update leave_types set entitlement = $1, updated_at = now() where id = $2`,
				[{ layers: [{ level: 'ORGANISATION', band_from: 0, days: 10 }] }, ANNUAL_LEAVE_TYPE_ID]
			);
			const [{ updated_at: updatedAt }] = (await session.query(
				`select updated_at from leave_types where id = $1`,
				[ANNUAL_LEAVE_TYPE_ID]
			)) as ReadonlyArray<{ readonly updated_at: string }>;
			await refresh(session);
			await refresh(session);
			const adjustments = (await session.query(
				`select n.leave_entitlement_id, n.days::text as days, n.source_key, t.leave_year, t.status
				 from leave_entries n join leave_entitlements t on t.id = n.leave_entitlement_id
				 where n.kind = 'ADJUSTMENT' and t.leave_code = 'ANNUAL' order by t.leave_year`,
				[]
			)) as ReadonlyArray<Row>;
			const openThisYear = rows.filter(
				(row) =>
					row.leave_code === 'ANNUAL' && row.leave_year === currentYear && row.status === 'OPEN'
			);
			assert.equal(
				adjustments.length,
				openThisYear.length,
				`one line per open entitlement, after two runs: ${JSON.stringify(adjustments)}`
			);
			assert.ok(
				adjustments.every((row) => Number(row.days) === 2),
				JSON.stringify(adjustments)
			);
			assert.ok(
				adjustments.every((row) => row.source_key === `adjust:${String(updatedAt)}`),
				`keyed by the type's updated_at ${String(updatedAt)}: ${JSON.stringify(adjustments)}`
			);
			assert.equal(await balance(session, ANNUAL_LEAVE_ENTITLEMENT_ID), 9);

			// HR13, MONTHLY: the months already accrued are adjusted; the lines posted stay as they were.
			const monthlyId = crypto.randomUUID();
			await session.query(
				`insert into leave_types (id, settings_id, code, name, is_statutory, authority, eligibility, entitlement, accrual, exit_settlement, payroll_effect)
				 values ($1, $2, 'MONTHLY', 'Monthly leave', false, null, '', $3, $4, $5, $6)`,
				[
					monthlyId,
					JURISDICTION_ID,
					{ layers: [{ level: 'ORGANISATION', band_from: 0, days: 12 }] },
					{ kind: 'MONTHLY', settlement: { settlement: 'FORFEIT' } },
					{ exit: 'FORFEIT' },
					{ kind: 'PAID' }
				]
			);
			await refresh(session);
			const monthlyEntitlement = leaveEntitlementIdFor({
				employment_id: EMPLOYMENT_ID,
				leave_code: 'MONTHLY',
				leave_year: currentYear
			});
			const elapsed = monthEndsElapsed();
			const before = (await session.query(
				`select kind, days::text as days, source_key from leave_entries where leave_entitlement_id = $1 order by effective_on`,
				[monthlyEntitlement]
			)) as ReadonlyArray<Row>;
			assert.equal(
				before.length,
				elapsed,
				`one accrual per month end elapsed: ${JSON.stringify(before)}`
			);
			await session.query(
				`update leave_types set entitlement = $1, updated_at = now() where id = $2`,
				[{ layers: [{ level: 'ORGANISATION', band_from: 0, days: 14 }] }, monthlyId]
			);
			await refresh(session);
			await refresh(session);
			const after = (await session.query(
				`select kind, days::text as days, source_key from leave_entries where leave_entitlement_id = $1 order by effective_on, kind`,
				[monthlyEntitlement]
			)) as ReadonlyArray<Row>;
			assert.deepEqual(
				after.filter((row) => row.kind === 'ACCRUAL').map((row) => [row.days, row.source_key]),
				before.map((row) => [row.days, row.source_key]),
				'the accrual lines already posted are untouched'
			);
			const monthlyAdjustments = after.filter((row) => row.kind === 'ADJUSTMENT');
			assert.equal(monthlyAdjustments.length, 1, JSON.stringify(after));
			assert.equal(
				Number(monthlyAdjustments[0]?.days),
				roundHalfDay((14 * elapsed) / 12) - roundHalfDay((12 * elapsed) / 12),
				'the delta covers the months already accrued at the new band'
			);

			// HR19(a): a controller's manual adjustment is held; the HR manager's approval posts it once.
			const controller = teamHeaders(session, 'HQ Payroll HR');
			const manager = teamHeaders(session, 'HR Manager');
			const reference = 'manual:ticket-19a';
			const held = await postAdjustment(session, controller, reference);
			assert.ok(held.status < 300, JSON.stringify(held.value));
			const pending = asRecord(
				asRecord(held.value, 'held adjustment').pendingApproval,
				'pendingApproval'
			);
			assert.equal(
				await balance(session, ANNUAL_LEAVE_ENTITLEMENT_ID),
				9,
				'held: the balance has not moved'
			);
			const status = await postGuestCommand(
				session.host.baseUrl,
				'approvals.status',
				{ requestId: String(pending.requestId) },
				manager
			);
			const state = asRecord(status.value, 'approval status');
			assert.equal(state._tag, 'Pending', JSON.stringify(status.value));
			const decided = await postGuestCommand(
				session.host.baseUrl,
				'approvals.decide',
				{ state, decision: 'approve' },
				manager
			);
			assert.equal(
				asRecord(decided.value, 'decide')._tag,
				'Approved',
				JSON.stringify(decided.value)
			);
			if (
				(await session.query(`select id from leave_entries where source_key = $1`, [reference]))
					.length === 0
			) {
				const resumed = await postGuestCommand(
					session.host.baseUrl,
					'collections.resume',
					{ requestId: String(pending.requestId) },
					manager
				);
				// The approval may already have landed the row; a resume then reports the identity taken.
				assert.ok(
					resumed.status < 300 ||
						(resumed.status === 422 &&
							JSON.stringify(resumed.value).includes('identity is already in use')),
					JSON.stringify(resumed.value)
				);
			}
			const posted = await session.query(
				`select kind, days::text as days from leave_entries where leave_entitlement_id = $1 and source_key = $2`,
				[ANNUAL_LEAVE_ENTITLEMENT_ID, reference]
			);
			assert.equal(posted.length, 1, JSON.stringify(posted));
			assert.equal(
				await balance(session, ANNUAL_LEAVE_ENTITLEMENT_ID),
				7,
				'approved: the balance dropped by two'
			);
			const duplicate = await postAdjustment(session, controller, reference);
			assert.ok(
				duplicate.status >= 400 ||
					JSON.stringify(duplicate.value).match(/rejected|duplicate|unique|already/i),
				`the same reference is refused: ${duplicate.status} ${JSON.stringify(duplicate.value)}`
			);
			const employee = await postAdjustment(
				session,
				teamHeaders(session, 'Employee'),
				'manual:ticket-19b'
			);
			assert.ok(
				employee.status >= 400 ||
					JSON.stringify(employee.value).match(/rejected|denied|not allowed|policy/i),
				`an employee cannot post one: ${employee.status} ${JSON.stringify(employee.value)}`
			);
			assert.equal(await balance(session, ANNUAL_LEAVE_ENTITLEMENT_ID), 7);
		} finally {
			await session.stop();
		}
	}
);
