/**
 * Statutory research's merge rules as pure functions over a small synthetic snapshot: an agent drafts from and merges
 * back only the rows it owns; a changed row carries only the fresh evidence its own references cite; a quote holds
 * only on a registered official site whose page carries its words.
 */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Result, Schema } from 'effect';
import { agentDraft, mergeAgent, SnapshotSchema } from '../src/lib/payroll_engine/statutory_snapshot.ts';
import {
	changeSummary,
	quotePresent,
	rowChanges,
	sourcesFrom,
	unverifiedQuotes
} from '../src/lib/payroll_engine/statutory_drift.ts';

const rule = (family: string, code: string, name = code) => ({
	scope: 'JURISDICTION',
	family,
	code,
	name,
	rules: {}
});
const snapshot = (rules: readonly ReturnType<typeof rule>[]) =>
	Schema.decodeUnknownSync(SnapshotSchema)({
		settings: { code: 'XX', jurisdiction_code: 'XX', name: 'Fixture', payroll: {} },
		adhoc_catalog: [],
		allowance_catalog: [],
		claim_catalog: [],
		leave_catalog: [],
		loan_catalog: [],
		work_catalog: [],
		statutory_contribution_catalog: [],
		suspension_kind: [],
		rule_set: rules,
		behaviour_rule: []
	});
const merged = snapshot([rule('PAYROLL', 'retention'), rule('TASKS', 'filing')]);
const names = (value: typeof merged) => value.rule_set.map((row) => [row.code, row.name]);

it('an agent drafts from its own rows only', () => {
	const rules = agentDraft(merged, 'rules');
	assert.deepEqual(
		rules.rule_set.map((row) => row.code),
		['retention']
	);
	assert.equal(rules.settings, undefined);
	assert.deepEqual(agentDraft(merged, 'settings').rule_set, []);
	assert.equal(agentDraft(merged, 'settings').settings?.code, 'XX');
});

it("an agent's answer merges only its own rows: edits in place, additions after, another agent's rows untouched", () => {
	const answer = snapshot([
		rule('PAYROLL', 'retention', 'Retention (edited)'),
		rule('TASKS', 'filing', 'Filing (edited)'),
		rule('VALIDATIONS', 'minimum_wage')
	]);
	assert.deepEqual(names(mergeAgent(merged, 'rules', answer)), [
		['retention', 'Retention (edited)'],
		['filing', 'filing'],
		['minimum_wage', 'minimum_wage']
	]);
	// the catalog agent owns no rule_set row: nothing of its rule_set edit is taken
	assert.deepEqual(names(mergeAgent(merged, 'catalog', answer)), names(merged));
	// an own row left out of the answer is removed
	assert.deepEqual(names(mergeAgent(merged, 'rules', snapshot([]))), [['filing', 'filing']]);
});

it('a changed row carries only the evidence its own references newly cite; a removed row refuses', () => {
	const cite = { url: 'https://labour.example.gov/act', quote: 'Records are kept for seven years.' };
	const before = { rule_set: [{ code: 'retention', references: [cite] }] };
	const after = {
		rule_set: [
			{ code: 'retention', name: 'Renamed', references: [cite] },
			{ code: 'added', references: [cite, { url: cite.url, quote: 'A new clause.' }] }
		]
	};
	const changes = rowChanges(before, after, [
		{ path: '/rule_set/retention/name' },
		{ path: '/rule_set/added' }
	]);
	assert.ok(Result.isSuccess(changes));
	assert.deepEqual(changes.success, [
		{ section: 'rule_set', code: 'retention', added: false, fields: ['name'], evidence: [] },
		{
			section: 'rule_set',
			code: 'added',
			added: true,
			fields: [],
			evidence: [cite, { url: cite.url, quote: 'A new clause.' }]
		}
	]);
	assert.equal(
		changeSummary(changes.success, 'Restore retention.'),
		'rule_set: changed retention (name); added added\n\nRestore retention.'
	);
	const removed = rowChanges(before, { rule_set: [] }, [{ path: '/rule_set/retention' }]);
	assert.ok(Result.isFailure(removed));
	assert.equal(removed.failure, 'removed rule_set/retention');
});

it('a quote holds only on a registered official site whose page carries its words, in order', () => {
	const sources = sourcesFrom({
		entries: [{ agent: 'rules', url: 'https://labour.example.gov/act', instructions: 'The Act.' }]
	});
	const quote = 'Payroll records must be kept for the statutory retention period.';
	assert.equal(quotePresent(`[Page 1] Payroll records must be\nkept for the statutory retention period.`, quote), true);
	assert.equal(quotePresent('Payroll records ... retention period', 'Payroll records … retention period'), true);
	assert.equal(quotePresent('An unrelated bulletin.', quote), false);
	const onSite = { url: 'https://cdn.example.gov/act.html', quote };
	const offSite = { url: 'https://example.invalid/law', quote };
	const missing = { url: 'https://labour.example.gov/other', quote };
	assert.deepEqual(
		unverifiedQuotes(
			[
				{ url: onSite.url, title: null, text: quote },
				{ url: offSite.url, title: null, text: quote }
			],
			[onSite, offSite, missing],
			sources
		),
		[offSite, missing]
	);
});
