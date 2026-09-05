import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	commandSentence,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../src/lib/ui/calendar.ts';
import {
	ANNUAL_LEAVE_ACCOUNT_ID,
	ANNUAL_LEAVE_TYPE_ID,
	COMPANY_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	MARCH_2026,
	SHIFT_OFF_ID,
	SHIFT_REST_ID,
	SHIFT_WORK_ID,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const MUTATE_COMMAND = 'collections.mutate';
/** The public seed's TRANSPORT component, the one a claim is filed against. */
const TRANSPORT_COMPONENT_ID = '77777777-7777-4777-8777-777777777777';

const SATURDAY = '2026-03-07';
const SUNDAY = '2026-03-08';
const QUIET_SUNDAY = '2026-03-15';
const MONDAY = '2026-03-09';
const TUESDAY = '2026-03-10';
const HOLIDAY_TUESDAY = '2026-03-17';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;

const teamHeaders = (session: Session, team: string) => ({
	...bearerHeaders(session.credential),
	'x-colony-impersonated-team': team
});

const create = async (
	session: Session,
	collection: string,
	values: Readonly<Record<string, unknown>>,
	headers: Readonly<Record<string, string>>
) => {
	const response = await postGuestCommand(
		session.host.baseUrl,
		MUTATE_COMMAND,
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection,
			rows: [{ action: 'create', values }]
		}),
		headers
	);
	assert.ok(
		response.status >= 200 && response.status < 300,
		`${collection} create returned ${response.status}: ${JSON.stringify(response.value)}`
	);
	return asRecord(response.value, `${collection} create`);
};

const rowCount = async (session: Session, sql: string, parameters: ReadonlyArray<unknown>) => {
	const rows = (await session.query(sql, parameters)) as ReadonlyArray<{ readonly n: number }>;
	return rows[0]?.n ?? 0;
};

const payrollDay = (value: unknown): string =>
	calendarDateInTimeZone(new Date(String(value)), PAYROLL_TIME_ZONE);

const fileTimeOff = (
	session: Session,
	id: string,
	date: string,
	headers: Readonly<Record<string, string>>
) =>
	postGuestCommand(
		session.host.baseUrl,
		MUTATE_COMMAND,
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection: 'leave_requests',
			rows: [
				{
					action: 'create',
					values: {
						id,
						employment_id: EMPLOYMENT_ID,
						leave_type_id: ANNUAL_LEAVE_TYPE_ID,
						leave_account_id: ANNUAL_LEAVE_ACCOUNT_ID,
						event: {
							kind: 'TIME_OFF',
							range: {
								start: { date, half: 'FIRST' },
								end: { date, half: 'SECOND' }
							},
							chargeable_days: null,
							reason: 'Lane D chained absence'
						}
					}
				}
			]
		}),
		headers
	);

const updateTwo = async (
	session: Session,
	collection: string,
	rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
	headers: Readonly<Record<string, string>>,
	label: string
) => {
	const ids = rows.map((row) => row.id as string);
	const found = (await session.query(
		`select id, row_version from ${collection} where id = any($1)`,
		[ids]
	)) as ReadonlyArray<{ readonly id: string; readonly row_version: number }>;
	const versionById = new Map(found.map((row) => [row.id, row.row_version]));
	const response = await postGuestCommand(
		session.host.baseUrl,
		MUTATE_COMMAND,
		mutationPush(
			session.schemaFingerprint,
			{
				action: 'mutate',
				collection,
				rows: rows.map((values) => ({ action: 'update', values }))
			},
			ids.map((id) => ({
				row: { collection, recordId: id },
				rowVersion: versionById.get(id)
			}))
		),
		headers
	);
	assert.ok(
		response.status >= 200 && response.status < 300,
		`${label} returned ${response.status}: ${JSON.stringify(response.value)}`
	);
	requireAccepted(response.value, label);
};

const refuseUpdate = async (
	session: Session,
	collection: string,
	id: string,
	values: Readonly<Record<string, unknown>>,
	headers: Readonly<Record<string, string>>,
	label: string
) => {
	const versions = (await session.query(`select row_version from ${collection} where id = $1`, [
		id
	])) as ReadonlyArray<{ readonly row_version: number }>;
	const response = await postGuestCommand(
		session.host.baseUrl,
		MUTATE_COMMAND,
		mutationPush(
			session.schemaFingerprint,
			{ action: 'mutate', collection, rows: [{ action: 'update', values: { id, ...values } }] },
			[
				{
					row: { collection, recordId: id },
					rowVersion: versions[0]?.row_version
				}
			]
		),
		headers
	);
	assert.equal(
		asRecord(response.value, label).resolution,
		'rejected',
		`${label} must refuse, got ${response.status}: ${JSON.stringify(response.value)}`
	);
	return commandSentence(response);
};

/**
 * Lane D, one chained run on a real host: March takes explicit Sat/Sun/Mon plans matching the
 * pattern, refuses a single-cell Sat→OFF write with the pattern's count, then takes the Mon
 * WORK↔Sun OFF swap in one mutation; leave filed on a rest day, on the swapped-off Monday, and
 * on a holiday is refused while the same Tuesday filed twice is refused as an overlap; a CLAIM
 * entry lands directly and an approved Tuesday leave lands through review; the March run captures
 * both as inputs with the claim priced onto a named TRANSPORT line; deleting the draft run
 * unlinks both captures and deletes neither source.
 *
 * There is no draft roster and no publication: a roster row is an override, and the single-cell
 * refusal is the write-time conformance sentence (`work_days/+hooks.ts`), asserted loosely — the
 * pattern wording plus a count. The public catalogue is sealed with no UNPAID/ABSENCE component,
 * so the Tuesday absence charges exactly one leave day (`chargeable_days = 1`) rather than
 * pricing a monetary deduction line; the component-code line naming is proven on the claim's
 * TRANSPORT adjustment.
 */
test(
	'a claim and an approved leave survive the run deletion that unlinks them, with the roster swap and leave no-ops held',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS * 2 },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-claim-leave-unlink');
		try {
			const founder = bearerHeaders(session.credential);
			const manager = teamHeaders(session, 'HR Manager');
			const controller = teamHeaders(session, 'HQ Payroll HR');

			// 1. March takes explicit plans matching the pattern: Sat WORK, Sun REST, Mon/Tue WORK.
			// A roster row is an override, so pattern-matching rows pass write-time conformance.
			const planned = await postGuestCommand(
				session.host.baseUrl,
				MUTATE_COMMAND,
				mutationPush(session.schemaFingerprint, {
					action: 'mutate',
					collection: 'work_days',
					rows: [
						{
							action: 'create',
							values: {
								id: crypto.randomUUID(),
								employment_id: EMPLOYMENT_ID,
								work_date: SATURDAY,
								shift_definition_id: SHIFT_WORK_ID,
								planned_origin: 'MANUAL'
							}
						},
						{
							action: 'create',
							values: {
								id: crypto.randomUUID(),
								employment_id: EMPLOYMENT_ID,
								work_date: SUNDAY,
								shift_definition_id: SHIFT_REST_ID,
								planned_origin: 'MANUAL'
							}
						},
						{
							action: 'create',
							values: {
								id: crypto.randomUUID(),
								employment_id: EMPLOYMENT_ID,
								work_date: MONDAY,
								shift_definition_id: SHIFT_WORK_ID,
								planned_origin: 'MANUAL'
							}
						}
					]
				}),
				founder
			);
			assert.ok(
				planned.status >= 200 && planned.status < 300,
				`explicit March plans ${planned.status}: ${JSON.stringify(planned.value)}`
			);
			requireAccepted(planned.value, 'explicit March plans');
			const dayRows = (await session.query(
				'select id, work_date, shift_definition_id from work_days where employment_id = $1',
				[EMPLOYMENT_ID]
			)) as ReadonlyArray<{
				readonly id: string;
				readonly work_date: string;
				readonly shift_definition_id: string | null;
			}>;
			const dayByDate = new Map(dayRows.map((day) => [payrollDay(day.work_date), day]));
			const saturday = dayByDate.get(SATURDAY);
			const sunday = dayByDate.get(SUNDAY);
			const monday = dayByDate.get(MONDAY);
			assert.equal(saturday?.shift_definition_id, SHIFT_WORK_ID, `Saturday plan: ${SATURDAY}`);
			assert.equal(sunday?.shift_definition_id, SHIFT_REST_ID, 'Sunday is REST');
			assert.equal(monday?.shift_definition_id, SHIFT_WORK_ID, `Monday plan: ${MONDAY}`);
			assert.ok(saturday, `need the Saturday person-day ${SATURDAY}`);
			assert.ok(sunday, `need the Sunday person-day ${SUNDAY}`);
			assert.ok(monday, `need the Monday person-day ${MONDAY}`);

			// 2. A single cell moved off pattern is refused at write time, with the pattern's count.
			const refusal = await refuseUpdate(
				session,
				'work_days',
				saturday.id,
				{ shift_definition_id: SHIFT_OFF_ID },
				founder,
				'Saturday single-cell to OFF'
			);
			// Lane C owns this sentence; hold the shape (pattern wording plus a count), not the
			// syllables.
			assert.match(refusal, /work pattern/i, refusal);
			assert.match(refusal, /\d/, `a count must be named: ${refusal}`);

			// 3. The pair moved together in one mutation keeps the pattern's counts, so it lands:
			// Monday WORK becomes OFF while Sunday REST becomes WORK on Monday's code.
			await updateTwo(
				session,
				'work_days',
				[
					{ id: monday.id, shift_definition_id: SHIFT_OFF_ID },
					{ id: sunday.id, shift_definition_id: SHIFT_WORK_ID }
				],
				founder,
				'Sunday↔Monday swap in one mutation'
			);

			// 4. Leave on a rest day, on the swapped-off Monday, and on a holiday is no leave at
			// all. (The swapped Sunday carries Monday's WORK code now, so the rest-day case moves a
			// week on, to a Sunday nobody touched.)
			await create(
				session,
				'company_holidays',
				{
					id: crypto.randomUUID(),
					company_id: COMPANY_ID,
					date: HOLIDAY_TUESDAY,
					name: 'Lane D fixture holiday',
					scope: { kind: 'NATIONAL' }
				},
				founder
			);
			for (const date of [QUIET_SUNDAY, MONDAY, HOLIDAY_TUESDAY]) {
				const noOp = await fileTimeOff(session, crypto.randomUUID(), date, controller);
				assert.equal(
					asRecord(noOp.value, `leave on ${date}`).resolution,
					'rejected',
					`leave on ${date} must refuse, got ${noOp.status}: ${JSON.stringify(noOp.value)}`
				);
				assert.match(
					commandSentence(noOp),
					/no eligible scheduled work time/i,
					`leave on ${date} is a no-op: ${JSON.stringify(noOp.value)}`
				);
			}

			// 5. The Tuesday absence: filed, held, approved, stored — charging exactly one day.
			const leaveId = crypto.randomUUID();
			const applied = await fileTimeOff(session, leaveId, TUESDAY, controller);
			assert.ok(
				applied.status >= 200 && applied.status < 300,
				`leave file ${applied.status}: ${JSON.stringify(applied.value)}`
			);
			const pending = asRecord(
				asRecord(applied.value, 'leave file').pendingApproval,
				'leave pendingApproval'
			);
			const requestId = String(pending.requestId);
			const status = await postGuestCommand(
				session.host.baseUrl,
				'approvals.status',
				{ requestId },
				manager
			);
			const state = asRecord(status.value, 'leave approval status');
			assert.equal(state._tag, 'Pending', JSON.stringify(status.value));
			const decided = await postGuestCommand(
				session.host.baseUrl,
				'approvals.decide',
				{ state, decision: 'approve' },
				manager
			);
			assert.equal(
				asRecord(decided.value, 'leave decide')._tag,
				'Approved',
				JSON.stringify(decided.value)
			);
			if (
				(await rowCount(session, 'select count(*)::int as n from leave_requests where id = $1', [
					leaveId
				])) === 0
			) {
				const resumed = await postGuestCommand(
					session.host.baseUrl,
					'collections.resume',
					{ requestId },
					manager
				);
				assert.ok(
					(resumed.status >= 200 && resumed.status < 300) ||
						(resumed.status === 422 &&
							JSON.stringify(resumed.value).includes('identity is already in use')),
					`collections.resume ${resumed.status}: ${JSON.stringify(resumed.value)}`
				);
			}
			const charged = (await session.query('select days from leave_requests where id = $1', [
				leaveId
			])) as ReadonlyArray<{ readonly days: string | number }>;
			assert.equal(Number(charged[0]?.days), 1, 'the Tuesday absence charges one day');

			// 6. The same Tuesday twice is an overlap, not a second day.
			const overlap = await fileTimeOff(session, crypto.randomUUID(), TUESDAY, controller);
			assert.equal(
				asRecord(overlap.value, 'overlapping leave').resolution,
				'rejected',
				`overlapping leave must refuse, got ${overlap.status}: ${JSON.stringify(overlap.value)}`
			);
			assert.match(
				commandSentence(overlap),
				/overlaps another leave request/i,
				JSON.stringify(overlap.value)
			);

			// 7. A claim is one write, landed directly — no approval, no second step.
			const claimId = crypto.randomUUID();
			const claim = await create(
				session,
				'component_entries',
				{
					id: claimId,
					employment_id: EMPLOYMENT_ID,
					pay_component_id: TRANSPORT_COMPONENT_ID,
					amount: 42,
					event_date: '2026-03-05',
					event: { kind: 'CLAIM', incurred_on: '2026-03-05', description: 'Client site taxi' }
				},
				manager
			);
			assert.equal(claim.resolution, 'accepted', JSON.stringify(claim));
			assert.equal(
				claim.pendingApproval,
				undefined,
				`a claim must not wait: ${JSON.stringify(claim)}`
			);

			// 8. The March run captures both as inputs, pricing the claim onto a named line.
			const runId = crypto.randomUUID();
			const run = await create(
				session,
				'payroll_runs',
				{ id: runId, company_id: COMPANY_ID, period: MARCH_2026 },
				manager
			);
			requireAccepted(run, 'payroll run create');
			assert.equal(run.pendingApproval, undefined, `manager runs land: ${JSON.stringify(run)}`);
			const captureSql = (junction: string, column: string) =>
				`select count(*)::int as n from ${junction} i
				 join payslips p on p.id = i.payslip_id
				 where p.payroll_run_id = $1 and i.${column} = $2`;
			assert.equal(
				await rowCount(
					session,
					captureSql('payslip_component_entry_inputs', 'component_entry_id'),
					[runId, claimId]
				),
				1,
				'the claim must be captured as an input of the March run'
			);
			assert.equal(
				await rowCount(session, captureSql('payslip_leave_request_inputs', 'leave_request_id'), [
					runId,
					leaveId
				]),
				1,
				'the approved leave must be captured as an input of the March run'
			);
			const payslips = (await session.query(
				'select id from payslips where payroll_run_id = $1 and employment_id = $2',
				[runId, EMPLOYMENT_ID]
			)) as ReadonlyArray<{ readonly id: string }>;
			assert.equal(payslips.length, 1, `one March payslip: ${JSON.stringify(payslips)}`);
			const lines = (await session.query(
				'select label, amount, bucket from payslip_adjustments where payslip_id = $1',
				[payslips[0]?.id]
			)) as ReadonlyArray<{
				readonly label: string;
				readonly amount: string | number;
				readonly bucket: string;
			}>;
			assert.ok(
				lines.every((line) => line.label.length > 0),
				`every adjustment names its component or rule: ${JSON.stringify(lines)}`
			);
			assert.ok(
				lines.some((line) => line.label === 'TRANSPORT' && Number(line.amount) === 42),
				`the claim must price a TRANSPORT 42 line: ${JSON.stringify(lines)}`
			);

			// 9. Deleting the draft run releases both captures and deletes neither source.
			const versions = (await session.query('select row_version from payroll_runs where id = $1', [
				runId
			])) as ReadonlyArray<{ readonly row_version: number }>;
			const deleted = await postGuestCommand(
				session.host.baseUrl,
				MUTATE_COMMAND,
				mutationPush(
					session.schemaFingerprint,
					{ action: 'delete', collection: 'payroll_runs', ids: [runId] },
					[
						{
							row: { collection: 'payroll_runs', recordId: runId },
							rowVersion: versions[0]?.row_version
						}
					]
				),
				manager
			);
			requireAccepted(deleted.value, 'payroll run delete');
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from payroll_runs where id = $1', [
					runId
				]),
				0
			);
			assert.equal(
				await rowCount(
					session,
					'select count(*)::int as n from payslip_component_entry_inputs where component_entry_id = $1',
					[claimId]
				),
				0,
				'the claim capture must be unlinked'
			);
			assert.equal(
				await rowCount(
					session,
					'select count(*)::int as n from payslip_leave_request_inputs where leave_request_id = $1',
					[leaveId]
				),
				0,
				'the leave capture must be unlinked'
			);
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from component_entries where id = $1', [
					claimId
				]),
				1,
				'deleting the run must not delete the claim'
			);
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from leave_requests where id = $1', [
					leaveId
				]),
				1,
				'deleting the run must not delete the leave request'
			);
		} finally {
			await session.stop();
		}
	}
);
