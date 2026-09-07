import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerHeaders, mutationPush, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * National service leave, end to end on the seeded catalogue: unmetered, and gated on evidence.
 *
 * The owner's sentence was "just make it unlimited for men in Singapore — it needs evidence anyway
 * to take", and both halves of that are what this proves against the row the seed actually ships,
 * rather than against a catalogue row a test constructed. The pair of employments is the whole
 * argument: PUB-EMP-0002 is a male citizen and PUB-EMP-0004 is a male foreigner, so gender alone
 * cannot explain the difference between them.
 */
const LIABLE_EMPLOYMENT = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const FOREIGN_EMPLOYMENT = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;

const preview = async (session: Session, input: Readonly<Record<string, unknown>>) => {
	const response = await postGuestCommand(
		session.host.baseUrl,
		'invoke.preview_leave',
		{ input },
		bearerHeaders(session.credential)
	);
	assert.ok(
		response.status >= 200 && response.status < 300,
		`preview_leave ${response.status}: ${JSON.stringify(response.value)}`
	);
	return response.value as Readonly<Record<string, unknown>>;
};

test(
	'a call-up is unmetered and needs its evidence; a foreigner has no account to file against',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-ns-leave');
		try {
			const accounts = (await session.query(
				`select e.employee_number, t.leave_year, t.entitlement_days::text as days, t.accrual_kind
				 from leave_entitlements t join employments e on e.id = t.employment_id
				 where t.leave_code = 'NS' order by 1, 2`
			)) as ReadonlyArray<Record<string, unknown>>;
			assert.deepEqual(
				accounts.map((row) => row.employee_number),
				['PUB-EMP-0002', 'PUB-EMP-0002'],
				`only the male citizen holds one: ${JSON.stringify(accounts)}`
			);
			assert.ok(
				accounts.every((row) => row.accrual_kind === 'UNLIMITED' && Number(row.days) === 0),
				'unmetered, with no balance to award'
			);

			const entitlement = (await session.query(
				`select id from leave_entitlements where leave_code = 'NS' and leave_year = 2026`
			)) as ReadonlyArray<{ readonly id: string }>;
			const [ns] = (await session.query(
				`select id from leave_catalogue where code = 'NS'`
			)) as ReadonlyArray<{ readonly id: string }>;
			assert.ok(entitlement[0] && ns, 'the 2026 account and the catalogue row');

			// Ten working days of in-camp training against an account holding nothing. An annual
			// balance would call this an overdraw; an unmetered one does not have a ceiling to pass.
			const input = {
				employment_id: LIABLE_EMPLOYMENT,
				leave_catalogue_id: ns.id,
				leave_entitlement_id: entitlement[0]!.id,
				calendar_month: '2026-06',
				range: {
					start: { date: '2026-06-08', half: 'FIRST' },
					end: { date: '2026-06-19', half: 'SECOND' }
				}
			};
			const previewed = await preview(session, input);
			const issues = (previewed.issues ?? []) as ReadonlyArray<{ readonly code?: unknown }>;
			assert.equal(
				issues.some((issue) => issue.code === 'OVERDRAW'),
				false,
				`no ceiling to overdraw: ${JSON.stringify(issues)}`
			);
			assert.ok(Number(previewed.chargeable_days) > 0, JSON.stringify(previewed));
			assert.equal(
				previewed.certificate_required,
				true,
				`the call-up order is always required: ${JSON.stringify(previewed)}`
			);

			const filed = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(session.schemaFingerprint, {
					action: 'mutate',
					collection: 'leave_requests',
					rows: [
						{
							action: 'create',
							values: {
								id: crypto.randomUUID(),
								employment_id: LIABLE_EMPLOYMENT,
								leave_catalogue_id: ns.id,
								leave_entitlement_id: entitlement[0]!.id,
								event: {
									kind: 'TIME_OFF',
									range: input.range,
									chargeable_days: null,
									reason: 'In-camp training'
								}
							}
						}
					]
				}),
				bearerHeaders(session.credential)
			);
			assert.match(
				JSON.stringify(filed.value),
				/certificate/i,
				`refused without the order attached: ${filed.status} ${JSON.stringify(filed.value)}`
			);

			// And the foreigner has no account of his own to file against. Borrowing the citizen's is
			// the only way to even ask the question, and it is refused before eligibility is ever
			// consulted — which is the stronger statement: there is no NS row for him to name.
			const foreign = await postGuestCommand(
				session.host.baseUrl,
				'invoke.preview_leave',
				{ input: { ...input, employment_id: FOREIGN_EMPLOYMENT } },
				bearerHeaders(session.credential)
			);
			assert.equal(foreign.status, 422, JSON.stringify(foreign.value));
			assert.match(
				JSON.stringify(foreign.value),
				/does not belong to this employment/i,
				JSON.stringify(foreign.value)
			);
			const his = await session.query(
				`select count(*)::int as total from leave_entitlements
				 where employment_id = $1 and leave_code = 'NS'`,
				[FOREIGN_EMPLOYMENT]
			);
			assert.equal(
				(his as ReadonlyArray<{ readonly total: number }>)[0]?.total,
				0,
				'and none was generated for him'
			);
		} finally {
			await session.stop();
		}
	}
);
