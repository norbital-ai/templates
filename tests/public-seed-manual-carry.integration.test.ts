import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAccepted } from '@norbital-ai/test-utilities';
import {
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { createLeave, leaveBalances } from './helpers/public-leave.ts';

const source = { start: '2025-01-01', end: '2025-12-31' };
const destination = { start: '2026-01-01', end: '2026-12-31' };

test(
	'manual carry consumes the source year once and a reversal restores the original expiring credit',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-manual-carry');
		try {
			const balance = async (asOf: string) =>
				(await leaveBalances(session, EMPLOYMENT_ID, asOf)).find((row) => row.code === 'ANNUAL');
			assert.equal((await balance('2025-12-31'))?.balance, 8);
			assert.equal(
				(await balance('2026-01-01'))?.balance,
				8,
				'no automatic carry or encashment at the year boundary'
			);
			const carryId = crypto.randomUUID();
			requireAccepted(
				(
					await createLeave(session, {
						id: carryId,
						reference: 'CARRY-AUTHORIZATION',
						event: {
							kind: 'CARRY_FORWARD',
							source_window: source,
							destination_window: destination,
							days: 3,
							available_from: '2026-01-01',
							expires_on: '2026-03-31',
							effective_on: '2026-01-01',
							reason: 'Approved transfer'
						}
					})
				).value,
				'manual carry'
			);
			assert.equal((await balance('2025-12-31'))?.balance, 5);
			assert.equal((await balance('2026-01-01'))?.balance, 11);
			const cashId = crypto.randomUUID();
			requireAccepted(
				(
					await createLeave(session, {
						id: cashId,
						reference: 'YEAR-END-AGREEMENT',
						event: {
							kind: 'ENCASHMENT',
							source_window: source,
							days: 2,
							gross_amount: { value: 200, currency: 'MYR' },
							rate: 100,
							effective_on: '2026-01-01',
							due_on: '2026-01-15',
							reason: 'Entered settlement agreement'
						}
					})
				).value,
				'manual encashment'
			);
			assert.equal(
				(await balance('2025-12-31'))?.balance,
				3,
				'cash and carry share the original available days'
			);
			const timeOffId = crypto.randomUUID();
			requireAccepted(
				(
					await createLeave(session, {
						id: timeOffId,
						reference: 'JANUARY-DAY',
						event: {
							kind: 'TIME_OFF',
							range: {
								start: { date: '2026-01-05', half: 'FIRST' },
								end: { date: '2026-01-05', half: 'SECOND' }
							},
							chargeable_days: null,
							reason: 'Planned absence'
						}
					})
				).value,
				'use carried credit'
			);
			const [used] = await session.query('select allocations from leave_entries where id = $1', [
				timeOffId
			]);
			assert.equal(used.allocations[0].credit_entry_id, carryId);
			assert.equal((await balance('2026-04-01'))?.expired, 2);
			const reversalId = crypto.randomUUID();
			requireAccepted(
				(
					await createLeave(session, {
						id: reversalId,
						reference: 'REVERSE-JANUARY-DAY',
						event: {
							kind: 'REVERSAL',
							entry_id: timeOffId,
							effective_on: '2026-04-02',
							due_on: null,
							days: null,
							gross_amount: null,
							reason: 'Absence cancelled'
						}
					})
				).value,
				'reverse time off'
			);
			const [reversed] = await session.query(
				'select allocations from leave_entries where id = $1',
				[reversalId]
			);
			assert.deepEqual(
				reversed.allocations,
				used.allocations.map((row: { days: number }) => ({ ...row, days: -row.days }))
			);
			assert.equal(
				(await balance('2026-04-02'))?.expired,
				3,
				'a reversal preserves expiry rather than minting current credit'
			);
			assert.equal(
				(await balance('2026-04-02'))?.available,
				7,
				'the seeded later annual day remains reserved'
			);
			const duplicate = await createLeave(session, {
				id: crypto.randomUUID(),
				reference: 'SECOND-REVERSAL',
				event: {
					kind: 'REVERSAL',
					entry_id: timeOffId,
					effective_on: '2026-04-03',
					due_on: null,
					days: null,
					gross_amount: null,
					reason: 'Duplicate'
				}
			});
			assert.match(JSON.stringify(duplicate.value), /already reversed/);
			assert.equal(
				(
					await session.query(
						"select id from leave_entries where event ->> 'kind' = 'CARRY_FORWARD'"
					)
				).length,
				1
			);
		} finally {
			await session.stop();
		}
	}
);
