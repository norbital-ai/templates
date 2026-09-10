import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../src/lib/ui/calendar.ts';

/** A stored day-precision instant, read back as the payroll calendar day it began. */
const dayOf = (value: unknown): string =>
	calendarDateInTimeZone(new Date(String(value)), PAYROLL_TIME_ZONE);

const fixture = <T>(name: string): T =>
	JSON.parse(readFileSync(new URL(`./fixtures/seed/${name}.json`, import.meta.url), 'utf8')) as T;

/**
 * Two payroll runs a month at a semi-monthly company, end to end on bolt-server.
 *
 * The public fixture entity pays monthly, so a second one is stood up beside it here: the same
 * PUB statute and 11% / 13% retirement scheme, paying `SEMI_MONTHLY` on cutoff day 21, with one
 * employment on `SEMI_MONTHLY` terms at 4,100 and one on monthly terms at 3,451. The hook refuses
 * the month grammar for it by name, the first half pays only the semi-monthly employment for the
 * 1st to the 15th, the second half pays the semi-monthly employment for the 16th to the end and
 * the monthly employment over the cutoff window, and the two halves add up to the one monthly
 * payslip the model used to produce. Both fixture schemes charge everyone here (11% and the 5%
 * non-citizen fund, since no fact says otherwise), so 4,100 less 16% is 3,444.00;
 * `semi-monthly-runs.test.ts` carries the one-scheme figure, 3,649.00, captured off the in-memory
 * model before the grammar existed.
 */
test(
	'public seed semi-monthly company runs two payrolls a month, each paying its own half',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS * 2 },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-semi-monthly');
		try {
			const headers = bearerHeaders(session.credential);
			const companyId = crypto.randomUUID();
			await session.query(
				`insert into companies (id, settings_code, name, registration_number, pay_cutoff_day, pay_frequency, effective_range)
				 values ($1, $2, $3, $4, $5, $6, $7)`,
				[
					companyId,
					'PUB',
					'Public Semi-monthly Co',
					'PUB-CO-0002',
					21,
					'SEMI_MONTHLY',
					{ start: '2020-01-01', end: null }
				]
			);
			// The company's own roster codes: shifts are per company, site operations rather than rules.
			const shifts = fixture<
				ReadonlyArray<{
					id: string;
					code: string;
					name: string;
					variant: unknown;
					effective_range: unknown;
				}>
			>('shift_definitions');
			const shiftIdByFixtureId = new Map(shifts.map((shift) => [shift.id, crypto.randomUUID()]));
			for (const shift of shifts)
				await session.query(
					`insert into shift_definitions (id, company_id, code, name, variant, effective_range)
					 values ($1, $2, $3, $4, $5, $6)`,
					[
						shiftIdByFixtureId.get(shift.id),
						companyId,
						shift.code,
						shift.name,
						shift.variant,
						shift.effective_range
					]
				);
			// The second entity shares the PUB settings lineage, so the catalogue (BASIC, the schemes and
			// their bands) is already its own; only its shifts are per company.
			// The second entity gets its own copy of the named pattern, its cycle naming its own
			// shifts, and every hire below points at that copy.
			const fixturePattern =
				fixture<
					ReadonlyArray<{ code: string; name: string; pattern: unknown; effective_range: unknown }>
				>('shift_patterns')[0];
			const pattern = JSON.parse(
				JSON.stringify(fixturePattern?.pattern).replaceAll(
					/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa[123]/g,
					(id) => shiftIdByFixtureId.get(id) ?? id
				)
			) as unknown;
			const patternId = crypto.randomUUID();
			await session.query(
				`insert into shift_patterns (id, company_id, code, name, pattern, effective_range)
				 values ($1, $2, $3, $4, $5, $6)`,
				[
					patternId,
					companyId,
					fixturePattern?.code,
					fixturePattern?.name,
					pattern,
					fixturePattern?.effective_range
				]
			);

			const hire = async (number: string, payFrequency: string, wage: number) => {
				const employeeId = crypto.randomUUID();
				const employmentId = crypto.randomUUID();
				await session.query(
					`insert into employees (id, name, date_of_birth, gender, marital_status, spouse_status, dependents_count)
					 values ($1, $2, $3, $4, $5, $6, $7)`,
					[employeeId, `Semi ${number}`, '1990-05-05', 'MALE', 'SINGLE', 'NONE', 0]
				);
				await session.query(
					`insert into employments (id, employee_id, company_id, employee_number, hire_date, effective_range)
					 values ($1, $2, $3, $4, $5, $6)`,
					[
						employmentId,
						employeeId,
						companyId,
						number,
						'2022-03-01',
						{ start: '2022-03-01', end: null }
					]
				);
				await session.query(
					`insert into employment_terms (id, employment_id, base_salary, pay_frequency, work_classification,
						statutory_work_category, employment_type, job_title, shift_pattern_id, effective_range)
					 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
					[
						crypto.randomUUID(),
						employmentId,
						{ value: wage, currency: 'MYR' },
						payFrequency,
						'EA_COVERED',
						'NON_MANUAL',
						'PERMANENT',
						'Operator',
						patternId,
						{ start: '2022-03-01', end: null }
					]
				);
				return employmentId;
			};
			const semiMonthly = await hire('PUB-SEMI-0001', 'SEMI_MONTHLY', 4100);
			const monthly = await hire('PUB-SEMI-0002', 'MONTHLY', 3451);

			const command = (
				body: Parameters<typeof mutationPush>[1],
				bases: Parameters<typeof mutationPush>[2] = []
			) =>
				postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(session.schemaFingerprint, body, bases),
					headers
				);
			const createRun = (id: string, period: string) =>
				command({
					action: 'mutate',
					collection: 'payroll_runs',
					rows: [{ action: 'create', values: { id, company_id: companyId, period } }]
				});
			const slipsOf = async (runId: string) =>
				(await session.query(
					`select employment_id, gross, total_deductions, net, employer_cost from payslips where payroll_run_id = $1`,
					[runId]
				)) as ReadonlyArray<{
					readonly employment_id: string;
					readonly gross: string;
					readonly total_deductions: string;
					readonly net: string;
					readonly employer_cost: string;
				}>;

			// A whole month is the wrong grammar for this company, and the refusal says whose.
			const month = await createRun(crypto.randomUUID(), '2026-02');
			assert.match(
				JSON.stringify(month.value),
				/Public Semi-monthly Co pays SEMI_MONTHLY.*YYYY-MM-1.*YYYY-MM-2/
			);
			// And a malformed half never reaches the company at all: the hook's input schema rejects it.
			const malformed = await createRun(crypto.randomUUID(), '2026-02-3');
			assert.match(
				JSON.stringify(malformed.value),
				/"resolution":"rejected".*hook input validation failed/
			);

			// Half 1: the 1st to the 15th, paid on the 15th, the semi-monthly employment alone.
			const firstId = crypto.randomUUID();
			requireAccepted((await createRun(firstId, '2026-02-1')).value, 'first half');
			const [first] = (await session.query('select * from payroll_runs where id = $1', [
				firstId
			])) as ReadonlyArray<Record<string, unknown>>;
			assert.ok(first);
			assert.equal(dayOf(first.attendance_from), '2026-02-01');
			assert.equal(dayOf(first.attendance_to), '2026-02-15');
			assert.equal(dayOf(first.pay_date), '2026-02-15');
			const firstSlips = await slipsOf(firstId);
			assert.deepEqual(
				firstSlips.map((slip) => slip.employment_id),
				[semiMonthly],
				`half 1 pays the semi-monthly employment only: ${JSON.stringify(firstSlips)}`
			);
			assert.equal(Number(firstSlips[0]?.gross), 2196.43, '4,100 × 15 / 28');

			// The second half no longer waits for the first to be paid: a standing draft used to
			// refuse the next period outright, so one person's correction froze everybody's next
			// payroll. What stays ordered is payment, which is what the mark-paid below proves.
			requireAccepted(
				(
					await command(
						{
							action: 'mutate',
							collection: 'payroll_runs',
							rows: [{ action: 'update', values: { id: firstId, lifecycle: 'PAID' } }]
						},
						[
							{
								row: { collection: 'payroll_runs', recordId: firstId },
								rowVersion: Number(first.row_version)
							}
						]
					)
				).value,
				'first half paid'
			);

			// Half 2: the 16th to the end for the semi-monthly employment, the cutoff window for the
			// monthly one; the run records the envelope and pays at the month end.
			const secondId = crypto.randomUUID();
			requireAccepted((await createRun(secondId, '2026-02-2')).value, 'second half');
			const [second] = (await session.query('select * from payroll_runs where id = $1', [
				secondId
			])) as ReadonlyArray<Record<string, unknown>>;
			assert.ok(second);
			assert.equal(dayOf(second.attendance_from), '2026-01-21');
			assert.equal(dayOf(second.attendance_to), '2026-02-28');
			assert.equal(dayOf(second.pay_date), '2026-02-28');
			const secondSlips = await slipsOf(secondId);
			assert.deepEqual(
				secondSlips.map((slip) => slip.employment_id).toSorted(),
				[semiMonthly, monthly].toSorted(),
				`half 2 pays both cadences: ${JSON.stringify(secondSlips)}`
			);
			const semiSecond = secondSlips.find((slip) => slip.employment_id === semiMonthly);
			const monthlySlip = secondSlips.find((slip) => slip.employment_id === monthly);
			assert.ok(semiSecond && monthlySlip);
			assert.equal(Number(semiSecond.gross), 1903.57, '4,100 × 13 / 28');

			// The two halves are the one monthly payslip, to the cent: 4,100 less 16% is 3,444.00,
			// and the employer's 18% on top is 738.00.
			const sum = (field: 'gross' | 'total_deductions' | 'net' | 'employer_cost') =>
				Math.round((Number(firstSlips[0]?.[field]) + Number(semiSecond[field])) * 100) / 100;
			assert.equal(sum('gross'), 4100);
			assert.equal(sum('total_deductions'), 656);
			assert.equal(sum('net'), 3444);
			assert.equal(sum('employer_cost'), 738);
			// The monthly employment is paid as it would be at a monthly company: 3,451 less 16%.
			assert.equal(Number(monthlySlip.gross), 3451);
			assert.equal(Number(monthlySlip.net), 2898.84);

			// The public fixture entity is untouched: it still runs months, and refuses a half.
			const publicHalf = await command({
				action: 'mutate',
				collection: 'payroll_runs',
				rows: [
					{
						action: 'create',
						values: {
							id: crypto.randomUUID(),
							company_id: '11111111-1111-4111-8111-111111111111',
							period: '2026-02-1'
						}
					}
				]
			});
			assert.match(JSON.stringify(publicHalf.value), /Public Fixture Co pays MONTHLY/);
		} finally {
			await session.stop();
		}
	}
);
