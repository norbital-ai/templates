import assert from 'node:assert/strict';
import test from 'node:test';
import { registrations, snippet, source } from './helpers/page-source.ts';

const families = [
	{ page: 'claims', family: 'claim', employee: 'myClaims', catalogue: 'catalogueClaims' },
	{
		page: 'allowances',
		family: 'allowance',
		employee: 'myAllowances',
		catalogue: 'catalogueAllowances'
	}
] as const;

for (const { page, family, employee } of families) {
	test(`Controller ${page} registers one family table carrying contract, catalogue and payroll capture`, () => {
		const text = source(`apps/hr_controller/events/+${page}.svelte`);
		// Allowances are the standing sources and, stepped by pay period, the entries payroll
		// priced from them; a claim is one table stepped the same way.
		assert.deepEqual(
			registrations(text),
			family === 'allowance' ? ['CollectionTable', 'CollectionTable'] : ['CollectionTable']
		);
		assert.match(text, /createPayPeriodScope\(/);
		assert.match(text, /gte: pay\.bounds\.start, lt: pay\.bounds\.end/);
		if (family === 'allowance') {
			assert.match(text, /collection="allowances"/);
			assert.match(text, /collection="allowance_entries"/);
			assert.match(text, /allowance_employment:/);
			assert.match(text, /allowance_entry_allowance_catalogue:/);
		} else {
			assert.match(text, /pay_period: \{ eq: pay\.period \}/);
			assert.match(text, new RegExp(`collection="${family}_requests"`));
			assert.match(text, new RegExp(`${family}_request_employment:`));
			assert.match(text, new RegExp(`${family}_request_${family}_catalogue:`));
			assert.match(text, /row\.payslip_id == null/);
		}
		assert.match(text, /payRequestRecordMetadata\(/);
		assert.doesNotMatch(text, /collection="(?:component|bonus|arrears)_/);
	});

	test(`Employee ${family} table stays scoped to the selected contract and carries settlement evidence`, () => {
		const tab = snippet(source('apps/+hr_employee.svelte'), employee);
		assert.deepEqual(registrations(tab), ['CollectionTable']);
		assert.match(
			tab,
			new RegExp(`collection="${family === 'allowance' ? 'allowances' : `${family}_requests`}"`)
		);
		assert.match(tab, /employment_id: employmentId \? \{ eq: employmentId \}/);
		// An allowance is a standing source and carries no pin of its own; its entries do.
		assert.match(
			tab,
			family === 'allowance'
				? /payRequestRecordMetadata\(row\.approval_id, \[\], t\)/
				: /payRequestRecordMetadata\(row\.approval_id, capturesOf\(row\), t\)/
		);
		if (family === 'claim') assert.doesNotMatch(tab, /features=\{\{ create: false \}\}/);
		else assert.match(tab, /features=\{\{ create: false \}\}/);
	});
}

test('Controller Events starts at Work and Employee Events exposes the five family tabs vertically', () => {
	const group = source('apps/hr_controller/events/+group.ts');
	assert.match(group, /label: 'Events'/);
	assert.match(group, /defaultChild: 'work'/);
	const page = source('apps/+hr_employee.svelte');
	const events = snippet(page, 'events');
	assert.match(events, /layout="vertical"/);
	assert.deepEqual(
		[...events.matchAll(/name: '([^']+)'/g)].map((match) => match[1]),
		['work', 'leave', 'claim', 'allowance', 'loan']
	);
	assert.doesNotMatch(
		page,
		/collection="(?:correction|component|bonus|arrears)_(?:requests|entries)"/
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
		['leave_catalogue', 'claim_catalogue', 'allowance_catalogue', 'loan_catalogue']
	);
	const table = snippet(page, 'catalogueTable');
	assert.deepEqual(registrations(table), ['CollectionTable']);
	assert.match(table, /settings_id: \{ eq: selectedVersion\.id \}/);
	for (const { family, catalogue } of families)
		assert.match(snippet(page, catalogue), new RegExp(`'${family}_catalogue'`));
});
