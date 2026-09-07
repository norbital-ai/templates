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
 * What only a host can answer is whether `mutate.prepare` is reached at all on this path, and
 * whether a batch of four rows is judged as a schedule rather than four times as a row.
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
				`select settings_id from component_catalogue limit 1`
			)) as ReadonlyArray<{ readonly settings_id: string }>;
			assert.ok(settings, 'the public seed carries a component catalogue');
			await session.query(
				`insert into component_catalogue
				 (id, settings_id, code, is_statutory, policy, contribution_treatments, sequence, eligibility, definition, entry_kind)
				 values ($1, $2, 'LOAN_RECOVERY', false, $3::jsonb, '{}'::jsonb, 90, '', $4::jsonb, null)`,
				[
					COMPONENT_ID,
					settings.settings_id,
					JSON.stringify({ kind: 'DEDUCTION', settlement: 'SUBTRACT' }),
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
				`insert into loans (id, employment_id, component_catalogue_id, principal, effective_range, reference)
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

			// A partial update is judged as the row it would produce, against the whole schedule it
			// would leave — the two columns it carries are not the schedule.
			const [first, second] = await schedule(session);
			assert.ok(first && second);
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

			/**
			 * The other half of the guard: the edits it must NOT refuse.
			 *
			 * A loan write nests its schedule, and raising the principal alongside a regenerated
			 * plan — or dropping a line the relationship reconciliation deletes — is the loans
			 * screen's ordinary flow. Neither is visible to this hook (the nested child is never
			 * told its loan, and the new principal is unwritten while the children are judged), and
			 * an earlier draft of this guard refused both. That is what this case stands on: a
			 * schedule guard that refuses the form is worse than none.
			 */
			const loanVersion = async () => {
				const [row] = (await session.query(`select row_version from loans where id = $1`, [
					LOAN_ID
				])) as ReadonlyArray<{ readonly row_version: number }>;
				assert.ok(row);
				return row.row_version;
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
		} finally {
			await session.stop();
		}
	}
);
