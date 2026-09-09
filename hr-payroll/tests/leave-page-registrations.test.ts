import assert from 'node:assert/strict';
import test from 'node:test';
import { registrations, snippet, source } from './helpers/page-source.ts';

test('Controller Events Leave registers one contract-scoped immutable activity table', () => {
	const page = source('apps/hr_controller/events/+leave.svelte');
	assert.deepEqual(registrations(page), ['CollectionTable']);
	assert.match(page, /collection="leave_entries"/);
	assert.match(page, /leave_entry_employment: \{ some: \{ company_id: \{ eq: selectedCompanyId \}/);
	assert.match(page, /operations: \['update', 'delete'\]/);
	assert.match(page, /<Column name="event"/);
	assert.doesNotMatch(page, /leave_entitlements|entry_leave_entitlement|request_leave_entitlement/);
});

test('Settings Leave catalogue is one table over the selected settings revision', () => {
	const tab = snippet(source('apps/hr_controller/+settings.svelte'), 'catalogueLeaves');
	assert.deepEqual(registrations(tab), ['CollectionTable']);
	assert.match(tab, /collection="leave_catalogue"/);
	assert.match(tab, /settings_id: \{ eq: selectedVersion\.id \}/);
	assert.match(tab, /<Column name="paid"/);
});

test('Employee Leave combines one computed balance query with a contract-scoped activity table', () => {
	const page = source('apps/+hr_employee.svelte');
	assert.equal([...page.matchAll(/client\.invoke\.leave_balances\(/g)].length, 1);
	assert.match(
		page,
		/client\.invoke\.leave_balances\(\{\s*employment_id: employmentId,\s*as_of: today/
	);
	assert.doesNotMatch(page, /leave_entitlements|entry_leave_entitlement|request_leave_entitlement/);
	const tab = snippet(page, 'leave');
	assert.deepEqual(registrations(tab), ['CollectionTable']);
	assert.match(tab, /collection="leave_entries"/);
	assert.match(tab, /employment_id: employmentId \? \{ eq: employmentId \}/);
	assert.match(tab, /payslip_leave_input_leave_entry: \{ columns: \{ period: true \} \}/);
	assert.match(tab, /operations: \['update', 'delete'\]/);
});
