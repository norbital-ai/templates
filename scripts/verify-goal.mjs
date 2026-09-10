/**
 * The acceptance run: every clause of the payroll goal, mapped to the tests that hold it.
 *
 * `pnpm test` proves the suite is green. It does not prove the suite *covers* anything in
 * particular — a clause whose tests were deleted, renamed, or never written passes exactly as
 * loudly as one with forty assertions behind it. This maps each clause to the files that answer it
 * and the phrases those files must actually assert, and fails when a clause has nothing behind it.
 *
 * It reads the suite rather than running it: `pnpm test` runs it, this says what the run covered.
 * Run both — `pnpm test && node scripts/verify-goal.mjs`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testDir = resolve(root, 'tests');

const read = (file) => {
	try {
		return readFileSync(resolve(testDir, file), 'utf8');
	} catch {
		return null;
	}
};

/**
 * Every `test('…')` title in a file, so a clause can require one by its words.
 *
 * The closing quote is the one that opened the title, not any quote: these titles carry backticked
 * identifiers — "every sealed version of `MY` is priced by a golden here" — and a character class
 * that excluded backticks truncated them at the first one, which silently shortened six titles.
 */
const titles = (source) =>
	[...source.matchAll(/\b(?:test|it)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g)].map(
		(match) => match[2]
	);

/**
 * A clause holds when every file it names exists and every phrase it names appears in some test
 * title in those files. Phrases are lower-cased substrings: they survive a reworded title far
 * better than a count, and they still fail when the behaviour stops being tested.
 */
const CLAUSES = [
	{
		id: '1.1',
		says: 'a payslip carries the sources that produced it',
		files: ['payslip-capture-contract.test.ts', 'payslip-linkage.test.ts'],
		phrases: ['capture reads source and payslip contract', 'produces an adjustment naming it']
	},
	{
		id: '1.2',
		says: 'overtime bands by day type, floored to the half hour',
		files: [
			'overtime-derivation.test.ts',
			'overtime-coverage.test.ts',
			'overtime-limit-reclassification.test.ts',
			'payslip-linkage.test.ts',
			'ordinary-rate-divisor.test.ts'
		],
		phrases: [
			'the half-hour floor rounds down',
			'a rest day pays a day’s wages',
			'a public holiday is paid at its own statutory rate',
			'a special holiday is its own day type',
			'the night premium adds a share of the hourly rate',
			'priced over 313/12'
		]
	},
	{
		id: '1.3',
		says: 'proration, including termination',
		files: ['payslip-linkage.test.ts', 'exit-reason.test.ts'],
		phrases: [
			'a mid-month joiner is paid the days they were employed',
			'a mid-month leaver is paid to their last day',
			'a joiner and a leaver in the same month',
			'a part period on a fixed_days basis never out-pays a whole one'
		]
	},
	{
		id: '1.4',
		says: 'unpaid leave and loan recovery',
		files: [
			'unpaid-leave-consumption.test.ts',
			'loan-schedule.test.ts',
			'ended-loan-recovery.test.ts',
			'loan-across-revisions.test.ts'
		],
		phrases: []
	},
	{
		id: '1.5',
		says: 'adjustment entries',
		files: ['payroll-regular.test.ts', 'payslip-linkage.test.ts'],
		phrases: ['an entry produces an adjustment naming it']
	},
	{
		id: '1.6',
		says: 'statutory contributions, every sealed version priced',
		files: [
			'no-jurisdiction-in-engine.test.ts',
			'statutory-golden-my.test.ts',
			'statutory-golden-ph.test.ts',
			'statutory-golden-sg.test.ts',
			'statutory-golden-tw.test.ts',
			'statutory-golden-vn.test.ts',
			'statutory-golden-id.test.ts',
			'contribution-banding.test.ts'
		],
		phrases: ['is priced by a golden here'],
		// Some behaviour is pinned inside a test rather than named by one. A band boundary is the
		// clearest case: it belongs beside the band tests, not in a test of its own.
		phrases: ['is priced by a golden here', 'no engine condition tests a jurisdiction code'],
		asserts: ['the year named by age_to opens the next band', 'assertEveryVersionPriced(']
	},
	{
		id: '1.7',
		says: 'off-boarding and the contract surfaces',
		files: ['exit-reason.test.ts', 'employment-contract.test.ts', 'rehire-headcount.test.ts'],
		phrases: []
	},
	{
		id: '2',
		says: 'leave entitlements at every point of change',
		files: ['leave-entitlement-golden.test.ts', 'computed-entitlement.test.ts'],
		phrases: ['every sealed version of every lineage has a leave golden']
	},
	{
		id: '3',
		says: 'roster and time-entry imports',
		files: [
			'workday-import-contract.test.ts',
			'import-month-grid.test.ts',
			'workbook-import-payload.test.ts'
		],
		phrases: [
			'a roster month grid expands filled cells',
			'a time-entry month grid reads closed ranges'
		]
	},
	{
		id: '4',
		says: 'payslip export',
		files: ['payroll-export-pipeline.test.ts', 'export-query.test.ts'],
		phrases: ['exports a bank file, a payslip per employment and the workbook']
	},
	{
		id: '5',
		says: 'bulk actions',
		files: ['payroll-export-pipeline.test.ts', 'holiday-pipelines.test.ts'],
		phrases: ['two runs selected together export as two sets']
	},
	{
		id: '6',
		says: 'no representation offers a field its scope decides',
		files: ['create-scope.test.ts'],
		phrases: [
			'no representation offers a column its page scope already decides',
			'every employment picker is narrowed to the page entity',
			'every page that draws a scoped collection provides the scope'
		]
	}
];

const present = new Set(readdirSync(testDir).filter((name) => name.endsWith('.test.ts')));
const failures = [];
const rows = [];

for (const clause of CLAUSES) {
	const missingFiles = clause.files.filter((file) => !present.has(file));
	const found = clause.files
		.map(read)
		.filter((source) => source != null)
		.flatMap(titles)
		.map((title) => title.toLowerCase());
	const missingPhrases = clause.phrases.filter(
		(phrase) => !found.some((title) => title.includes(phrase.toLowerCase()))
	);
	const bodies = clause.files
		.map(read)
		.filter((source) => source != null)
		.join('\n')
		.toLowerCase();
	const missingAsserts = (clause.asserts ?? []).filter(
		(phrase) => !bodies.includes(phrase.toLowerCase())
	);
	const tests = found.length;
	if (missingFiles.length > 0)
		failures.push(`${clause.id}: no such test file — ${missingFiles.join(', ')}`);
	for (const phrase of [...missingPhrases, ...missingAsserts])
		failures.push(`${clause.id}: nothing asserts "${phrase}"`);
	if (tests === 0) failures.push(`${clause.id}: no tests at all`);
	const gaps = missingFiles.length + missingPhrases.length + missingAsserts.length;
	rows.push([clause.id, clause.says, tests, gaps === 0]);
}

const width = Math.max(...rows.map((row) => row[1].length));
for (const [id, says, tests, ok] of rows)
	console.log(
		`  ${ok ? '✓' : '✗'} ${id.padEnd(4)} ${says.padEnd(width)}  ${String(tests).padStart(3)} tests`
	);

if (failures.length > 0) {
	console.error('\nThe goal is not covered:');
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
console.log(`\n  ${CLAUSES.length} clauses, all covered.`);
