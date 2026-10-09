/**
 * Every lineage's leave classes evaluate in the balance listing's context: each class's `days`, `carry_forward` and
 * `eligibility` CEL on a plain subject, the version's PAYROLL rules and an empty next entry. A class whose CEL reads a
 * root the listing does not carry would empty the whole balance list.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import { evaluateStrict as evaluateConfigured } from '../src/lib/payroll_engine/expressions.ts';
import { classFromRow, leaveBalances } from '../src/lib/payroll_engine/leave.ts';
import { subjectContext } from '../src/lib/payroll_engine/services.ts';

type Row = Record<string, unknown>;
const law = resolve(process.cwd(), 'seed/jurisdiction');
const read = (dir: string, name: string): Row[] =>
	JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as Row[];

describe('leave classes in the balance context', () => {
	it('every class of every version evaluates its days, carry_forward and eligibility', () => {
		const failures: string[] = [];
		for (const lineage of readdirSync(law))
			for (const version of readdirSync(join(law, lineage))) {
				const dir = join(law, lineage, version);
				const [settings] = read(dir, 'jurisdiction_settings');
				const range = (settings!.effective_range ?? {}) as { from: string };
				const asOf = range.from;
				const rules = Object.fromEntries(
					read(dir, 'rule_set')
						.filter((row) => row.family === 'PAYROLL')
						.map((row) => [String(row.code), row.rules ?? {}])
				);
				const rows = read(dir, 'leave_catalog');
				const classes = rows.map((row) =>
					classFromRow({ approval_id: null, ...row } as unknown as Parameters<
						typeof classFromRow
					>[0])
				);
				const context = {
					...subjectContext({
						contract: { effective_range: { from: '2023-01-01', to: null } },
						employee: { id: 'p', facts: {} },
						entity: { id: 'c', settings_code: lineage, facts: {} },
						term: { effective_range: { from: '2023-01-01', to: null }, facts: {} },
						day: asOf,
						headcount: 10
					}),
					rules,
					earned: { month: {}, year: {}, previous_month: {}, months: [], history: [] }
				};
				// The balance listing: one throw empties the whole list, so each class is read on its own too.
				for (const cls of classes)
					try {
						leaveBalances({
							classes,
							movements: [],
							serviceMonths: 36,
							asOf,
							employmentStart: '2023-01-01',
							context
						}).filter((balance) => balance.code === cls.code);
						leaveBalances({
							classes: [cls],
							movements: [],
							serviceMonths: 36,
							asOf,
							employmentStart: '2023-01-01',
							context
						});
					} catch (cause) {
						failures.push(`${lineage}/${version} ${cls.code}: ${String(cause).split('\n')[0]}`);
					}
				for (const row of rows) {
					const eligibility = row.eligibility;
					if (typeof eligibility !== 'string' || eligibility.trim() === '') continue;
					try {
						const value = evaluateConfigured(eligibility, {
							...context,
							entry: { facts: {}, days: 0, occurred_on: asOf, from: asOf, to: asOf },
							earlier: { rows: [], calendar_year: 0, lifetime: 0 }
						});
						if (typeof value !== 'boolean')
							failures.push(
								`${lineage}/${version} ${String(row.code)}: eligibility is not boolean`
							);
					} catch (cause) {
						failures.push(
							`${lineage}/${version} ${String(row.code)} eligibility: ${String(cause).split('\n')[0]}`
						);
					}
				}
			}
		assert.deepEqual(failures, []);
	});
});
