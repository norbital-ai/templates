import test from 'node:test';
import assert from 'node:assert/strict';
import {
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { createLeave, leaveBalances, leavePreview } from './helpers/public-leave.ts';

const LIABLE_EMPLOYMENT = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const FOREIGN_EMPLOYMENT = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4';

test(
	'call-up Leave is unmetered with required evidence and evaluates residency on the contract terms',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-ns-leave');
		try {
			const [catalogue] = await session.query("select id from leave_catalogue where code = 'NS'");
			assert.ok(catalogue);
			const input = {
				employment_id: LIABLE_EMPLOYMENT,
				leave_catalogue_id: String(catalogue.id),
				calendar_month: '2026-06',
				range: {
					start: { date: '2026-06-08', half: 'FIRST' as const },
					end: { date: '2026-06-19', half: 'SECOND' as const }
				}
			};
			const liable = await leavePreview(session, input);
			assert.equal(liable.remaining_days, null);
			assert.ok(Number(liable.chargeable_days) > 0);
			assert.equal(liable.certificate_required, true);
			assert.deepEqual(liable.issues, []);
			const missingEvidence = await createLeave(session, {
				id: crypto.randomUUID(),
				reference: 'CALL-UP-ORDER',
				employment_id: LIABLE_EMPLOYMENT,
				leave_catalogue_id: input.leave_catalogue_id,
				event: {
					kind: 'TIME_OFF',
					range: input.range,
					chargeable_days: null,
					reason: 'In-camp training'
				}
			});
			assert.match(JSON.stringify(missingEvidence.value), /certificate/i);
			const foreign = await leavePreview(session, { ...input, employment_id: FOREIGN_EMPLOYMENT });
			assert.equal(foreign.chargeable_days, 0);
			assert.equal(foreign.availability['2026-06-08']?.reason_code, 'INELIGIBLE');
			assert.ok(foreign.issues.length > 0);
			const balances = await leaveBalances(session, FOREIGN_EMPLOYMENT, '2026-06-08');
			assert.equal(balances.find((row) => row.code === 'NS')?.available, 0);
			assert.equal(
				(
					await session.query('select id from leave_entries where employment_id = any($1)', [
						[LIABLE_EMPLOYMENT, FOREIGN_EMPLOYMENT]
					])
				).length,
				0,
				'queries and refusals create no entitlement or activity rows'
			);
		} finally {
			await session.stop();
		}
	}
);
