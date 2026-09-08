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
	},
	{ page: 'payments', family: 'payment', employee: 'myPayments', catalogue: 'cataloguePayments' }
] as const;

for (const { page, family, employee } of families) {
	test(`Controller ${page} registers one family table carrying contract, catalogue and payroll capture`, () => {
		const text = source(`apps/hr_controller/events/+${page}.svelte`);
		assert.deepEqual(registrations(text), ['CollectionTable']);
		assert.match(text, new RegExp(`collection="${family}_requests"`));
		assert.match(text, new RegExp(`${family}_request_employment:`));
		assert.match(text, new RegExp(`${family}_request_${family}_catalogue:`));
		assert.match(
			text,
			new RegExp(
				`payslip_${family}_request_input_${family}_request: \\{ columns: \\{ period: true \\} \\}`
			)
		);
		assert.doesNotMatch(text, /collection="(?:component|bonus|arrears)_/);
	});

	test(`Employee ${family} table stays scoped to the selected contract and carries settlement evidence`, () => {
		const tab = snippet(source('apps/+hr_employee.svelte'), employee);
		assert.deepEqual(registrations(tab), ['CollectionTable']);
		assert.match(tab, new RegExp(`collection="${family}_requests"`));
		assert.match(tab, /employment_id: employmentId \? \{ eq: employmentId \}/);
		assert.match(tab, new RegExp(`payslip_${family}_request_input_${family}_request:`));
		if (family === 'claim') assert.doesNotMatch(tab, /features=\{\{ create: false \}\}/);
		else assert.match(tab, /features=\{\{ create: false \}\}/);
	});
}

test('Controller Events starts at Work and Employee Events exposes the six family tabs vertically', () => {
	const group = source('apps/hr_controller/events/+group.ts');
	assert.match(group, /label: 'Events'/);
	assert.match(group, /defaultChild: 'work'/);
	const page = source('apps/+hr_employee.svelte');
	const events = snippet(page, 'events');
	assert.match(events, /layout="vertical"/);
	assert.deepEqual(
		[...events.matchAll(/name: '([^']+)'/g)].map((match) => match[1]),
		['work', 'leave', 'claim', 'allowance', 'payment', 'loan']
	);
	assert.doesNotMatch(
		page,
		/collection="(?:correction|component|bonus|arrears)_(?:requests|entries)"/
	);
	assert.match(snippet(page, 'paymentEvents'), /eventTable\(myPayments\)/);
});

test('Settings Catalog exposes every family and scopes shared financial catalogue tables by revision', () => {
	const page = source('apps/hr_controller/+settings.svelte');
	const catalogues = snippet(page, 'catalogues');
	assert.deepEqual(
		[...catalogues.matchAll(/name: '([^']+)'/g)].map((match) => match[1]),
		[
			'contribution_catalogue',
			'work_catalogue',
			'leave_catalogue',
			'claim_catalogue',
			'allowance_catalogue',
			'payment_catalogue',
			'loan_catalogue'
		]
	);
	const table = snippet(page, 'catalogueTable');
	assert.deepEqual(registrations(table), ['CollectionTable']);
	assert.match(table, /settings_id: \{ eq: selectedVersion\.id \}/);
	for (const { family, catalogue } of families)
		assert.match(snippet(page, catalogue), new RegExp(`'${family}_catalogue'`));
});
