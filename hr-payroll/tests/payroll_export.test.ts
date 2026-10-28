/**
 * `payroll_run.sync.export` (decision D): the bank files and the salary listing of the selected runs, written by the
 * file export as its JSON records (`{ name, content }`), as the exporter reads them.
 */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Effect, Schema } from 'effect';
import { SalaryReport } from '../src/lib/payroll_engine/salary_report.ts';
import { fixtureId, nativeId } from './fixture_values.ts';
import { COMPANY, VERSION, employer, runOf, world } from './jurisdiction_kit.ts';

const MARCH = { company_id: COMPANY, period: '2026-03', kind: 'REGULAR' } as const;
const Files = Schema.fromJsonString(
	Schema.Array(Schema.Struct({ name: Schema.String, content: Schema.String }))
);
const Run = Schema.Struct({
	state: Schema.String,
	output: Schema.NullOr(Schema.Json),
	error: Schema.NullOr(Schema.Json)
});
const Exported = Schema.Struct({ file: Schema.Struct({ id: Schema.String, name: Schema.String }) });

/** A bank account: the payer's and each payee's, which a bank file requires. */
const account = (holder: string) => ({
	bank_name: 'Fixture bank',
	bank_code: 'FIXTURE',
	bank_account_number: `000-${holder}`,
	bank_account_name: holder
});

/** The employer, plus one bank layout of the `XX` version: a CSV of each payable employee's number and gross. */
const tables = () => {
	const rows = employer([
		{ key: 'a', salary: 3000 },
		{ key: 'b', salary: 6000 }
	]);
	rows.set(
		'entity',
		(rows.get('entity') ?? []).map((row) => ({
			...row,
			disbursement_account: account('Fixture employer')
		}))
	);
	rows.set(
		'employment_contract',
		(rows.get('employment_contract') ?? []).map((row) => ({
			...row,
			bank: account(String(row['employee_number']))
		}))
	);
	rows.set('rule_set', [
		...(rows.get('rule_set') ?? []),
		{
			id: nativeId('rule_set', fixtureId('xx-bank-csv')),
			settings_id: VERSION,
			family: 'EXPORTS',
			code: 'bank_csv',
			name: 'bank_csv',
			rules: {
				bank_file_verified: true,
				bank_file_currencies: ['USD'],
				file: '"bank-" + runs[0].period + ".csv"',
				columns: [
					{ header: 'Employee', value: 'contract.employee_number' },
					{ header: 'Gross', value: 'totals.gross' }
				]
			}
		}
	]);
	return rows;
};

it.effect(
	'the payroll export writes the bank files and the salary listing of the selected runs as records',
	() =>
		world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				assert.equal((yield* hr.act('payroll_run.create', [MARCH])).kind, 'committed');
				const run = yield* runOf(hr, MARCH.period);
				assert.equal(run.count, 2, String(run.warnings));
				/** One export run of `kind`, to its settled `sys_run` row and the records of its file. */
				const exported = Effect.fnUntraced(function* (kind: 'BANK' | 'SALARY') {
					const started = yield* hr.start('payroll_run.sync.export', {
						mode: 'export',
						format: 'json',
						context: { ids: [run.id], kind }
					});
					if (started.kind !== 'committed') return assert.fail('The export must be queued.');
					yield* t.runDue();
					const [row] = yield* t.db.rows(Run, {
						text: 'SELECT state, output, error FROM sys_run WHERE id = $1',
						params: [started.output.id]
					});
					assert.ok(row);
					assert.equal(row.state, 'succeeded', JSON.stringify(row.error));
					const { file } = Schema.decodeUnknownSync(Exported)(row.output);
					const [stored] = yield* t.db.rows(Schema.Struct({ key: Schema.String }), {
						text: 'SELECT key FROM sys_file WHERE id = $1',
						params: [file.id]
					});
					assert.ok(stored);
					const bytes = t.fakes.files.blobs.get(stored.key);
					assert.ok(bytes, 'The export file is stored.');
					return Schema.decodeUnknownSync(Files)(new TextDecoder().decode(bytes));
				});
				// the bank file: its layout's name and one line per payable employee
				const bank = yield* exported('BANK');
				assert.deepEqual(
					bank.map((file) => file.name),
					['bank-2026-03.csv']
				);
				const [header, ...lines] = (bank[0]?.content ?? '').split('\n');
				assert.equal(header, 'Employee,Gross');
				assert.deepEqual(lines.toSorted(), ['a,3000', 'b,6000']);
				// the salary listing: one report per run and currency, its rows the run's employees
				const salary = yield* exported('SALARY');
				assert.equal(salary.length, 1);
				const report = Schema.decodeUnknownSync(Schema.fromJsonString(SalaryReport))(
					salary[0]?.content
				);
				assert.equal(report.period, '2026-03');
				assert.equal(report.currency, 'USD');
				assert.equal(report.run_reference, run.id);
				assert.deepEqual(report.rows.map((row) => row.employee_number).toSorted(), ['a', 'b']);
			})
		),
	90_000
);
