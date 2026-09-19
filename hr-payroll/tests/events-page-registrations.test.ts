import assert from 'node:assert/strict';
import test from 'node:test';
import { registrations, snippet, source } from './helpers/page-source.ts';

const families = [
	{ page: 'claims', family: 'claim' },
	{ page: 'adhoc', family: 'adhoc' }
] as const;

for (const { page, family } of families) {
	test(`Controller ${page} registers one family table carrying contract, catalogue and payroll capture`, () => {
		const text = source(`apps/hr_controller/events/+${page}.svelte`);
		// One table stepped by pay period, its capture the row's own pin.
		assert.deepEqual(registrations(text), ['CollectionTable']);
		assert.match(text, /createPayPeriodScope\(/);
		assert.match(text, /gte: pay\.bounds\.start, lt: pay\.bounds\.end/);
		assert.match(text, /pay_period: \{ eq: pay\.period \}/);
		assert.match(text, new RegExp(`collection="${family}_requests"`));
		assert.match(text, new RegExp(`${family}_request_employment:`));
		assert.match(text, new RegExp(`${family}_request_${family}_catalogue:`));
		assert.match(text, /row\.payslip_id == null/);
		assert.match(text, /payRequestRecordMetadata\(/);
		assert.doesNotMatch(text, /collection="(?:component|bonus|arrears|allowance)_/);
	});
}

test('Employee claim table stays scoped to the selected contract and carries settlement evidence', () => {
	const tab = snippet(source('apps/+hr_employee.svelte'), 'myClaims');
	assert.deepEqual(registrations(tab), ['CollectionTable']);
	assert.match(tab, /collection="claim_requests"/);
	assert.match(tab, /employment_id: employmentId \? \{ eq: employmentId \}/);
	assert.match(tab, /payRequestRecordMetadata\(row\.approval_id, capturesOf\(row\), t\)/);
	assert.doesNotMatch(tab, /features=\{\{ create: false \}\}/);
});

test('Controller Events starts at Work and Employee Events exposes the four family tabs vertically', () => {
	const group = source('apps/hr_controller/events/+group.ts');
	assert.match(group, /label: 'Events'/);
	assert.match(group, /defaultChild: 'work'/);
	const page = source('apps/+hr_employee.svelte');
	const events = snippet(page, 'events');
	assert.match(events, /layout="vertical"/);
	assert.deepEqual(
		[...events.matchAll(/name: '([^']+)'/g)].map((match) => match[1]),
		['work', 'leave', 'claim', 'loan']
	);
	// Employees neither request nor see allowances as events: an allowance is on the contract.
	assert.doesNotMatch(
		page,
		/collection="(?:correction|component|bonus|arrears|allowance)_(?:requests|entries)"|collection="allowances"/
	);
});

test('Settings hoists schemes out of Catalog, and scopes shared financial catalogue tables by revision', () => {
	const page = source('apps/hr_controller/+settings.svelte');
	// The schemes, the work rules and the monetary catalogue families are tabs of their own.
	assert.match(page, /content: contributions/);
	assert.match(page, /content: workRules/);
	assert.doesNotMatch(page, /content: scheduling/, 'scheduling belongs to the entity');
	const catalogues = snippet(page, 'catalogues');
	assert.deepEqual(
		[...catalogues.matchAll(/name: '([^']+)'/g)].map((match) => match[1]),
		[
			'leave_catalogue',
			'claim_catalogue',
			'allowance_catalogue',
			'adhoc_catalogue',
			'loan_catalogue'
		]
	);
	const table = snippet(page, 'catalogueTable');
	assert.deepEqual(registrations(table), ['CollectionTable']);
	assert.match(table, /settings_id: \{ eq: selectedVersion\.id \}/);
	for (const [family, catalogue] of [
		['claim', 'catalogueClaims'],
		['adhoc', 'catalogueAdhoc'],
		['allowance', 'catalogueAllowances']
	])
		assert.match(snippet(page, catalogue), new RegExp(`'${family}_catalogue'`));
});
