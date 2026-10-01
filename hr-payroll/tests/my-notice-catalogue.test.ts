import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Environment } from '@marcbachmann/cel-js';
import {
	noticeDaysRemaining,
	noticeMonthlyWages,
	serviceYearsOn
} from '../src/lib/expressions/notice-period.ts';
import { roundStep, type RoundMode } from '../src/lib/payroll/run/rounding.ts';

// Execute the actual stored formulas with the production notice functions. This isolates the
// catalogue from the payroll loader's concurrently changing API; it does not prove gather or save.
const engine = new Environment({
	unlistedVariablesAreDyn: true,
	homogeneousAggregateLiterals: false
});
engine.registerFunction('map.service_years_on(dyn): int', serviceYearsOn);
engine.registerFunction('map.notice_days_remaining(dyn, dyn, dyn): double', noticeDaysRemaining);
engine.registerFunction('map.notice_monthly_wages(dyn, dyn, dyn, dyn): double', noticeMonthlyWages);
// The stored bands call `round(value, step, 'MODE')` (round 10); bind the engine's own stepping.
engine.registerFunction('round(dyn, dyn, string): double', (value, step, mode) =>
	roundStep(Number(value), Number(step), mode as RoundMode)
);

type Row = {
	id: string;
	settings_id: string;
	code: string;
	eligibility: string;
	bands: { amount: string }[];
};
type Version = {
	id: string;
	exit_facts: { key: string; options?: string[]; valid_when?: string; required_when?: string }[];
};
function person(
	overrides: {
		exit?: string;
		hire?: string;
		reason?: string;
		days?: number;
		domestic?: boolean;
		given?: string;
		waived?: number;
		misconduct?: boolean;
		party?: string;
		exception?: string;
		approvedApprenticeship?: boolean;
		structuralGround?: string;
		type?: string;
	} = {}
) {
	const declarations = {
		notice_termination_party:
			overrides.party ?? (overrides.reason === 'RESIGNATION' ? 'EMPLOYEE' : 'EMPLOYER'),
		notice_exception: overrides.exception ?? 'NONE',
		notice_approved_apprenticeship: overrides.approvedApprenticeship ?? false,
		notice_structural_ground: overrides.structuralGround ?? 'NONE',
		notice_exception_reference: 'Independent synthetic case',
		notice_given: overrides.given != null,
		notice_given_on: overrides.given ?? '',
		notice_waived_days: overrides.waived ?? 0,
		misconduct_dismissal: overrides.misconduct ?? false
	};
	return {
		employment: {
			type: overrides.type ?? (overrides.domestic ? 'DOMESTIC' : 'PERMANENT'),
			service_start: overrides.hire ?? '2025-01-01',
			exit_date: overrides.exit ?? '2026-01-31',
			exit_ground: overrides.reason ?? 'UNILATERAL',
			exit_facts: declarations,
			exit_fact_keys: Object.keys(declarations)
		},
		terms: {
			monthly_wage: 3000,
			notice_days: overrides.days ?? 28,
			// The saved model puts DOMESTIC in employment_type. Work category is a separate enum.
			statutory_work_category: 'NON_MANUAL'
		}
	};
}

for (const code of ['MY']) {
	const versions: Version[] = JSON.parse(
		readFileSync(
			new URL(`../seed/jurisdiction/${code}/jurisdiction_settings.json`, import.meta.url),
			'utf8'
		)
	);
	const rows: Row[] = JSON.parse(
		readFileSync(
			new URL(`../seed/jurisdiction/${code}/adhoc_catalogue.json`, import.meta.url),
			'utf8'
		)
	);
	for (const row of rows.filter((row) => row.code === 'NOTICE_IN_LIEU')) {
		test(`${code} notice formula ${row.id}: independent interval cases`, () => {
			const pay = (input: Parameters<typeof person>[0] = {}) => {
				const subject = person(input);
				return engine.evaluate(row.eligibility, subject)
					? engine.evaluate(row.bands[0]!.amount, { person: subject })
					: 0;
			};
			assert.equal(pay({ given: '2026-01-04' }), 0);
			assert.equal(pay(), 3000);
			assert.equal(pay({ given: '2026-01-20' }), 1714.29);
			assert.equal(pay({ given: '2026-01-20', waived: 16 }), 0);
			assert.equal(pay({ given: '2026-01-20', waived: 6 }), 1071.43);
			assert.equal(pay({ given: '2026-02-07', exit: '2026-02-23' }), 1116.36);
			assert.equal(pay({ days: 0, domestic: true }), 1500);
			assert.equal(
				pay({ days: 0, hire: '2024-02-01', given: '2026-01-31', exit: '2026-02-15' }),
				1285.71
			);
			assert.equal(pay({ reason: 'REDUNDANCY', days: 14, hire: '2023-05-15' }), 4354.84);
			assert.equal(pay({ reason: 'REDUNDANCY', days: 60, hire: '2023-05-15' }), 6100);
			assert.equal(pay({ reason: 'DISMISSAL', misconduct: true }), 0);
			assert.equal(pay({ reason: 'RESIGNATION' }), 0);
			assert.throws(() => pay({ waived: 29 }), /[Ww]aived/);
		});
		test(`${code} notice routing ${row.id}: actual terminating party and statutory exceptions`, () => {
			const recovery = rows.find(
				(candidate) =>
					candidate.settings_id === row.settings_id && candidate.code === 'NOTICE_INDEMNITY'
			)!;
			const amounts = (input: Parameters<typeof person>[0] = {}) => {
				const subject = person(input);
				return [row, recovery].map((rule) =>
					engine.evaluate(rule.eligibility, subject)
						? engine.evaluate(rule.bands[0]!.amount, { person: subject, entry: { amount: 0 } })
						: 0
				);
			};
			assert.deepEqual(amounts({ party: 'EMPLOYEE', reason: 'RESIGNATION' }), [0, 3000]);
			// The employer may end an already-noticed resignation early: the actor controls routing.
			assert.deepEqual(amounts({ party: 'EMPLOYER', reason: 'RESIGNATION' }), [3000, 0]);
			assert.deepEqual(amounts({ party: 'NEITHER', reason: 'MUTUAL' }), [0, 0]);
			assert.deepEqual(amounts({ exception: 'OTHER_PARTY_WILFUL_BREACH' }), [0, 0]);
			assert.deepEqual(
				amounts({ party: 'EMPLOYEE', reason: 'RESIGNATION', exception: 'IMMEDIATE_DANGER' }),
				[0, 0]
			);
			assert.deepEqual(amounts({ approvedApprenticeship: true }), [0, 0]);
			assert.deepEqual(amounts({ type: 'INTERN', approvedApprenticeship: false }), [3000, 0]);
			// First Schedule para.2(5) excludes domestic employees from s.14; s.57 is separate.
			assert.deepEqual(
				amounts({ domestic: true, days: 0, reason: 'DISMISSAL', misconduct: true }),
				[1500, 0]
			);
			assert.deepEqual(
				amounts({ domestic: true, days: 0, exception: 'DOMESTIC_INCONSISTENT_CONDUCT' }),
				[0, 0]
			);
			// Part XVA remains applicable where s.14 is excluded by the First Schedule.
			assert.deepEqual(
				amounts({ domestic: true, days: 0, exception: 'HARASSMENT_DISMISSAL' }),
				[0, 0]
			);
			// Section 12(3) also covers ownership changes and specified transfer refusals.
			assert.deepEqual(
				amounts({ days: 14, hire: '2023-05-15', structuralGround: 'OWNERSHIP_CHANGE' }),
				[4354.84, 0]
			);
			assert.deepEqual(
				amounts({
					days: 14,
					hire: '2023-05-15',
					structuralGround: 'TRANSFER_REFUSAL_NOT_REQUIRED'
				}),
				[4354.84, 0]
			);
		});
		test(`${code} notice declarations ${row.id}: exception applicability and evidence`, () => {
			const fields = versions.find((version) => version.id === row.settings_id)!.exit_facts;
			assert.ok(
				fields
					.find((field) => field.key === 'notice_exception')!
					.options!.includes('HARASSMENT_DISMISSAL')
			);
			const rule = (
				key: string,
				kind: 'valid_when' | 'required_when',
				input: Parameters<typeof person>[0]
			) => {
				const expression = fields.find((field) => field.key === key)?.[kind];
				assert.ok(expression, `${key}.${kind} must be declared`);
				return engine.evaluate(expression, person(input));
			};
			assert.equal(
				rule('notice_exception', 'valid_when', {
					exception: 'IMMEDIATE_DANGER',
					party: 'EMPLOYEE'
				}),
				true
			);
			assert.equal(
				rule('notice_exception', 'valid_when', {
					exception: 'IMMEDIATE_DANGER',
					party: 'EMPLOYER'
				}),
				false
			);
			assert.equal(
				rule('notice_exception', 'valid_when', {
					exception: 'IMMEDIATE_DANGER',
					party: 'EMPLOYEE',
					domestic: true
				}),
				false
			);
			assert.equal(
				rule('notice_exception', 'valid_when', {
					exception: 'DOMESTIC_INCONSISTENT_CONDUCT',
					domestic: false
				}),
				false
			);
			assert.equal(
				rule('notice_exception', 'valid_when', {
					exception: 'OTHER_PARTY_WILFUL_BREACH',
					approvedApprenticeship: true
				}),
				false
			);
			assert.equal(
				rule('notice_exception_reference', 'required_when', { approvedApprenticeship: true }),
				true
			);
			assert.equal(
				rule('notice_exception_reference', 'required_when', {
					reason: 'DISMISSAL',
					misconduct: true
				}),
				true
			);
			assert.equal(
				rule('notice_exception_reference', 'required_when', {
					exception: 'OTHER_PARTY_WILFUL_BREACH'
				}),
				true
			);
			for (const input of [{}, { domestic: true }, { approvedApprenticeship: true }]) {
				assert.equal(
					rule('notice_exception', 'valid_when', { ...input, exception: 'HARASSMENT_DISMISSAL' }),
					true
				);
			}
			assert.equal(
				rule('notice_exception', 'valid_when', {
					party: 'EMPLOYEE',
					exception: 'HARASSMENT_DISMISSAL'
				}),
				false
			);
			assert.equal(
				rule('notice_exception_reference', 'required_when', { exception: 'HARASSMENT_DISMISSAL' }),
				true
			);
			assert.equal(
				rule('notice_structural_ground', 'valid_when', {
					party: 'EMPLOYEE',
					structuralGround: 'OWNERSHIP_CHANGE'
				}),
				false
			);
			assert.equal(rule('notice_given_on', 'valid_when', {}), true);
			assert.equal(rule('notice_given_on', 'valid_when', { given: '2026-01-04' }), true);
			assert.throws(() => rule('notice_given_on', 'valid_when', { given: '2026-02-30' }));
		});
	}
}
