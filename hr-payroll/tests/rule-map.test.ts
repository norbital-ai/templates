/**
 * Rule map (package MAP), hand-computed over a jurisdiction-free version: the dependency graph is read off the stored
 * expressions alone — declared facts, site members and tables feed the rules and catalogue lines, lines enter a
 * scheme's base through `counts_toward` (a part only where the base names that part), a `produced.<code>` read
 * orders one scheme after another, and every line and scheme reaches the payslip. Tracker rows attach to a node by
 * `config_path`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { adjacent, reach, ruleMap, type RuleMap } from '../src/lib/rule-map/graph.ts';
import { expressionReads } from '../src/lib/rule-map/reads.ts';
import {
	configPathNames,
	parseCsv,
	rowsForNode,
	trackerRows,
	trackerRowsOf
} from '../src/lib/rule-map/tracker.ts';

const MAP = ruleMap({
	version: {
		terms_facts: [{ key: 'grade', type: 'code', table: 'GRADES', label: 'Grade' }],
		tables: [{ name: 'FLOORS' }, { name: 'GRADES' }],
		work_rules: {
			overtime_when: 'terms.facts.grade != ""',
			bands: [
				{
					label: 'OT-A',
					when: 'day_type == "ORDINARY"',
					take_hours: 'hours_beyond_normal',
					price_amount: "hours * table('FLOORS', worksite.region).rate"
				}
			]
		},
		checks: [{ code: 'NET_FLOOR', at: 'PAYSLIP', when: 'payslip.net < 0.0' }]
	},
	schemes: [
		{
			code: 'FUND',
			assessed_on: 'BASE + ORDINARY.ALLOWANCES',
			rules: [{ when: 'base > 0.0', employee: "round(base * 0.1, 0.01, 'HALF_UP')", employer: '0.0' }]
		},
		{
			code: 'LEVY',
			assessed_on: 'BASE + ADHOC - produced.FUND.employee',
			rules: [{ when: '', employee: "band('BRACKETS', base).rate * base", employer: '0.0' }]
		}
	],
	catalogues: {
		allowance_catalogue: [
			{
				code: 'MEAL',
				counts_toward: ['FUND.ORDINARY', 'LEVY'],
				eligibility: 'employee.age >= 18',
				bands: [{ when: '', amount: 'entry.amount', limit: null }]
			},
			{ code: 'TRAVEL', counts_toward: ['FUND.ADDITIONAL'], bands: [{ when: '', amount: 'entry.amount' }] }
		],
		adhoc_catalogue: [{ code: 'BONUS', counts_toward: ['LEVY'], bands: [{ when: '', amount: 'entry.amount' }] }]
	}
});

const has = (map: RuleMap, from: string, to: string) =>
	map.edges.some((edge) => edge.from === from && edge.to === to);

test('rule map: inputs feed the rules and lines that read them', () => {
	assert.ok(has(MAP, 'fact:terms_facts:grade', 'rule:work_rules.overtime_when'));
	assert.ok(has(MAP, 'table:GRADES', 'fact:terms_facts:grade'), 'a code input picks from its table');
	assert.ok(has(MAP, 'table:FLOORS', 'rule:work_rules.bands:OT-A'));
	assert.ok(has(MAP, 'input:worksite.region', 'rule:work_rules.bands:OT-A'));
	assert.ok(has(MAP, 'rule:work_rules.bands:OT-A', 'line:OVERTIME'), 'a band without line/component posts to OVERTIME');
	assert.ok(has(MAP, 'input:employee.age', 'line:MEAL'));
	assert.ok(has(MAP, 'input:entry.amount', 'line:MEAL'));
	assert.equal(
		MAP.nodes.some((node) => node.id === 'input:day_type' || node.id === 'input:hours'),
		false,
		'bare engine values are not inputs'
	);
});

test('rule map: lines enter a base through counts_toward, parts only where the base names the part', () => {
	assert.ok(has(MAP, 'line:MEAL', 'base:FUND'), 'MEAL counts toward FUND.ORDINARY; the base reads ORDINARY.ALLOWANCES');
	assert.equal(has(MAP, 'line:TRAVEL', 'base:FUND'), false, 'TRAVEL counts toward the ADDITIONAL part only');
	assert.equal(has(MAP, 'line:MEAL', 'base:LEVY'), false, 'LEVY reads ADHOC, not ALLOWANCES');
	assert.ok(has(MAP, 'line:BONUS', 'base:LEVY'));
	assert.ok(has(MAP, 'line:BASE', 'base:FUND'), 'a reserved line the base names');
	assert.ok(has(MAP, 'base:FUND', 'scheme:FUND'));
	assert.ok(has(MAP, 'scheme:FUND', 'base:LEVY'), 'produced.FUND orders FUND before LEVY');
	assert.ok(has(MAP, 'table:BRACKETS', 'scheme:LEVY'));
	assert.ok(has(MAP, 'scheme:LEVY', 'payslip'));
	assert.ok(has(MAP, 'check:NET_FLOOR', 'payslip'));
});

test('rule map: upstream and downstream reach', () => {
	const down = reach(MAP, 'fact:terms_facts:grade', 'down');
	assert.ok(down.has('rule:work_rules.overtime_when'));
	assert.ok(down.has('payslip'));
	const up = reach(MAP, 'scheme:LEVY', 'up');
	for (const id of ['base:LEVY', 'scheme:FUND', 'base:FUND', 'line:MEAL', 'input:employee.age', 'line:BONUS'])
		assert.ok(up.has(id), id);
	assert.equal(up.has('line:TRAVEL'), false);
	assert.deepEqual([...adjacent(MAP, 'base:FUND', 'down')], ['scheme:FUND']);
});

test('rule map: expression reads', () => {
	const reads = expressionReads(
		"person.employee.facts.band > 0 && code('MEAL') > year.earned.BONUS && limits.daily > 0 && facts.FUND.status == 'X'"
	);
	assert.deepEqual(reads.facts, [['person_facts', 'band']]);
	assert.deepEqual(reads.lines, ['BONUS', 'MEAL']);
	assert.deepEqual(reads.limits, ['daily']);
	assert.deepEqual(reads.inputs, ['facts.FUND']);
	assert.deepEqual(expressionReads('See https://www.example.org/a.b for the text').paths, []);
});

test('rule map: tracker config paths name nodes', () => {
	assert.ok(configPathNames('statutory_contributions:FUND; terms_facts:grade', 'statutory_contributions:FUND'));
	assert.ok(configPathNames('terms_facts:grade', 'terms_facts:grade'));
	assert.ok(configPathNames('adhoc_catalogue:A,BONUS,C', 'adhoc_catalogue:BONUS'));
	assert.ok(configPathNames('work_rules.overtime_when (the eligibility, note; x)', 'work_rules.overtime_when'));
	assert.ok(configPathNames('work_rules.limits.daily', 'work_rules.limits'));
	assert.equal(configPathNames('work_rules', 'work_rules.overtime_when'), false, 'a whole root marks no node');
	assert.equal(configPathNames('adhoc_catalogue:BONUSES', 'adhoc_catalogue:BONUS'), false);
	const csv =
		'id,profile,area,provision,citation,url,source_checked,effective_from,effective_to,status,reason,config_path,golden,probe,verified_at\n' +
		'XA-1,XA,contribution,"Fund at 10%, capped",c,u,,,,GAP,"a ""quoted""\nreason",statutory_contributions:FUND,,,\n' +
		'XA-2,XA-north,leave,p,c,u,,,,TESTED,,terms_facts:grade,,,\n' +
		'XB-1,XB,leave,p,c,u,,,,GAP,r,statutory_contributions:FUND,,,\n';
	assert.equal(parseCsv(csv).length, 3);
	const rows = trackerRowsOf(trackerRows(csv), { code: 'XA', jurisdiction_code: 'XA' });
	assert.deepEqual(rows.map((row) => row.id), ['XA-1', 'XA-2']);
	assert.equal(rows[0]!.provision, 'Fund at 10%, capped');
	assert.equal(rows[0]!.reason, 'a "quoted"\nreason');
	const fund = MAP.nodes.find((node) => node.id === 'scheme:FUND')!;
	assert.deepEqual(rowsForNode(rows, fund.config).map((row) => row.id), ['XA-1']);
	const grade = MAP.nodes.find((node) => node.id === 'fact:terms_facts:grade')!;
	assert.deepEqual(rowsForNode(rows, grade.config).map((row) => row.id), ['XA-2']);
});
