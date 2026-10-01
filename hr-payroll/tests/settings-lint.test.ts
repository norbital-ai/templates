// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The settings linter (`src/lib/lint/settings-lint.ts`): one hand-built version per fault, each
 * finding computed by hand from the fixture, and then every seeded version, which must carry no
 * error. Nothing below names a jurisdiction.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	lintLineage,
	lintSettingsVersion,
	settingsLintFault
} from '../src/lib/lint/settings-lint.ts';
import { bandSeams, ladderFindings, readRung } from '../src/lib/lint/ladders.ts';
import { seededLineages } from '../scripts/lint-settings.ts';

const OPEN = { from: '2030-01-01', to: null };

const version = (over = {}) => ({
	id: 'v1',
	code: 'X',
	jurisdiction_code: 'X',
	name: 'X 2030',
	sealed_at: null,
	voided_at: null,
	effective_range: OPEN,
	payroll: { currency: 'AAA' },
	facts: [],
	tables: [],
	...over
});

const tree = ({ source = {}, schemes = [], referenceRows = [], ...families } = {}) => ({
	source: version(source),
	schemes,
	catalogueLeaves: [],
	loanCatalogue: [],
	claimCatalogue: [],
	adhocCatalogue: [],
	allowanceCatalogue: [],
	referenceRows,
	...families
});

const scheme = (code, rules, extra = {}) => ({
	code,
	name: code,
	assessed_on: 'BASE',
	elections: [],
	rules,
	...extra
});
const rule = (when, employee, employer = '0.0') => ({ when, employee, employer });
const check = (code, when) => ({ code, at: 'PAYSLIP', when, severity: 'WARN', message: 'm' });
const row = (table, code, values = {}, extra = {}) => ({
	table,
	code,
	effective_range: OPEN,
	range_from: null,
	range_to: null,
	values,
	...extra
});

const RATE = {
	name: 'RATE',
	keys: [],
	columns: [
		{ key: 'employee_percent', type: 'number' },
		{ key: 'share_fraction', type: 'number' }
	]
};
const rateRow = (values = { employee_percent: 5, share_fraction: 0.5 }, extra = {}) =>
	row('RATE', 'ALL', values, extra);

const found = (findings, rule, severity, fragment) =>
	findings.filter(
		(finding) =>
			finding.rule === rule && finding.severity === severity && finding.message.includes(fragment)
	);
const one = (findings, rule, severity, fragment) => {
	const hits = found(findings, rule, severity, fragment);
	assert.equal(
		hits.length,
		1,
		`expected one ${severity} ${rule} "${fragment}", got ${JSON.stringify(findings, null, 1)}`
	);
	return hits[0];
};

test('a clean ladder, rounded and banded without a hole, has no finding', () => {
	const findings = lintSettingsVersion(
		tree({
			schemes: [
				scheme('A', [
					rule('base <= 1000.0', "round(base * 5.0 / 100.0, 0.01, 'HALF_UP')"),
					rule('base > 1000.0', '50.0')
				])
			]
		})
	);
	assert.deepEqual(findings, []);
	assert.equal(settingsLintFault(tree()), null);
});

test('money times a percent never divided by 100 is a type error; dividing it is not', () => {
	const wrong = lintSettingsVersion(
		tree({
			source: { tables: [RATE] },
			referenceRows: [rateRow()],
			schemes: [
				scheme('A', [rule('', "round(base * table('RATE').employee_percent, 0.01, 'HALF_UP')")])
			]
		})
	);
	const finding = one(wrong, 'type', 'error', 'divide the percent by 100');
	assert.equal(finding.where, 'scheme A.rules[0].employee');
	const right = lintSettingsVersion(
		tree({
			source: { tables: [RATE] },
			referenceRows: [rateRow()],
			schemes: [
				scheme('A', [
					rule('', "round(base * table('RATE').employee_percent / 100.0, 0.01, 'HALF_UP')")
				])
			]
		})
	);
	assert.deepEqual(found(right, 'type', 'error', ''), []);
	assert.match(
		settingsLintFault(
			tree({
				source: { tables: [RATE] },
				referenceRows: [rateRow()],
				schemes: [scheme('A', [rule('', "round(base * table('RATE').employee_percent, 1, 'UP')")])]
			})
		),
		/^scheme A\.rules\[0\]\.employee: /
	);
});

test('money added to a fraction is a type error', () => {
	const findings = lintSettingsVersion(
		tree({
			source: { tables: [RATE] },
			referenceRows: [rateRow()],
			schemes: [scheme('A', [rule('', "base + table('RATE').share_fraction")])]
		})
	);
	one(findings, 'type', 'error', 'mixes money with a fraction');
});

test('money times money is a type error unless divided by money: a share of money is money', () => {
	const lint = (employee) =>
		found(
			lintSettingsVersion(tree({ schemes: [scheme('A', [rule('', employee)])] })),
			'type',
			'error',
			''
		);
	one(lint('base * terms.monthly_basic'), 'type', 'error', 'Money is multiplied by money');
	assert.deepEqual(lint('base * (base - terms.monthly_basic) / terms.monthly_basic'), []);
});

test('a date compared with a number or a non-day string is a type error', () => {
	const findings = lintSettingsVersion(
		tree({
			source: {
				checks: [check('NUMBER', 'check.date > 5'), check('WORD', 'period.end < "soon"')]
			}
		})
	);
	one(findings, 'type', 'error', 'A date is compared (`>`) with a number');
	one(findings, 'type', 'error', '"soon", which is not a YYYY-MM-DD day');
});

test('a lookup keyed by a code of another table, and a literal no table row carries, are code errors', () => {
	const findings = lintSettingsVersion(
		tree({
			source: {
				worksite_facts: [{ key: 'region', type: 'code', table: 'REGION' }],
				tables: [
					{ name: 'REGION', keys: ['code'], columns: [] },
					{ name: 'FLOOR', keys: ['code'], columns: [{ key: 'hourly', type: 'number' }] }
				],
				checks: [
					check('KEY', "table('FLOOR', worksite.facts.region).hourly > 0.0"),
					check('LITERAL', "worksite.facts.region == 'NOWHERE'"),
					check('KNOWN', "worksite.facts.region == 'NORTH'")
				]
			},
			referenceRows: [row('REGION', 'NORTH'), row('FLOOR', 'NORTH', { hourly: 5 })]
		})
	);
	one(findings, 'code', 'error', 'keyed by a FLOOR code; this passes a REGION code');
	one(findings, 'code', 'error', 'NOWHERE is not a code of table REGION');
	assert.deepEqual(found(findings, 'code', 'error', 'NORTH'), []);
});

test('table() and band() naming a missing table or the wrong shape are table errors', () => {
	const findings = lintSettingsVersion(
		tree({
			source: {
				tables: [{ name: 'FLAT', keys: [], columns: [{ key: 'v', type: 'number' }] }],
				checks: [
					check('MISSING', "table('MISSING').v > 0.0"),
					check('SHAPE', "band('FLAT', 1.0).v > 0.0")
				]
			},
			referenceRows: [row('FLAT', 'ONE', { v: 1 })]
		})
	);
	one(findings, 'table', 'error', "table('MISSING') names a table this version does not declare");
	one(findings, 'table', 'error', "band('FLAT', …) reads a table without a range");
});

test('band rows: a one-cent seam and a gap are band errors', () => {
	const band = (name, range) => ({
		name,
		keys: [],
		range,
		columns: [{ key: 'amount', type: 'number' }]
	});
	const findings = lintSettingsVersion(
		tree({
			source: {
				tables: [
					band('SEAM', { from_inclusive: false, to_inclusive: true }),
					band('GAP', { from_inclusive: true, to_inclusive: true })
				],
				checks: [check('READ', "band('SEAM', 1.0).amount + band('GAP', 1.0).amount > 0.0")]
			},
			referenceRows: [
				// (0, 100] then (100.01, 200]: 100.01 matches neither
				row('SEAM', 'LOW', { amount: 1 }, { range_from: 0, range_to: 100 }),
				row('SEAM', 'HIGH', { amount: 2 }, { range_from: 100.01, range_to: 200 }),
				// [0, 100] then [101, 200]: 100.01 to 100.99 match neither
				row('GAP', 'LOW', { amount: 1 }, { range_from: 0, range_to: 100 }),
				row('GAP', 'HIGH', { amount: 2 }, { range_from: 101, range_to: 200 })
			]
		})
	);
	one(findings, 'band', 'error', '100.01 matches no band');
	const gap = one(findings, 'band', 'error', 'no band holds the values between them');
	assert.equal(gap.where, 'table GAP');
	assert.deepEqual(
		bandSeams({ from_inclusive: true, to_inclusive: false }, [
			{ code: 'A', from: 0, to: 100 },
			{ code: 'B', from: 100, to: 200 }
		]),
		[]
	);
	assert.equal(
		bandSeams({ from_inclusive: false, to_inclusive: false }, [
			{ code: 'A', from: 0, to: 100 },
			{ code: 'B', from: 100, to: 200 }
		]).length,
		1
	);
});

test('schemes reading each other round a loop, and a produced mention of no scheme, are cycle errors', () => {
	const findings = lintSettingsVersion(
		tree({
			schemes: [
				scheme('A', [rule('', 'produced.B.employee')]),
				scheme('B', [rule('', 'produced.A.employee')]),
				scheme('C', [rule('', 'produced.Z.employee')])
			]
		})
	);
	one(findings, 'cycle', 'error', 'A → B → A');
	one(findings, 'cycle', 'error', 'produced.Z names a scheme this version does not have');
});

test('a read of an undeclared input is an error; a declared input nothing reads is a warning', () => {
	const findings = lintSettingsVersion(
		tree({
			source: {
				terms_facts: [
					{ key: 'grade', type: 'string' },
					{ key: 'unused', type: 'number' }
				],
				checks: [check('READ', "terms.facts.grade == 'X' && terms.facts.ghost > 0.0")]
			}
		})
	);
	one(findings, 'fact', 'error', 'reads terms.facts.ghost, which is not declared');
	one(findings, 'fact', 'warning', 'unused is declared but');
	assert.deepEqual(found(findings, 'fact', 'warning', 'grade'), []);
});

test('a rule an earlier rule always takes, or that can never hold, is unreachable; a cent between rungs is a hole', () => {
	const findings = lintSettingsVersion(
		tree({
			schemes: [
				scheme('A', [
					rule('base > 0.0', '1.0'),
					rule('base > 100.0 && base <= 200.0', '2.0'),
					rule('person.employee.age < 75 && person.employee.age >= 75', '3.0')
				]),
				scheme('B', [rule('base <= 100.0', '1.0'), rule('base > 100.01 && base <= 200.0', '2.0')])
			]
		})
	);
	one(findings, 'unreachable', 'warning', 'Rule 2: Rule 1 matches every case it does');
	one(findings, 'unreachable', 'warning', 'Rule 3: Its condition can never hold');
	const hole = one(findings, 'unreachable', 'warning', 'one-cent seam');
	assert.equal(hole.where, 'scheme B rules[1].when');
	// an integer subject on both-inclusive bounds is contiguous: age <= 59 then age >= 60
	assert.deepEqual(
		ladderFindings(['person.employee.age <= 59', 'person.employee.age >= 60'], () => false),
		[]
	);
	assert.equal(readRung('base > 1.0 && base < 1.0')?.never, true);
});

test('a money result computed by * and never rounded is a rounding warning', () => {
	const findings = lintSettingsVersion(
		tree({ schemes: [scheme('A', [rule('', 'base * 5.0 / 100.0')])] })
	);
	one(findings, 'rounding', 'warning', 'never rounded');
});

test('min() of a company term and a statutory floor is a floor warning; max() is not', () => {
	const derived = (amount) => ({ work_rules: { derived_lines: [{ code: 'TOP', amount }] } });
	one(
		lintSettingsVersion(tree({ source: derived('min(terms.basic_salary, wage_floor)') })),
		'floor',
		'warning',
		'terms.basic_salary can undercut wage_floor'
	);
	one(
		lintSettingsVersion(
			tree({
				source: derived('terms.basic_salary < wage_floor ? terms.basic_salary : wage_floor')
			})
		),
		'floor',
		'warning',
		'can undercut'
	);
	assert.deepEqual(
		found(
			lintSettingsVersion(tree({ source: derived('max(terms.basic_salary, wage_floor)') })),
			'floor',
			'warning',
			''
		),
		[]
	);
});

test('table rows that leave days of their version uncovered are a range warning', () => {
	const findings = lintSettingsVersion(
		tree({
			source: { tables: [RATE], checks: [check('READ', "table('RATE').share_fraction > 0.0")] },
			referenceRows: [rateRow(undefined, { effective_range: { from: '2030-02-01', to: null } })]
		})
	);
	one(
		findings,
		'range',
		'warning',
		'No row is in force 2030-01-01 to 2030-01-31 inside its version'
	);
});

test('a percent column holding only fractions is a table warning', () => {
	const findings = lintSettingsVersion(
		tree({
			source: { tables: [RATE], checks: [check('READ', "table('RATE').share_fraction > 0.0")] },
			referenceRows: [rateRow({ employee_percent: 0.05, share_fraction: 0.5 })]
		})
	);
	one(findings, 'table', 'warning', 'read as fractions');
});

test('lineage versions: a gap and an overlap are range errors; an ending last version is a warning', () => {
	const sealed = (name, from, to) => ({
		code: 'X',
		name,
		sealed_at: '2029-12-01T00:00:00Z',
		voided_at: null,
		effective_range: { from, to }
	});
	const gap = lintLineage([
		sealed('A', '2030-01-01', '2030-06-30'),
		sealed('B', '2030-08-01', null)
	]);
	one(gap, 'range', 'error', 'No version governs 2030-07-01 to 2030-07-31');
	const overlap = lintLineage([
		sealed('A', '2030-01-01', '2030-06-30'),
		sealed('C', '2030-06-01', null)
	]);
	one(overlap, 'range', 'error', 'both govern the same days');
	one(
		lintLineage([sealed('A', '2030-01-01', '2030-12-31')]),
		'range',
		'warning',
		'ends 2030-12-31'
	);
	// a voided version governs nothing; the seed form's half-open end meets its successor
	assert.deepEqual(
		lintLineage([
			{ ...sealed('V', '2030-01-01', null), voided_at: '2030-01-02T00:00:00Z' },
			{
				...sealed('A', '', ''),
				effective_range: { start: '2030-01-01T00:00:00.000Z', end: '2030-07-01T00:00:00.000Z' }
			},
			sealed('B', '2030-07-01', null)
		]),
		[]
	);
});

test('every seeded settings version lints without an error', (t) => {
	const errors = [];
	for (const { lineage, versions, trees } of seededLineages()) {
		const warnings = new Map();
		const count = (finding) => warnings.set(finding.rule, (warnings.get(finding.rule) ?? 0) + 1);
		for (const finding of lintLineage(versions))
			if (finding.severity === 'error')
				errors.push(`${lineage} ${finding.where}: ${finding.message}`);
			else count(finding);
		for (const { name, tree: seeded } of trees)
			for (const finding of lintSettingsVersion(seeded))
				if (finding.severity === 'error')
					errors.push(`${name} ${finding.where}: ${finding.message}`);
				else count(finding);
		t.diagnostic(
			`${lineage}: ${trees.length} versions; warnings ${[...warnings].map(([rule, n]) => `${rule} ${n}`).join(', ') || 'none'}`
		);
	}
	assert.deepEqual(errors.slice(0, 40), [], `${errors.length} settings errors`);
});
