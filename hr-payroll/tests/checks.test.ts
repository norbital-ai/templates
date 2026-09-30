/**
 * Stored checks (E9), hand-computed over jurisdiction-free checks: a version's `checks` refuse or warn at their own
 * stage and no other, over the person plus the stage's roots (`before`/`after`, `deduction`, `leave`, `payslip`,
 * `obligations.open`); a check that cannot be evaluated blocks by name; a duty type that `blocks` a stage refuses it
 * while an instance is open.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { checksFault, checksOf, type Check } from '../src/lib/datatypes/checks.ts';
import { checkContext, checkIssues, dutyBlockIssues, refuseChecks } from '../src/lib/checks.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { validateChecks } from '../src/lib/payroll/run/validate.ts';
import { payrollRunPrecheck } from '../src/lib/payroll/run/precheck.ts';
import type { DutyType } from '../src/lib/obligations/materialise.ts';

const person = (base: number) =>
	personContext({
		employee: null,
		employment: { service_start: '2026-01-01' },
		terms: { base_salary: base, currency: 'XXX', pay_frequency: 'MONTHLY' },
		asOf: '2026-03-01'
	});

const NO_CUT: Check = {
	code: 'NO_PAY_CUT',
	at: 'TERMS_CHANGE',
	when: 'after.basic_salary < before.basic_salary',
	severity: 'REFUSE',
	message: 'Basic pay may not be reduced by a change of terms.',
	authority: 'Wages Act s.1'
};
const HALF_CAP: Check = {
	code: 'DEDUCTION_HALF',
	at: 'DEDUCTION',
	when: 'deduction.total > deduction.gross * 0.5',
	severity: 'REFUSE',
	message: 'Deductions may not exceed half the wage.'
};
const LOW_NET: Check = {
	code: 'LOW_NET',
	at: 'PAYSLIP',
	when: 'payslip.net < 100.0',
	severity: 'WARN',
	message: 'Net pay is below 100.'
};
const EXIT_DUTY: Check = {
	code: 'EXIT_RETURN',
	at: 'EXIT',
	when: "'CESSATION' in obligations.open",
	severity: 'REFUSE',
	message: 'File the cessation notice before the exit.'
};

test('checks: a stored shape is refused for a bad code, stage, severity, empty when or message, or a parse fault', () => {
	assert.equal(checksFault([NO_CUT, HALF_CAP, LOW_NET]), null);
	assert.match(checksFault([{ ...NO_CUT, code: 'no-cut' }])!, /upper-case/);
	assert.match(checksFault([NO_CUT, NO_CUT])!, /once/);
	assert.match(checksFault([{ ...NO_CUT, at: 'HIRE' as Check['at'] }])!, /runs at one of/);
	assert.match(checksFault([{ ...NO_CUT, severity: 'BLOCK' as Check['severity'] }])!, /REFUSE/);
	assert.match(checksFault([{ ...NO_CUT, when: ' ' }])!, /when it fires/);
	assert.match(checksFault([{ ...NO_CUT, message: '' }])!, /tells the operator/);
	assert.match(checksFault([{ ...NO_CUT, when: 'after.basic_salary <' }])!, /NO_PAY_CUT when:/);
	assert.deepEqual(checksOf({ checks: [NO_CUT] }), [NO_CUT]);
	assert.deepEqual(checksOf({}), []);
	assert.deepEqual(checksOf(null), []);
});

test('checks: TERMS_CHANGE reads before and after; a cut 1000 → 900 refuses, a rise 1000 → 1100 passes', () => {
	const at = 'TERMS_CHANGE' as const;
	const judge = (from: number, to: number) =>
		checkIssues({
			checks: [NO_CUT, HALF_CAP],
			at,
			context: checkContext({
				at,
				date: '2026-03-01',
				person: person(to),
				roots: { before: person(from).terms }
			}),
			subject: 'E001',
			recordId: 'emp-1'
		});
	assert.deepEqual(judge(1000, 900), [
		{
			code: 'NO_PAY_CUT',
			severity: 'BLOCKER',
			message: 'E001: Basic pay may not be reduced by a change of terms. (Wages Act s.1)',
			collection: undefined,
			recordId: 'emp-1'
		}
	]);
	assert.deepEqual(judge(1000, 1100), []);
	// Without a `before`, the terms are compared with themselves: no change, no breach.
	assert.deepEqual(
		checkIssues({
			checks: [NO_CUT],
			at,
			context: checkContext({ at, date: '2026-03-01', person: person(900) }),
			subject: ''
		}),
		[]
	);
});

test('checks: DEDUCTION reads the line against the gross — 501 of 1000 refuses, 500 passes (inclusive cap)', () => {
	const at = 'DEDUCTION' as const;
	const total = (value: number) =>
		checkIssues({
			checks: [HALF_CAP, NO_CUT],
			at,
			context: checkContext({
				at,
				date: '2026-03-31',
				person: person(1000),
				roots: {
					deduction: { code: 'ADVANCE', amount: value, gross: 1000, net: 1000, total: value }
				}
			}),
			subject: 'E001'
		}).map((issue) => issue.code);
	assert.deepEqual(total(501), ['DEDUCTION_HALF']);
	assert.deepEqual(total(500), []);
});

test('checks: a WARN check warns, refuseChecks refuses only blockers and returns the warnings', () => {
	const at = 'PAYSLIP' as const;
	const issues = checkIssues({
		checks: [LOW_NET],
		at,
		context: checkContext({
			at,
			date: '2026-03-31',
			person: person(1000),
			roots: {
				payslip: { gross: 1000, net: 99.99, deductions: 900.01, lines: {}, pay_date: '2026-03-31' }
			}
		}),
		subject: 'E001'
	});
	assert.deepEqual(
		issues.map((issue) => [issue.code, issue.severity]),
		[['LOW_NET', 'WARNING']]
	);
	const refuse = (message: string): never => {
		throw new Error(message);
	};
	assert.deepEqual(refuseChecks(issues, refuse), issues);
	assert.throws(
		() =>
			refuseChecks(
				[...issues, { code: 'A', message: 'first.' }, { code: 'B', message: 'second.' }],
				refuse
			),
		/^Error: first\. second\.$/
	);
});

test('checks: a check that cannot be evaluated is a blocker naming it', () => {
	const at = 'PAYSLIP' as const;
	const [issue] = checkIssues({
		checks: [{ ...LOW_NET, when: 'payslip.net' }],
		at,
		context: checkContext({ at, date: '2026-03-31', person: person(1000) }),
		subject: 'E001'
	});
	assert.equal(issue?.severity, 'BLOCKER');
	assert.match(
		issue!.message,
		/^E001: check LOW_NET could not be evaluated: it produced 0, not a boolean\.$/
	);
});

test('checks: EXIT reads obligations.open; a duty that blocks EXIT refuses while open, and only that block word', () => {
	const at = 'EXIT' as const;
	const judge = (open: string[]) =>
		checkIssues({
			checks: [EXIT_DUTY],
			at,
			context: checkContext({ at, date: '2026-03-31', person: person(1000), open }),
			subject: 'E001'
		}).map((issue) => issue.code);
	assert.deepEqual(judge(['CESSATION']), ['EXIT_RETURN']);
	assert.deepEqual(judge(['OTHER']), []);
	const duties: DutyType[] = [
		{
			code: 'CESSATION',
			authority: 'Tax Act s.9',
			subject: 'EMPLOYMENT',
			trigger: { on: 'EXIT' },
			due: 'trigger.date',
			blocks: 'EXIT'
		},
		{
			code: 'REMIT',
			authority: 'Levy Act s.1',
			subject: 'RUN',
			trigger: { on: 'RUN_FINALISED' },
			due: 'period.end',
			blocks: 'RUN'
		}
	];
	assert.deepEqual(
		dutyBlockIssues({ duties, block: 'EXIT', open: ['CESSATION', 'REMIT'], subject: 'E001' }).map(
			(issue) => issue.message
		),
		['E001: CESSATION is still open (Tax Act s.9); fulfil or waive it first.']
	);
	assert.deepEqual(dutyBlockIssues({ duties, block: 'EXIT', open: [], subject: 'E001' }), []);
});

test('checks: the run applies the version’s PAYSLIP checks per person, and the precheck refuses on a RUN-blocking duty', () => {
	const configuration = {
		company: { id: 'co-1', name: 'Acme' },
		work: { bands: [] },
		contributions: [],
		catalogueComponents: [],
		jurisdiction: {
			checks: [LOW_NET, HALF_CAP],
			duty_types: [
				{
					code: 'REMIT',
					authority: 'Levy Act s.1',
					subject: 'RUN',
					trigger: { on: 'RUN_FINALISED' },
					due: 'period.end',
					blocks: 'RUN'
				}
			]
		}
	} as unknown as Parameters<typeof validateChecks>[0]['configuration'];
	const subjects = [50, 500].map((net, index) => ({
		employeeNumber: `E00${index + 1}`,
		employmentId: `emp-${index + 1}`,
		person: person(1000),
		roots: {
			payslip: { gross: 1000, net, deductions: 1000 - net, lines: {}, pay_date: '2026-03-31' }
		}
	}));
	assert.deepEqual(
		validateChecks({ configuration, at: 'PAYSLIP', date: '2026-03-31', subjects }).map((issue) => [
			issue.recordId,
			issue.severity
		]),
		[['emp-1', 'WARNING']]
	);
	const precheck = (openDuties: string[]) =>
		payrollRunPrecheck({
			configuration,
			window: {} as Parameters<typeof payrollRunPrecheck>[0]['window'],
			bundles: [],
			openDuties
		}).map((issue) => issue.code);
	assert.deepEqual(precheck(['REMIT']), ['DUTY_OPEN_REMIT']);
	assert.deepEqual(precheck([]), []);
});

test('checks: on an overlay day the run reads the overlay version’s checks, not the base’s', () => {
	const overlaid = { checks: [{ ...LOW_NET, when: 'payslip.net < 600.0' }] };
	const configuration = {
		jurisdiction: { checks: [LOW_NET] },
		onDay: (day: string) => ({
			jurisdiction: day >= '2026-03-15' ? overlaid : { checks: [LOW_NET] }
		})
	} as unknown as Parameters<typeof validateChecks>[0]['configuration'];
	const subjects = [
		{
			employeeNumber: 'E001',
			employmentId: 'emp-1',
			person: person(1000),
			roots: {
				payslip: { gross: 1000, net: 500, deductions: 500, lines: {}, pay_date: '2026-03-31' }
			}
		}
	];
	const fired = (date: string) =>
		validateChecks({ configuration, at: 'PAYSLIP', date, subjects }).map((issue) => issue.code);
	// base: 500 < 100 is false; overlay: 500 < 600 is true
	assert.deepEqual(fired('2026-03-14'), []);
	assert.deepEqual(fired('2026-03-31'), ['LOW_NET']);
});

test('checks: the precheck refuses every declared fact the build would refuse on, before the run exists', () => {
	const version = {
		id: 'v1',
		code: 'LX',
		sealed_at: '2026-01-01T00:00:00.000Z',
		voided_at: null,
		approval_id: null,
		effective_range: { from: '2026-01-01', to: null },
		terms_facts: [{ key: 'grade', type: 'string', required: true }]
	};
	const configuration = {
		company: {
			id: 'co',
			name: 'Co',
			settings_code: 'LX',
			region: null,
			pay_frequency: 'MONTHLY',
			facts: {}
		},
		companyFactRevisions: [],
		jurisdiction: version,
		lineageVersions: [version],
		referenceRows: new Map(),
		work: { bands: [] },
		contributions: [],
		catalogueComponents: []
	} as unknown as Parameters<typeof payrollRunPrecheck>[0]['configuration'];
	const world = (facts: Record<string, unknown>) =>
		({
			employments: [
				{
					id: 'e1',
					company_id: 'co',
					employee_id: 'p1',
					employee_number: 'E001',
					effective_range: { from: '2025-01-01', to: null }
				},
				// another entity's contract owes this run nothing
				{
					id: 'e9',
					company_id: 'other',
					employee_id: 'p9',
					employee_number: 'E009',
					effective_range: { from: '2025-01-01', to: null }
				}
			],
			employees: [{ id: 'p1' }, { id: 'p9' }],
			employment_terms: [
				{ id: 't1', employment_id: 'e1', effective_range: { from: '2026-01-01', to: null }, facts },
				{
					id: 't9',
					employment_id: 'e9',
					effective_range: { from: '2026-01-01', to: null },
					facts: {}
				}
			],
			person_facts: [],
			fact_evidence: []
		}) as unknown as Parameters<typeof payrollRunPrecheck>[0]['world'];
	const precheck = (facts: Record<string, unknown>) =>
		payrollRunPrecheck({
			configuration,
			window: { salary: { start: '2026-09-01', end: '2026-09-30' } } as Parameters<
				typeof payrollRunPrecheck
			>[0]['window'],
			bundles: [],
			world: world(facts)
		});
	assert.deepEqual(precheck({}), [
		{
			code: 'FACTS_OWED',
			message: 'E001: terms on 2026-09-01: grade is required before calculation.',
			collection: 'employment_terms',
			recordId: 't1'
		}
	]);
	assert.deepEqual(precheck({ grade: 'G1' }), []);
});

test('checks: a stored final-pay deadline (exit + 3 days) warns a slip paid on day 4, not day 3, nor an open contract', () => {
	const at = 'PAYSLIP' as const;
	const FINAL_PAY: Check = {
		code: 'FINAL_PAY_LATE',
		at,
		when: "employment.exit_date != '' && payslip.pay_date > add_days(employment.exit_date, 3)",
		severity: 'WARN',
		message: 'The final pay is due within 3 days of the last day.'
	};
	const judge = (exit: string | null, payDate: string) =>
		checkIssues({
			checks: [FINAL_PAY],
			at,
			context: checkContext({
				at,
				date: exit ?? '2026-03-31',
				person: personContext({
					employee: null,
					employment: { service_start: '2026-01-01', exit_date: exit },
					terms: { base_salary: 1000, currency: 'XXX', pay_frequency: 'MONTHLY' },
					asOf: exit ?? '2026-03-31'
				}),
				roots: { payslip: { gross: 1000, net: 1000, deductions: 0, lines: {}, pay_date: payDate } }
			}),
			subject: 'E001'
		}).map((issue) => [issue.code, issue.severity]);
	// 2026-03-20 + 3 = 2026-03-23
	assert.deepEqual(judge('2026-03-20', '2026-03-23'), []);
	assert.deepEqual(judge('2026-03-20', '2026-03-24'), [['FINAL_PAY_LATE', 'WARNING']]);
	assert.deepEqual(judge(null, '2026-04-30'), []);
});

test('checks: a PAYSLIP check reads the slip’s measured period and week, not the blank 0', async () => {
	const { buildPayrollRun, gatherPayrollRun } = await import('../src/lib/payroll/run/engine.ts');
	const { createPublicPayrollWorld, COMPANY_ID } =
		await import('./fixtures/public-payroll-world.ts');
	const { payrollWorld } = await import('./fixtures/memory-payroll-api.ts');
	const run = async (when: string) => {
		const world = createPublicPayrollWorld();
		world.jurisdiction_settings[0]!.checks = [
			{ code: 'SEEN', at: 'PAYSLIP', when, severity: 'REFUSE', message: 'Seen.' }
		];
		return buildPayrollRun(
			await gatherPayrollRun({
				world: payrollWorld(world),
				companyId: COMPANY_ID,
				period: '2026-01'
			})
		);
	};
	await assert.rejects(async () => run('period.working_days > 0'), /PF0001: Seen\./);
	await assert.rejects(async () => run('terms.working_days_per_week > 0'), /PF0001: Seen\./);
	await run('period.working_days < 0');
});
