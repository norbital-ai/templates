import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { leaveRules } from '../src/lib/leave/context.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { id, leaveContext, submission, timeOff } from './helpers/manual-leave-context.ts';

const catalogue = JSON.parse(
	readFileSync(new URL('../seed/jurisdiction/SG/leave_catalogue.json', import.meta.url), 'utf8')
);

function sgLeave(code: string, hire: string) {
	const context = leaveContext();
	Object.assign(context.employments[0]!, { effective_range: { start: hire, end: null } });
	Object.assign(context.terms[0]!, { effective_range: { start: hire, end: null } });
	Object.assign(context.companies[0]!, { settings_code: 'SG' });
	Object.assign(context.versions[0]!, { code: 'SG', jurisdiction_code: 'SG' });
	const seeded = catalogue.find((row: { code: string }) => row.code === code)!;
	Object.assign(context.catalogues[0]!, {
		code,
		eligibility: seeded.eligibility,
		entitlement: seeded.entitlement,
		consumes_code: seeded.consumes_code ?? null,
		evidence_after_days: seeded.evidence_after_days ?? null
	});
	return { context, rules: leaveRules(context, id(1), id(7)) };
}

test('SG outpatient and hospital leave open on exact completed service-month dates', () => {
	for (const [code, ladder] of [
		['SICK_LEAVE', [5, 8, 11, 14]],
		['HOSPITALIZATION_LEAVE', [15, 30, 45, 60]]
	] as const) {
		const { rules } = sgLeave(code, '2026-02-13');
		assert.equal(rules.eligibleOn('2026-05-12'), false);
		for (const [index, date] of [
			'2026-05-13',
			'2026-06-13',
			'2026-07-13',
			'2026-08-13'
		].entries()) {
			assert.equal(rules.eligibleOn(date), true);
			assert.equal(
				rules.entitlementAt({ start: '2026-01-01', end: '2026-12-31' }, date).available,
				ladder[index]
			);
		}
	}
});

test('SG childcare take gate opens after three complete months; the service year is calendar by default', () => {
	const { context } = sgLeave('CHILDCARE_LEAVE', '2026-01-01');
	Object.assign(context.employees[0]!, {
		children: [{ child_birthdate: '2020-06-01', relationship: 'CHILD', citizenship: 'CITIZEN' }]
	});
	const fresh = leaveRules(context, id(1), id(7));
	assert.equal(fresh.eligibleOn('2026-03-31'), false);
	assert.equal(fresh.eligibleOn('2026-04-01'), true);
	assert.equal(
		fresh.entitlementAt({ start: '2026-01-01', end: '2026-12-31' }, '2026-04-01').available,
		6
	);
});

test('SG annual approval refuses a 29 February hire pending a service-anniversary convention', () => {
	const { context } = sgLeave('ANNUAL_LEAVE', '2024-02-29');
	assert.throws(
		() => planLeaveActivity(context, submission(timeOff('2026-04-01')), id(300)),
		/29 February hire/
	);
});
