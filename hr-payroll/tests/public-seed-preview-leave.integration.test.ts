import test from 'node:test';
import assert from 'node:assert/strict';
import { asRecord, bearerHeaders, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	ANNUAL_LEAVE_REQUEST_ID,
	ANNUAL_LEAVE_TYPE_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

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

const asAvailability = (
	value: unknown
): Readonly<Record<string, { readonly eligible?: unknown; readonly reason_code?: unknown }>> => {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
	return value as Readonly<
		Record<string, { readonly eligible?: unknown; readonly reason_code?: unknown }>
	>;
};

const asIssues = (value: unknown): ReadonlyArray<{ readonly code?: unknown }> => {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is { readonly code?: unknown } => typeof row === 'object' && row !== null
	);
};

/**
 * The public seed already holds one April 2026 annual day. Preview must derive remaining days,
 * Sunday rest, and that booked Thursday from the same gather the write hook uses — before apply.
 */
test(
	'public seed preview_leave shows remaining days and schedule before apply',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-preview-leave');
		try {
			const browsing = await invokePreviewLeave(session, {
				employment_id: EMPLOYMENT_ID,
				leave_type_id: ANNUAL_LEAVE_TYPE_ID,
				calendar_month: '2026-04'
			});
			const availability = asAvailability(browsing.availability);
			assert.equal(availability['2026-04-12']?.reason_code, 'REST_OR_OFF');
			assert.equal(availability['2026-04-16']?.reason_code, 'OTHER_LEAVE');
			assert.equal(typeof browsing.remaining_days, 'number');
			assert.ok(
				Number(browsing.remaining_days) > 0,
				`expected remaining days > 0, got ${JSON.stringify(browsing.remaining_days)}`
			);
			assert.equal(browsing.encashed, false);

			const applyable = await invokePreviewLeave(session, {
				employment_id: EMPLOYMENT_ID,
				leave_type_id: ANNUAL_LEAVE_TYPE_ID,
				calendar_month: '2026-04',
				exclude_request_id: ANNUAL_LEAVE_REQUEST_ID,
				range: {
					start: { date: '2026-04-15', half: 'FIRST' },
					end: { date: '2026-04-15', half: 'SECOND' }
				}
			});
			assert.equal(applyable.chargeable_days, 1);
			assert.deepEqual(asIssues(applyable.issues), []);
			assert.equal(asAvailability(applyable.availability)['2026-04-15']?.eligible, true);

			const sundayOnly = await invokePreviewLeave(session, {
				employment_id: EMPLOYMENT_ID,
				leave_type_id: ANNUAL_LEAVE_TYPE_ID,
				calendar_month: '2026-04',
				range: {
					start: { date: '2026-04-12', half: 'FIRST' },
					end: { date: '2026-04-12', half: 'SECOND' }
				}
			});
			assert.equal(sundayOnly.chargeable_days, 0);
			assert.ok(
				asIssues(sundayOnly.issues).some((row) => row.code === 'NO_CHARGEABLE_DAYS'),
				`expected NO_CHARGEABLE_DAYS, got ${JSON.stringify(sundayOnly.issues)}`
			);

			const hqHeaders = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HQ Payroll HR'
			};
			const previewed = await postGuestCommand(
				session.host.baseUrl,
				'access.impersonation',
				{},
				hqHeaders
			);
			assert.ok(
				previewed.status >= 200 && previewed.status < 300,
				`access.impersonation ${previewed.status}: ${JSON.stringify(previewed.value)}`
			);
			const hqSeptember = await postGuestCommand(
				session.host.baseUrl,
				'invoke.preview_leave',
				{
					input: {
						employment_id: EMPLOYMENT_ID,
						leave_type_id: ANNUAL_LEAVE_TYPE_ID,
						calendar_month: '2026-09',
						range: {
							start: { date: '2026-09-04', half: 'FIRST' },
							end: { date: '2026-09-04', half: 'SECOND' }
						}
					}
				},
				hqHeaders
			);
			assert.ok(
				hqSeptember.status >= 200 && hqSeptember.status < 300,
				`HQ preview_leave September ${hqSeptember.status}: ${JSON.stringify(hqSeptember.value)}`
			);
		} finally {
			await session.stop();
		}
	}
);
