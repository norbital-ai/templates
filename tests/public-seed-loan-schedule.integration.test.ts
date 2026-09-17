import test from 'node:test';
import assert from 'node:assert/strict';
import { asRecord, bearerHeaders, requireAccepted } from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { createdIds, observedVersion, writeRows } from './helpers/write.ts';

/**
 * A loan's repayment schedule, refused on the real write path rather than only on the form.
 *
 * The three invariants — the amounts sum to the principal, the due dates strictly increase along
 * `sequence`, and the last repayment falls inside the agreement's effective period — hold of every
 * schedule because a repayment is written through its agreement (RFC §4.2): the `loans` input
 * carries the schedule as explicit `create`, `update` and `delete` actions, and the transform
 * judges the schedule the write would leave. This drives that path through the guest, against a
 * real database.
 *
 * The unit suite (`loan-schedule-invariants.test.ts`) drives the arithmetic and the transform
 * directly. What only a host can answer is that a refused graph leaves nothing behind, that a
 * dropped line is deleted only when named, and that a captured repayment stays as the payslip
 * took it.
 */

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;

const CONTROLLER = 'HQ Payroll HR';
const COMPONENT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
/** The seed carries no loan; the agreement is created through the collection, like any other. */
const PRINCIPAL = 1200;
const RANGE = { start: '2026-04-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' };
const day = (value: string) => `${value}T00:00:00.000Z`;

const headers = (session: Session) => ({
	...bearerHeaders(session.credential),
	'x-colony-impersonated-team': CONTROLLER
});

const version = async (session: Session, collection: string, id: string): Promise<number> => {
	const [row] = (await session.query(`select row_version from ${collection} where id = $1`, [
		id
	])) as ReadonlyArray<{ readonly row_version: number }>;
	assert.ok(row, `${collection} ${id} exists`);
	return row.row_version;
};

const refusedWith = (response: { readonly value: unknown }, what: string, pattern: RegExp) => {
	const body = asRecord(response.value, what);
	assert.equal(body.resolution, 'rejected', `${what}: ${JSON.stringify(response.value)}`);
	assert.match(
		String(body.message ?? body.error ?? ''),
		pattern,
		`${what}: ${JSON.stringify(body)}`
	);
};

/** The stored schedule of one agreement, in recovery order — what the assertions are about. */
const schedule = async (session: Session, loanId: string) =>
	(await session.query(
		`select id, to_char(due_date at time zone 'UTC', 'YYYY-MM-DD') as due_day, amount_due::float8 as amount_due, sequence
		 from loan_repayments where loan_id = $1 order by sequence`,
		[loanId]
	)) as ReadonlyArray<{
		readonly id: string;
		readonly due_day: string;
		readonly amount_due: number;
		readonly sequence: number;
	}>;

const line = (sequence: number, dueDay: string, amountDue: number) => ({
	due_date: day(dueDay),
	amount_due: amountDue,
	sequence
});

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
				 (id, settings_id, code, loan_type, eligibility)
				 values ($1, $2, 'LOAN_RECOVERY', 'STAFF', '')`,
				[COMPONENT_ID, settings.settings_id]
			);
			const agreement = {
				employment_id: EMPLOYMENT_ID,
				loan_catalogue_id: COMPONENT_ID,
				principal: PRINCIPAL,
				effective_range: RANGE,
				reference: 'ADV-SCHEDULE'
			};
			const create = (rows: ReadonlyArray<Row>, extra: Row = {}) =>
				writeRows(
					session,
					'loans',
					'create',
					[{ ...agreement, ...extra, repayment_loan: { create: rows } }],
					headers(session)
				);
			const loanCount = async () =>
				(await session.query('select id from loans where reference = $1', ['ADV-SCHEDULE'])).length;

			// A whole schedule in one push, one cent past the tolerance. The graph is judged as the
			// schedule it would leave, so the refusal names the total — not one of the rows.
			refusedWith(
				await create([
					line(1, '2026-04-01', 400),
					line(2, '2026-05-01', 400),
					line(3, '2026-06-01', 400.02)
				]),
				'imbalanced create',
				/SCHEDULE_IMBALANCED: the repayments add up to 1200\.02, and the loan's principal is 1200\.00/
			);
			assert.equal(await loanCount(), 0, 'a refused graph leaves no agreement behind');

			// Backwards along the sequence, and outside the agreement, each refused by name.
			refusedWith(
				await create([
					line(1, '2026-05-01', 400),
					line(2, '2026-04-01', 400),
					line(3, '2026-06-01', 400)
				]),
				'backwards create',
				/SCHEDULE_OUT_OF_ORDER/
			);
			refusedWith(
				await create([
					line(1, '2026-04-01', 400),
					line(2, '2026-05-01', 400),
					line(3, '2026-10-01', 400)
				]),
				'create past the agreement',
				/SCHEDULE_OUTSIDE_EFFECTIVE_RANGE/
			);
			refusedWith(await create([]), 'empty new agreement schedule', /complete repayment schedule/);
			refusedWith(
				await create([line(1, '2026-05-01', 1200)], {
					employment_id: '44444444-4444-4444-8444-444444444445'
				}),
				'agreement on a contract that is not on file',
				/does not exist|not offered|employment/i
			);

			// The negative control: the same shape, sound, lands. A guard that refuses everything
			// reads exactly like a working one from the refusals alone.
			const created = await create([
				line(1, '2026-04-01', 400),
				line(2, '2026-05-01', 400),
				line(3, '2026-06-01', 400)
			]);
			requireAccepted(created.value, 'balanced create');
			const [loanId] = createdIds(created.value);
			assert.ok(loanId);
			assert.deepEqual(
				(await schedule(session, loanId)).map((row) => [row.due_day, row.amount_due]),
				[
					['2026-04-01', 400],
					['2026-05-01', 400],
					['2026-06-01', 400]
				]
			);
			// Every repayment rides its agreement's contract: the transform fills it, no caller does.
			assert.deepEqual(
				await session.query(
					`select distinct employment_id::text as employment_id from loan_repayments where loan_id = $1`,
					[loanId]
				),
				[{ employment_id: EMPLOYMENT_ID }]
			);

			/** An edit of the agreement and its schedule, judged together, with what it read. */
			const amend = async (patch: Row) => {
				const current = await schedule(session, loanId);
				return writeRows(session, 'loans', 'update', [{ id: loanId, ...patch }], headers(session), [
					observedVersion('loans', loanId, await version(session, 'loans', loanId)),
					...(await Promise.all(
						current.map(async (row) =>
							observedVersion(
								'loan_repayments',
								row.id,
								await version(session, 'loan_repayments', row.id)
							)
						)
					))
				]);
			};

			// A partial update is judged as the row it would produce, against the whole schedule it
			// would leave — the two columns it carries are not the schedule.
			const [first, second] = await schedule(session, loanId);
			assert.ok(first && second);
			refusedWith(
				await amend({ repayment_loan: { update: [{ id: first.id, set: { amount_due: 300 } }] } }),
				'imbalancing patch',
				/SCHEDULE_IMBALANCED: the repayments add up to 1100\.00/
			);
			// Two patches that move money between instalments keep the plan sound, and land.
			requireAccepted(
				(
					await amend({
						repayment_loan: {
							update: [
								{ id: first.id, set: { amount_due: 300 } },
								{ id: second.id, set: { amount_due: 500 } }
							]
						}
					})
				).value,
				'balanced pair of patches'
			);
			assert.deepEqual(
				(await schedule(session, loanId)).map((row) => row.amount_due),
				[300, 500, 400]
			);

			// The agreement and its schedule are judged together: a principal alone is refused
			// against the stored schedule, and the schedule may not be emptied.
			const lines = await schedule(session, loanId);
			refusedWith(
				await amend({ principal: 1250 }),
				'principal-only amendment',
				/SCHEDULE_IMBALANCED/
			);
			refusedWith(
				await amend({ repayment_loan: { delete: lines.map(({ id }) => ({ id })) } }),
				'empty schedule replacement',
				/cannot be empty/
			);
			// A repayment leaves through its agreement or its own delete grant; here, through its
			// agreement, it is refused when the schedule it leaves does not add up.
			refusedWith(
				await amend({ repayment_loan: { delete: [{ id: lines[0]!.id }] } }),
				'dropping a line without restating the rest',
				/SCHEDULE_IMBALANCED/
			);
			assert.deepEqual(
				await schedule(session, loanId),
				lines,
				'refused amendments preserve the original schedule'
			);
			requireAccepted(
				(
					await amend({
						principal: 1500,
						repayment_loan: {
							update: lines.map((row) => ({ id: row.id, set: { amount_due: 500 } }))
						}
					})
				).value,
				'principal rise with the schedule that matches it'
			);
			// Nothing is deleted by omission: a line goes only when the write names it.
			requireAccepted(
				(
					await amend({
						repayment_loan: {
							update: lines.slice(0, 2).map((row) => ({ id: row.id, set: { amount_due: 750 } })),
							delete: [{ id: lines[2]!.id }]
						}
					})
				).value,
				'dropping a named line'
			);
			assert.deepEqual(
				(await schedule(session, loanId)).map((row) => row.amount_due),
				[750, 750],
				'the named line is gone and the rest stand'
			);

			// A second agreement, refused for a schedule that does not add up and for a line that
			// names another person, leaves nothing behind; a sound one lands and goes whole.
			const other = (rows: ReadonlyArray<Row>) =>
				writeRows(
					session,
					'loans',
					'create',
					[
						{
							...agreement,
							principal: 600,
							reference: 'NESTED-CONTRACT',
							repayment_loan: { create: rows }
						}
					],
					headers(session)
				);
			refusedWith(
				await other([line(1, '2026-05-01', 599)]),
				'new agreement schedule mismatch',
				/SCHEDULE_IMBALANCED/
			);
			refusedWith(
				await other([
					{ ...line(1, '2026-05-01', 600), employment_id: '44444444-4444-4444-8444-444444444445' }
				]),
				'a line naming a contract of its own',
				/not part of the declared create input/
			);
			assert.deepEqual(
				await session.query('select id from loans where reference = $1', ['NESTED-CONTRACT']),
				[],
				'refused nested graph leaves no agreement'
			);
			const secondLoan = await other([line(1, '2026-05-01', 600)]);
			requireAccepted(secondLoan.value, 'a sound new agreement lands');
			const [newLoanId] = createdIds(secondLoan.value);
			assert.deepEqual(
				await session.query(
					`select r.employment_id::text as employment_id, r.loan_id::text as loan_id from loan_repayments r where r.loan_id = $1`,
					[newLoanId]
				),
				[{ employment_id: EMPLOYMENT_ID, loan_id: newLoanId }]
			);
			requireAccepted(
				(
					await writeRows(session, 'loans', 'delete', [{ id: newLoanId }], headers(session), [
						observedVersion('loans', newLoanId, await version(session, 'loans', newLoanId))
					])
				).value,
				'whole unused agreement deletion'
			);
			assert.deepEqual(
				await session.query('select id from loan_repayments where loan_id = $1', [newLoanId]),
				[]
			);

			// Seed a previously captured input; the writes below still traverse the real transform.
			const captured = (await schedule(session, loanId))[0]!;
			const runId = crypto.randomUUID();
			const payslipId = crypto.randomUUID();
			await session.query(
				`insert into payroll_runs
				(id, company_id, period, settings_id, configuration_hash, holidays, calculation_version, pay_date, attendance_from, attendance_to)
				values ($1, $2, '2026-04', $3, 'loan-capture-fixture', '[]'::jsonb, 'loan-capture-fixture', '2026-04-30', '2026-04-01', '2026-04-30')`,
				[runId, COMPANY_ID, settings.settings_id]
			);
			await session.query(
				`insert into payslips (id, payroll_run_id, employment_id, terms_through, base, proration, statutory, gross, total_deductions, net, employer_cost, currency)
				values ($1, $2, $3, '2026-04-30', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, 0, 0, 0, 'MYR')`,
				[payslipId, runId, EMPLOYMENT_ID]
			);
			await session.query(`update loan_repayments set payslip_id = $1 where id = $2`, [
				payslipId,
				captured.id
			]);
			const [capturePreimage] = await session.query(
				`select to_jsonb(r) as record from loan_repayments r where id = $1`,
				[captured.id]
			);
			// The captured line restated exactly, beside an amendment of the rest, lands.
			const remaining = (await schedule(session, loanId)).filter((row) => row.id !== captured.id);
			requireAccepted(
				(
					await amend({
						principal: 1250,
						repayment_loan: {
							update: [
								{
									id: captured.id,
									set: { due_date: day(captured.due_day), amount_due: captured.amount_due }
								},
								...remaining.map((row) => ({ id: row.id, set: { amount_due: 500 } }))
							]
						}
					})
				).value,
				'captured repayment restatement while amending the remaining schedule'
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
				await amend({
					repayment_loan: {
						update: [{ id: captured.id, set: { due_date: `${captured.due_day}T00:00:01.000Z` } }]
					}
				}),
				'captured repayment instant change',
				/settled by a payroll and cannot be changed/
			);
			refusedWith(
				await amend({
					repayment_loan: { update: [{ id: captured.id, set: { amount_due: 749 } }] }
				}),
				'captured repayment edit',
				/settled by a payroll and cannot be changed/
			);
			refusedWith(
				await amend({ repayment_loan: { delete: [{ id: captured.id }] } }),
				'captured repayment deletion through the agreement',
				/settled by a payroll and cannot be deleted/
			);
			// The direct delete is the grant's decision, read off the same pin.
			refusedWith(
				await writeRows(
					session,
					'loan_repayments',
					'delete',
					[{ id: captured.id }],
					headers(session),
					[
						observedVersion(
							'loan_repayments',
							captured.id,
							await version(session, 'loan_repayments', captured.id)
						)
					]
				),
				'captured repayment direct deletion',
				/authoriz|refused/i
			);
			refusedWith(
				await writeRows(session, 'loans', 'delete', [{ id: loanId }], headers(session), [
					observedVersion('loans', loanId, await version(session, 'loans', loanId))
				]),
				'captured agreement deletion',
				/authoriz|refused/i
			);
			assert.deepEqual(
				(await schedule(session, loanId)).map((row) => row.amount_due),
				[750, 500]
			);
		} finally {
			await session.stop();
		}
	}
);
