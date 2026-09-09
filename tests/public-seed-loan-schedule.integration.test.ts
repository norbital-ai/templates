import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * A loan's repayment schedule, refused on the real write path rather than only on the form.
 *
 * The three invariants — the amounts sum to the principal, the due dates strictly increase along
 * `sequence`, and the last repayment falls inside the agreement's effective period — used to hold
 * only of schedules built on the loans screen. Everything else could store whatever it liked. This
 * drives the path everything else uses: a `collections.mutate` push at `loan_repayments`, through
 * the guest, against a real database.
 *
 * The unit suite (`loan-schedule-invariants.test.ts`) drives the arithmetic and the hook directly.
 * What only a host can answer is whether preparation and validation receive the proposed parent on nested writes,
 * while direct repayment writes are judged against their complete stored schedule.
 */

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;

const CONTROLLER = 'HQ Payroll HR';
const LOAN_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const COMPONENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
/** The seed carries no loan; this one is written the way provisioning writes facts, in SQL. */
const PRINCIPAL = 1200;
const day = (value: string) => `${value}T00:00:00.000Z`;

const headers = (session: Session) => ({
	...bearerHeaders(session.credential),
	'x-colony-impersonated-team': CONTROLLER
});

const rowVersion = async (session: Session, id: string): Promise<number> => {
	const [row] = (await session.query(`select row_version from loan_repayments where id = $1`, [
		id
	])) as ReadonlyArray<{ readonly row_version: number }>;
	assert.ok(row, `loan_repayments ${id} exists`);
	return row.row_version;
};

const write = (
	session: Session,
	rows: ReadonlyArray<{ readonly action: 'create' | 'update'; readonly values: Row }>,
	baseVersions: ReadonlyArray<{
		readonly row: { readonly collection: string; readonly recordId: string };
		readonly rowVersion: number;
	}> = []
) =>
	postGuestCommand(
		session.host.baseUrl,
		'collections.mutate',
		mutationPush(
			session.schemaFingerprint,
			{ action: 'mutate', collection: 'loan_repayments', rows: [...rows] },
			[...baseVersions]
		),
		headers(session)
	);

const refusedWith = (response: { readonly value: unknown }, what: string, pattern: RegExp) => {
	const body = asRecord(response.value, what);
	assert.equal(body.resolution, 'rejected', `${what}: ${JSON.stringify(response.value)}`);
	assert.match(
		String(body.message ?? body.error ?? ''),
		pattern,
		`${what}: ${JSON.stringify(body)}`
	);
};

/** The stored schedule, in recovery order — what the assertions are actually about. */
const schedule = async (session: Session) =>
	(await session.query(
		`select id, left(due_date::text, 10) as due_day, amount_due::float8 as amount_due, sequence
		 from loan_repayments where loan_id = $1 order by sequence`,
		[LOAN_ID]
	)) as ReadonlyArray<{
		readonly id: string;
		readonly due_day: string;
		readonly amount_due: number;
		readonly sequence: number;
	}>;

test(
	'public seed: a repayment schedule that does not add up, runs backwards or outruns the agreement is refused on the write path',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-loan-schedule');
		try {
			// A recovery settles as a payroll deduction, and the public seed carries no deduction
			// component. Written in SQL, the way provisioning writes facts.
			const [settings] = (await session.query(
				`select id as settings_id from jurisdiction_settings limit 1`
			)) as ReadonlyArray<{ readonly settings_id: string }>;
			assert.ok(settings, 'the public seed carries a component catalogue');
			await session.query(
				`insert into loan_catalogue
				 (id, settings_id, code, is_statutory, policy, contribution_treatments, sequence, eligibility, definition)
				 values ($1, $2, 'LOAN_RECOVERY', false, $3::jsonb, '{}'::jsonb, 90, '', $4::jsonb)`,
				[
					COMPONENT_ID,
					settings.settings_id,
					JSON.stringify({ kind: 'DEDUCTION', settlement: 'DEDUCT' }),
					JSON.stringify({
						source: 'ENTRY',
						unit: 'MONEY',
						evidence: 'NONE',
						cap: null,
						settlement: 'PAYROLL'
					})
				]
			);
			await session.query(
				`insert into loans (id, employment_id, loan_catalogue_id, principal, effective_range, reference)
				 values ($1, $2, $3, $4, $5::jsonb, $6)`,
				[
					LOAN_ID,
					EMPLOYMENT_ID,
					COMPONENT_ID,
					PRINCIPAL,
					JSON.stringify({ start: day('2026-04-01'), end: day('2026-09-01') }),
					'ADV-SCHEDULE'
				]
			);

			const instalment = (index: number, dueDay: string, amountDue: number) => ({
				action: 'create' as const,
				values: {
					id: `cccccccc-cccc-4ccc-8ccc-cccccccccc1${index}`,
					loan_id: LOAN_ID,
					employment_id: EMPLOYMENT_ID,
					due_date: day(dueDay),
					amount_due: amountDue,
					sequence: index
				}
			});

			// A whole schedule in one push, one cent past the tolerance. The batch is judged as the
			// schedule it would leave, so the refusal names the total — not one of the four rows.
			refusedWith(
				await write(session, [
					instalment(1, '2026-04-01', 400),
					instalment(2, '2026-05-01', 400),
					instalment(3, '2026-06-01', 400.02)
				]),
				'imbalanced create batch',
				/SCHEDULE_IMBALANCED: the repayments add up to 1200\.02, and the loan's principal is 1200\.00/
			);
			assert.deepEqual(await schedule(session), [], 'nothing was stored by the refused batch');

			// Backwards along the sequence, and outside the agreement, each refused by name.
			refusedWith(
				await write(session, [
					instalment(1, '2026-05-01', 400),
					instalment(2, '2026-04-01', 400),
					instalment(3, '2026-06-01', 400)
				]),
				'backwards create batch',
				/SCHEDULE_OUT_OF_ORDER/
			);
			refusedWith(
				await write(session, [
					instalment(1, '2026-04-01', 400),
					instalment(2, '2026-05-01', 400),
					instalment(3, '2026-10-01', 400)
				]),
				'create batch past the agreement',
				/SCHEDULE_OUTSIDE_EFFECTIVE_RANGE/
			);

			// The negative control: the same shape, sound, lands. A guard that refuses everything
			// reads exactly like a working one from the refusals alone.
			requireAccepted(
				(
					await write(session, [
						instalment(1, '2026-04-01', 400),
						instalment(2, '2026-05-01', 400),
						instalment(3, '2026-06-01', 400)
					])
				).value,
				'balanced create batch'
			);
			assert.deepEqual(
				(await schedule(session)).map((row) => [row.due_day, row.amount_due]),
				[
					['2026-04-01', 400],
					['2026-05-01', 400],
					['2026-06-01', 400]
				]
			);
			assert.deepEqual(
				await session.query(
					`select distinct employment_id::text as employment_id from loan_repayments where loan_id = $1`,
					[LOAN_ID]
				),
				[{ employment_id: EMPLOYMENT_ID }]
			);

			// A partial update is judged as the row it would produce, against the whole schedule it
			// would leave — the two columns it carries are not the schedule.
			const [first, second] = await schedule(session);
			assert.ok(first && second);
			refusedWith(
				await write(
					session,
					[
						{
							action: 'update',
							values: {
								id: first.id,
								employment_id: '44444444-4444-4444-8444-444444444445'
							}
						}
					],
					[
						{
							row: { collection: 'loan_repayments', recordId: first.id },
							rowVersion: await rowVersion(session, first.id)
						}
					]
				),
				'repayment contract mismatch',
				/same employment contract/
			);
			refusedWith(
				await write(
					session,
					[{ action: 'update', values: { id: first.id, loan_id: LOAN_ID, amount_due: 300 } }],
					[
						{
							row: { collection: 'loan_repayments', recordId: first.id },
							rowVersion: await rowVersion(session, first.id)
						}
					]
				),
				'imbalancing patch',
				/SCHEDULE_IMBALANCED: the repayments add up to 1100\.00/
			);

			// Two patches that move money between instalments keep the plan sound, and land.
			requireAccepted(
				(
					await write(
						session,
						[
							{ action: 'update', values: { id: first.id, loan_id: LOAN_ID, amount_due: 300 } },
							{ action: 'update', values: { id: second.id, loan_id: LOAN_ID, amount_due: 500 } }
						],
						[
							{
								row: { collection: 'loan_repayments', recordId: first.id },
								rowVersion: await rowVersion(session, first.id)
							},
							{
								row: { collection: 'loan_repayments', recordId: second.id },
								rowVersion: await rowVersion(session, second.id)
							}
						]
					)
				).value,
				'balanced pair of patches'
			);
			assert.deepEqual(
				(await schedule(session)).map((row) => row.amount_due),
				[300, 500, 400]
			);

			// An edited parent and its complete nested schedule are judged together. The child
			// receives the proposed agreement, including principal changes and omitted repayments.

			const loanVersion = async () => {
				const [row] = (await session.query(`select row_version from loans where id = $1`, [
					LOAN_ID
				])) as ReadonlyArray<{ readonly row_version: number }>;
				assert.ok(row);
				return row.row_version;
			};
			const remove = async (collection: 'loans' | 'loan_repayments', ids: readonly string[]) => {
				const versions = await session.query(
					`select id, row_version from ${collection} where id = any($1::uuid[])`,
					[ids]
				);
				return postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(
						session.schemaFingerprint,
						{ action: 'delete', collection, ids: [...ids] },
						versions.map((row) => ({
							row: { collection, recordId: String(row.id) },
							rowVersion: Number(row.row_version)
						}))
					),
					headers(session)
				);
			};
			const nested = async (rows: ReadonlyArray<Row>, principal: number) => {
				const current = await schedule(session);
				return postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(
						session.schemaFingerprint,
						{
							action: 'mutate',
							collection: 'loans',
							rows: [
								{ action: 'update', values: { id: LOAN_ID, principal, repayment_loan: [...rows] } }
							]
						},
						[
							{ row: { collection: 'loans', recordId: LOAN_ID }, rowVersion: await loanVersion() },
							...(await Promise.all(
								current.map(async (row) => ({
									row: { collection: 'loan_repayments', recordId: row.id },
									rowVersion: await rowVersion(session, row.id)
								}))
							))
						]
					),
					headers(session)
				);
			};
			const lines = await schedule(session);
			refusedWith(await nested([], PRINCIPAL), 'empty schedule replacement', /cannot be empty/);
			refusedWith(
				await remove('loan_repayments', [lines[0]!.id]),
				'standalone repayment deletion',
				/complete repayment schedule instead/
			);
			refusedWith(
				await remove(
					'loan_repayments',
					lines.map((row) => row.id)
				),
				'standalone whole schedule deletion',
				/complete repayment schedule instead/
			);
			refusedWith(
				await postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(
						session.schemaFingerprint,
						{
							action: 'mutate',
							collection: 'loans',
							rows: [{ action: 'update', values: { id: LOAN_ID, principal: 1250 } }]
						},
						[{ row: { collection: 'loans', recordId: LOAN_ID }, rowVersion: await loanVersion() }]
					),
					headers(session)
				),
				'principal-only amendment',
				/SCHEDULE_IMBALANCED/
			);
			assert.deepEqual(
				await schedule(session),
				lines,
				'invalid deletions and principal edits preserve the original schedule'
			);
			requireAccepted(
				(
					await nested(
						lines.map((row, index) => ({
							id: row.id,
							due_date: day(row.due_day),
							amount_due: 500,
							sequence: index + 1
						})),
						1500
					)
				).value,
				'nested principal rise with the schedule that matches it'
			);
			requireAccepted(
				(
					await nested(
						lines.slice(0, 2).map((row, index) => ({
							id: row.id,
							due_date: day(row.due_day),
							amount_due: 750,
							sequence: index + 1
						})),
						1500
					)
				).value,
				'nested write dropping a line'
			);
			assert.deepEqual(
				(await schedule(session)).map((row) => row.amount_due),
				[750, 750],
				'the dropped line is gone and the rest stand'
			);

			const newLoanId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
			const createNestedLoan = (employmentId?: string, amount = 600, empty = false) =>
				postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(
						session.schemaFingerprint,
						{
							action: 'mutate',
							collection: 'loans',
							rows: [
								{
									action: 'create',
									values: {
										id: newLoanId,
										employment_id: EMPLOYMENT_ID,
										loan_catalogue_id: COMPONENT_ID,
										principal: 600,
										effective_range: { start: day('2026-04-01'), end: day('2026-09-01') },
										reference: 'NESTED-CONTRACT',
										repayment_loan: empty
											? []
											: [
													{
														due_date: day('2026-05-01'),
														amount_due: amount,
														sequence: 1,
														...(employmentId === undefined ? {} : { employment_id: employmentId })
													}
												]
									}
								}
							]
						},
						[]
					),
					headers(session)
				);
			refusedWith(
				await createNestedLoan(undefined, 600, true),
				'empty new agreement schedule',
				/complete repayment schedule/
			);
			refusedWith(
				await createNestedLoan('44444444-4444-4444-8444-444444444445'),
				'new nested loan contract mismatch',
				/same employment contract/
			);
			refusedWith(
				await createNestedLoan(undefined, 599),
				'new nested loan schedule mismatch',
				/SCHEDULE_IMBALANCED/
			);
			assert.deepEqual(
				await session.query('select id from loans where id = $1', [newLoanId]),
				[],
				'refused nested graph leaves no agreement'
			);
			requireAccepted(
				(await createNestedLoan()).value,
				'new nested loan derives contract without reading an unwritten agreement'
			);
			const [nestedRepayment] = await session.query(
				`select r.employment_id::text as employment_id, r.loan_id::text as loan_id
				 from loan_repayments r where r.loan_id = $1`,
				[newLoanId]
			);
			assert.deepEqual(nestedRepayment, { employment_id: EMPLOYMENT_ID, loan_id: newLoanId });
			requireAccepted(
				(await remove('loans', [newLoanId])).value,
				'whole unused agreement deletion'
			);
			assert.deepEqual(
				await session.query('select id from loan_repayments where loan_id = $1', [newLoanId]),
				[]
			);

			// Seed a previously captured input; the mutations below still traverse the real hooks.
			const captured = (await schedule(session))[0]!;
			const runId = crypto.randomUUID();
			const payslipId = crypto.randomUUID();
			await session.query(
				`insert into payroll_runs
				(id, company_id, period, lifecycle, settings_id, configuration_hash, holidays, calculation_version, pay_date, attendance_from, attendance_to)
				values ($1, $2, '2026-04', 'DRAFT', $3, 'loan-capture-fixture', '[]'::jsonb, 'loan-capture-fixture', '2026-04-30', '2026-04-01', '2026-04-30')`,
				[runId, COMPANY_ID, settings.settings_id]
			);
			await session.query(
				`insert into payslips (id, payroll_run_id, employment_id, terms_through, base, proration, statutory, gross, total_deductions, net, employer_cost, currency)
				values ($1, $2, $3, '2026-04-30', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, 0, 0, 0, 'MYR')`,
				[payslipId, runId, EMPLOYMENT_ID]
			);
			await session.query(
				`insert into payslip_loan_repayment_inputs (id, payslip_id, loan_repayment_id, period) values ($1, $2, $3, '2026-04')`,
				[crypto.randomUUID(), payslipId, captured.id]
			);
			const [capturePreimage] = await session.query(
				`select to_jsonb(r) as record, current_setting('TimeZone') as time_zone
				 from loan_repayments r where id = $1`,
				[captured.id]
			);
			const restatedSchedule = (await schedule(session)).map((row) => ({
				id: row.id,
				due_date: day(row.due_day),
				amount_due: row.id === captured.id ? row.amount_due : 500,
				sequence: row.sequence
			}));
			requireAccepted(
				(await nested(restatedSchedule, 1250)).value,
				`captured repayment restatement while amending the remaining schedule: ${JSON.stringify({
					preimage: capturePreimage,
					submitted: restatedSchedule.find((row) => row.id === captured.id)
				})}`
			);
			const [captureAfter] = await session.query(
				`select to_jsonb(r) as record from loan_repayments r where id = $1`,
				[captured.id]
			);
			const beforeFacts = asRecord(capturePreimage?.record, 'captured repayment preimage');
			const afterFacts = asRecord(captureAfter?.record, 'captured repayment after restatement');
			for (const column of ['loan_id', 'employment_id', 'due_date', 'amount_due', 'sequence'])
				assert.equal(afterFacts[column], beforeFacts[column], `captured ${column} is unchanged`);
			refusedWith(
				await write(
					session,
					[
						{
							action: 'update',
							values: { id: captured.id, due_date: `${captured.due_day}T00:00:01.000Z` }
						}
					],
					[
						{
							row: { collection: 'loan_repayments', recordId: captured.id },
							rowVersion: await rowVersion(session, captured.id)
						}
					]
				),
				'captured repayment instant change',
				/payroll 2026-04 has already taken/
			);
			refusedWith(
				await write(
					session,
					[{ action: 'update', values: { id: captured.id, amount_due: 749 } }],
					[
						{
							row: { collection: 'loan_repayments', recordId: captured.id },
							rowVersion: await rowVersion(session, captured.id)
						}
					]
				),
				'captured repayment edit',
				/payroll 2026-04 has already taken/
			);
			refusedWith(
				await remove('loan_repayments', [captured.id]),
				'captured repayment deletion',
				/payroll 2026-04 has already taken/
			);
			refusedWith(
				await remove('loans', [LOAN_ID]),
				'captured agreement deletion',
				/payroll 2026-04 has already taken/
			);
			assert.deepEqual(
				(await schedule(session)).map((row) => row.amount_due),
				[750, 500]
			);
		} finally {
			await session.stop();
		}
	}
);
