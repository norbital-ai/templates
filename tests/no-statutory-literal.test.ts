/**
 * Calculation rule (docs/inventory/README.md): every statutory rate, band, cap, floor, divisor,
 * threshold, age and rounding step lives in the stored runtime objects — rule expressions and band
 * rows of settings versions and catalogues. The engine only evaluates them, so a numeric literal in
 * the engine is a structural constant with a reason below, or a defect.
 *
 * Walks the engine sources with the TypeScript AST, as tests/no-jurisdiction-code.test.ts does.
 * Every failure names the file, the line and the literal.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const root = at('');
const rel = (path: string) => path.slice(root.length);

/** Every file under `dir`, recursively. */
const walk = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = `${dir}/${entry.name}`;
		return entry.isDirectory() ? walk(path) : [path];
	});

const ENGINE = [
	...[
		'src/lib/payroll',
		'src/lib/leave',
		'src/lib/scheduling',
		'src/lib/expressions',
		'src/lib/benefit-cases',
		'src/data/collection'
	].flatMap((dir) => walk(at(dir))),
	...readdirSync(at('src/lib'))
		.filter((name) => name.endsWith('.ts'))
		.map((name) => at(`src/lib/${name}`))
].filter((file) => file.endsWith('.ts'));

/** Files outside the calculation, each with its reason. */
const SKIPPED: Record<string, string> = {
	'src/lib/payroll/run/export.ts': 'PDF/XLSX byte layout of computed lines: rows, columns, points',
	'src/lib/leave/balance-report.ts': 'XLSX layout of computed leave balances: rows, columns, widths'
};

/** Magnitudes allowed anywhere, each with its reason. */
const STRUCTURAL = new Map<number, string>([
	[0, 'zero, first index'],
	[1, 'identity, step, next or previous index'],
	[7, 'days a week'],
	[12, 'months a year'],
	[23, 'the last hour of a clock day'],
	[24, 'hours a day'],
	[31, 'the last possible day of a calendar month'],
	[59, 'the last minute of an hour'],
	[60, 'minutes an hour, seconds a minute'],
	[1440, 'minutes a day'],
	[60_000, 'milliseconds a minute'],
	[3_600_000, 'milliseconds an hour'],
	[86_400_000, 'milliseconds a day'],
	[100, 'percent, cents of a major unit'],
	[1000, 'fraction precision'],
	[10_000, 'fraction precision'],
	[1e6, 'fraction precision'],
	[0.001, 'float tolerance'],
	[1e-6, 'float tolerance'],
	[1e-7, 'float epsilon'],
	[1e-9, 'float epsilon']
]);

/** 28–30 bound a calendar month only as a loop's own bounds. */
const MONTH_LOOP_BOUND = new Set([28, 29, 30]);

/** Named bounds of a read, a cache, a message or a matching window, each with its reason. */
const NAMED_LIMITS: Record<string, string> = {
	PAGE_LIMIT: 'rows a read page takes under the 4 MiB crossing answer',
	WIDE_ROWS: 'rows a whole-row read page takes under the 4 MiB crossing answer',
	RUN_PAGE_PEOPLE: "people's run traces one read page holds under the crossing answer",
	PRODUCED_OF_CACHE_CAP: 'memo entries kept in memory',
	ASSESSED_ON_CACHE_CAP: 'memo entries kept in memory',
	MENTION_CACHE_CAP: 'memo entries kept in memory',
	PROGRAM_CAP: 'compiled programs kept in memory',
	DETAILED_ISSUE_LIMIT: 'issues a message lists',
	PERSONS_PER_BULLET: 'people a message bullet lists',
	PROBLEM_LIMIT: 'problems a message lists',
	GRID_DAYS: 'six displayed weeks of a month grid',
	PROJECTION_DAYS: 'days a shift pattern is projected ahead',
	LOOKBACK_MINUTES: 'how far back a punch pairs with its shift',
	ANNUAL_LOOKBACK_DAYS: 'two leave years of at most 366 days a holiday and attendance read spans',
	VARIADIC_ARITY: 'the argument counts a CEL overload family registers (CEL has no variadics)',
	TABLE_KEY_ARITY: 'the key counts a table lookup overload family registers'
};

/**
 * Per-file structural literals, by source text, each with its reason. A statutory figure never
 * belongs here: it belongs in a settings version or a catalogue row.
 */
const SEMI_MONTHLY = "a semi-monthly month's two instalments; a weekly month has four or five";
const SITES: Record<string, Record<string, string>> = {
	'src/lib/payroll/world.ts': {
		'2_000_000': 'the byte budget of one read crossing (the host caps a crossing at 4 MiB)',
		'50_000': 'the measured bytes a payroll run carries per employment'
	},
	'src/lib/payroll/run/dates.ts': Object.fromEntries(
		// Hinnant's days-from-civil: era, leap, month-shift and Monday-shift constants.
		['2', '3', '4', '5', '6', '9', '10', '100', '153', '365', '366', '399', '400', '1460']
			.concat(['36524', '146096', '146097', '719468'])
			.map((text) => [text, 'Gregorian civil-day arithmetic'])
	),
	'src/lib/payroll/contribution.ts': { '2': SEMI_MONTHLY },
	'src/lib/payroll/families.ts': { '2': SEMI_MONTHLY },
	'src/lib/payroll/work.ts': { '2': SEMI_MONTHLY },
	'src/lib/payroll/work-bands.ts': { '3': 'months a calendar quarter' },
	'src/lib/payroll/history.ts': { '2': SEMI_MONTHLY },
	'src/lib/payroll/run/engine.ts': { '2': SEMI_MONTHLY },
	'src/lib/payroll/run/export-data.ts': { '2': 'display precision of a printed figure' },
	'src/lib/payroll/run/contribute.ts': {
		'2': SEMI_MONTHLY,
		'4': SEMI_MONTHLY,
		'3': 'months a quarter of an assessment year'
	},
	'src/lib/payroll/run/period.ts': {
		'2': SEMI_MONTHLY,
		'11': 'the last month of a twelve-month year',
		'15': 'a semi-monthly month’s first instalment ends on the 15th',
		'16': 'a semi-monthly month’s second instalment starts on the 16th'
	},
	'src/lib/payroll/run/rounding.ts': {
		'4': 'float epsilon scale',
		'20': 'the stored UP_5_CENTS mode: twentieths of a unit',
		'2': 'the half-day rounding primitive',
		'0.5': 'the half a HALF_UP or HALF_EVEN mode rounds at'
	},
	'src/lib/payroll/run/validate.ts': { '3': 'months a quarter' },
	'src/lib/scheduling/work-limits.ts': {
		'2': 'the last month of a quarter; a period width rank',
		'3': 'months a quarter; a period width rank',
		'4': 'a period width rank'
	},
	'src/lib/leave/activity.ts': { '0.5': 'a half day', '2': 'two halves a day' },
	'src/lib/leave/context.ts': { '0.5': 'a half day' },
	'src/lib/leave/preview.ts': { '0.5': 'a half day' },
	'src/lib/leave/entitlement.ts': { '0.5': 'round half up in the stored WHOLE_DAY mode' },
	'src/lib/leave/calendar-grid.ts': { '-6': "Sunday's offset to its week's Monday" },
	'src/lib/expressions/evaluate.ts': {
		'2': 'a progressive rung is [from, base, rate]',
		'3': 'a progressive rung is [from, base, rate]'
	},
	'src/lib/expressions/person-functions.ts': { '9999': 'the last four-digit ISO year' },
	'src/lib/holiday-import.ts': {
		'9998': 'the last four-digit ISO year before a year-end sentinel',
		'20': 'pages of a holiday feed read',
		'366': 'a feed event spans at most one year'
	},
	'src/lib/half-day.ts': { '2': 'two half-day slots a day' },
	'src/lib/late-arrival.ts': {
		'2': 'UTC days a local day can touch',
		'-2': 'UTC days a local day can touch'
	},
	'src/lib/loan-schedule.ts': {
		'0.01': 'a cent of tolerance on a stated schedule',
		'600': 'months a schedule may run'
	},
	'src/lib/period.ts': { '20': 'periods a picker lists' },
	'src/lib/statutory-deductions.ts': { '2': 'the year before last' },
	'src/data/collection/work_days/+collection.ts': { '2': 'hours are entered in half-hour steps' },
	'src/data/collection/work_days/lib/import-month-grid.ts': {
		'2': 'hours are entered in half-hour steps'
	},
	'src/data/collection/work_days/lib/import-workbook.ts': {
		'2': 'hours are entered in half-hour steps'
	},
	'src/data/collection/work_days/lib/import-month.ts': {
		'6': 'write retries',
		'8': 'names a message lists'
	}
};

/** String methods whose numeric arguments address the layout of an ISO date or a code. */
const STRING_LAYOUT = new Set([
	'slice',
	'substring',
	'padStart',
	'padEnd',
	'repeat',
	'charAt',
	'at'
]);

/** Properties whose number is a read bound, a column's precision or a progress fraction. */
const STRUCTURAL_PROPERTY: Record<string, string> = {
	limit: 'rows a read takes',
	scale: "a decimal column's precision",
	ratio: 'a progress fraction'
};

/** ISO 4217 minor digits: a literal is only the other branch of a currency's own digits. */
const MINOR_DIGITS = /minorDigits|fractionDigits/i;

const K = ts.SyntaxKind;
const COMPARISON = new Set([
	K.EqualsEqualsEqualsToken,
	K.ExclamationEqualsEqualsToken,
	K.LessThanToken,
	K.LessThanEqualsToken,
	K.GreaterThanToken,
	K.GreaterThanEqualsToken
]);

/** The literal's value and the node that carries its sign. */
function signed(literal: ts.NumericLiteral): { value: number; node: ts.Expression } {
	const parent = literal.parent;
	const value = Number(literal.text.replaceAll('_', ''));
	return ts.isPrefixUnaryExpression(parent) && parent.operator === K.MinusToken
		? { value: -value, node: parent }
		: { value, node: literal };
}

const numeric = (node: ts.Node): number | null =>
	ts.isNumericLiteral(node)
		? signed(node).value
		: ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)
			? signed(node.operand).value
			: null;

const calleeName = (call: ts.CallExpression): string | undefined =>
	ts.isPropertyAccessExpression(call.expression)
		? call.expression.name.text
		: ts.isIdentifier(call.expression)
			? call.expression.text
			: undefined;

const isCount = (node: ts.Expression) =>
	ts.isPropertyAccessExpression(node) && (node.name.text === 'length' || node.name.text === 'size');

/** `{ WEEK: 1, MONTH: 2, … }`: every value a small whole ordinal, ties allowed, none past the key count. */
function isRank(node: ts.Node): boolean {
	if (!ts.isObjectLiteralExpression(node) || node.properties.length < 2) return false;
	const values = node.properties.map((p) =>
		ts.isPropertyAssignment(p) ? numeric(p.initializer) : null
	);
	return values.every(
		(v) => v !== null && Number.isInteger(v) && v >= 0 && v <= node.properties.length
	);
}

/** Why an enclosing declaration makes every literal inside it structural, or null. */
function enclosing(node: ts.Node): string | null {
	for (let up: ts.Node = node; up.parent; up = up.parent) {
		const parent = up.parent;
		if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
			if (parent.name.text in NAMED_LIMITS) return NAMED_LIMITS[parent.name.text]!;
			if (parent.name.text.endsWith('_BLANK')) return 'a compile-time preview sample, never priced';
		}
		if (ts.isPropertyAssignment(parent) && parent.name.getText() === 'blank')
			return 'a compile-time preview sample, never priced';
	}
	return null;
}

/** Why a literal is structural where it stands, or null. */
function reason(node: ts.Expression, value: number, file: string, text: string): string | null {
	const site = SITES[file]?.[text];
	if (site) return site;
	if (STRUCTURAL.has(Math.abs(value))) return STRUCTURAL.get(Math.abs(value))!;
	// Arithmetic on an index or a count: climb the binary chain the literal sits in.
	let term: ts.Node = node;
	while (ts.isBinaryExpression(term.parent) || ts.isParenthesizedExpression(term.parent))
		term = term.parent;
	const parent = node.parent;
	if (ts.isLiteralTypeNode(parent)) return 'a type, not a value';
	if (ts.isElementAccessExpression(term.parent) && term.parent.argumentExpression === term)
		return 'an index';
	for (let up: ts.Node = node; up !== term.parent; up = up.parent)
		if (
			ts.isBinaryExpression(up) &&
			COMPARISON.has(up.operatorToken.kind) &&
			(isCount(up.left) || isCount(up.right))
		)
			return 'a count of elements, characters or entries';
	if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
		const name = calleeName(parent);
		if (name && STRING_LAYOUT.has(name)) return 'ISO date or code string layout';
		if (name === 'parseInt' && parent.arguments[1] === node) return 'decimal radix';
		if (name === 'toString' && value === 16) return 'hexadecimal radix';
		if (name === 'readAll' && parent.arguments[3] === node)
			return 'rows a read page takes under the 4 MiB crossing answer';
		if (name === 'addDays' && Math.abs(value) === 6 && parent.arguments[1] === node)
			return "a week's last day from its first";
		if (name === 'toFixed') {
			for (let up: ts.Node = parent; up.parent; up = up.parent)
				if (ts.isTemplateSpan(up)) return 'display precision in a message';
		}
	}
	if (
		value === 2 &&
		ts.isBinaryExpression(parent) &&
		parent.right === node &&
		parent.operatorToken.kind === K.SlashToken
	)
		return 'halving';
	if (
		value === 10 &&
		ts.isBinaryExpression(parent) &&
		parent.left === node &&
		parent.operatorToken.kind === K.AsteriskAsteriskToken
	)
		return 'the decimal base of a minor unit';
	if (ts.isConditionalExpression(parent)) {
		const other = parent.whenTrue === node ? parent.whenFalse : parent.whenTrue;
		if (ts.isCallExpression(other) && MINOR_DIGITS.test(calleeName(other) ?? ''))
			return 'ISO 4217 minor digits';
	}
	if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
		const key = parent.name.getText();
		if (key in STRUCTURAL_PROPERTY) return STRUCTURAL_PROPERTY[key]!;
		if (isRank(parent.parent)) return 'an ordinal rank';
	}
	if (MONTH_LOOP_BOUND.has(value))
		for (let up: ts.Node = node; up.parent && !ts.isStatement(up); up = up.parent)
			if (ts.isForStatement(up.parent) && up.parent.statement !== up)
				return 'a calendar month bound in a loop';
	return enclosing(node);
}

/** An array of numbers, an array of rows carrying two numbers, or an object of numbers: a band table. */
function band(node: ts.Node): boolean {
	const statutory = (values: (number | null)[]) =>
		values.every((v) => v !== null) && values.some((v) => !STRUCTURAL.has(Math.abs(v!)));
	if (ts.isArrayLiteralExpression(node) && node.elements.length >= 2)
		return (
			statutory(node.elements.map(numeric)) ||
			node.elements.every(
				(el) =>
					ts.isObjectLiteralExpression(el) &&
					el.properties.filter((p) => ts.isPropertyAssignment(p) && numeric(p.initializer) !== null)
						.length >= 2
			)
		);
	if (ts.isObjectLiteralExpression(node) && node.properties.length >= 2 && !isRank(node))
		return statutory(
			node.properties.map((p) => (ts.isPropertyAssignment(p) ? numeric(p.initializer) : null))
		);
	return false;
}

/** Every unexplained literal and band table of `sf`, as `path:line — text`. */
function offenders(sf: ts.SourceFile, path: string): string[] {
	const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
	const out: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isNumericLiteral(node)) {
			const { value, node: carrier } = signed(node);
			const text = carrier.getText(sf);
			if (reason(carrier, value, path, text) === null) out.push(`${path}:${line(node)} — ${text}`);
		} else if (band(node) && enclosing(node) === null)
			out.push(
				`${path}:${line(node)} — band table ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 60)}`
			);
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return out;
}

const parse = (name: string, code: string) =>
	ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true);

test('the guard walks the engine', () => {
	assert.ok(ENGINE.includes(at('src/lib/payroll/run/engine.ts')));
	assert.ok(ENGINE.some((file) => file.startsWith(at('src/data/collection/'))));
	for (const skipped of Object.keys(SKIPPED)) assert.ok(ENGINE.includes(at(skipped)), skipped);
	assert.ok(!ENGINE.some((file) => /\/src\/lib\/(kiosk|ui)\//.test(file)));
});

test('the guard catches a statutory literal and a band table', () => {
	const probe = (code: string) =>
		offenders(parse('probe.ts', code), 'probe.ts').map((o) => o.slice('probe.ts:1 — '.length));
	assert.deepEqual(probe('const rate = wage * 0.11;'), ['0.11']);
	assert.deepEqual(probe('const ot = hours * 1.5;'), ['1.5']);
	assert.deepEqual(probe('if (age >= 55) x = 1;'), ['55']);
	assert.deepEqual(probe('const cap = Math.min(wage, 6000);'), ['6000']);
	assert.deepEqual(probe('const per = monthly / 26;'), ['26']);
	assert.deepEqual(probe('const annual = weekly * 52;'), ['52']);
	assert.deepEqual(probe('const d = Math.min(30, day);'), ['30']);
	assert.deepEqual(probe('const offset = 8 * 60;'), ['8']);
	assert.deepEqual(probe('const r = x == null ? 2 : 1;'), ['2']);
	assert.deepEqual(probe('const r = Math.round(x * 20) / 20;'), ['20', '20']);
	assert.deepEqual(probe('const bands = [0, 1500, 3000];'), [
		'band table [0, 1500, 3000]',
		'1500',
		'3000'
	]);
	assert.deepEqual(probe('const b = [{ from: 0, to: 1 }, { from: 1, to: 7 }];'), [
		'band table [{ from: 0, to: 1 }, { from: 1, to: 7 }]'
	]);
	assert.deepEqual(probe('const t = { a: 11, b: 12 };'), ['band table { a: 11, b: 12 }', '11']);
	assert.deepEqual(probe('for (let d = 1; d <= 30; d++) f(d);'), []);
	assert.deepEqual(probe('const y = parseInt(s.slice(0, 4), 10);'), []);
	assert.deepEqual(probe('const h = n / 2; const i = a[i + 2]; const ok = a.length < i + 2;'), []);
	assert.deepEqual(probe('const d = c == null ? 2 : minorDigits(c);'), []);
	assert.deepEqual(probe('const s = 10 ** digits; const e = addDays(start, 6);'), []);
	assert.deepEqual(probe('const m = `${x.toFixed(2)} hours`;'), []);
	assert.deepEqual(probe('const RANK = { WEEK: 1, MONTH: 2, YEAR: 3, TIE: 3 };'), []);
	assert.deepEqual(
		probe('const x = { start: 0, end: 1 }; const c = { minimum: 1, maximum: 12 };'),
		[]
	);
	assert.deepEqual(probe('const PAGE_LIMIT = 20_000; const LIMITS_BLANK = { a: 11, b: 8 };'), []);
	assert.deepEqual(probe('type Half = 1 | 2;'), []);
});

test('no statutory literal or band table in the engine', () => {
	const found = ENGINE.filter((file) => !(rel(file) in SKIPPED)).flatMap((file) =>
		offenders(parse(file, readFileSync(file, 'utf8')), rel(file))
	);
	assert.deepEqual(
		found,
		[],
		'a statutory figure is a stored rule expression or band row; the engine only evaluates it'
	);
});
