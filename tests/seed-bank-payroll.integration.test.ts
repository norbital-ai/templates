import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { jsonSqlParameter, manifestSeedStages } from '@norbital-ai/test-utilities';
import { createdIds, writeRows } from './helpers/write.ts';
import { markRunPaid } from './helpers/mark-paid.ts';
import { startPublicSeedHost, templateManifestPath } from './helpers/public-seed-host.ts';

/**
 * Every seeded company pays every seeded period, off the private seed bank.
 *
 * The bank is a private checkout beside the template (`<realm>/seed_bank`, or
 * `NORBITAL_HR_SEED_BANK`); CI without it skips here by name. Rows load as a reset loads them:
 * the template's public jurisdiction law, then each entity's `records/<entity>/`. Each company is
 * run month by month, December 2025 to June 2026 (each half at a semi-monthly company), and every
 * run is marked paid before the next, as an operator would. A refusal fails with its message.
 */
const bankRoot =
	process.env.NORBITAL_HR_SEED_BANK ??
	fileURLToPath(new URL('../../../seed_bank/norbital_hr/', import.meta.url));
const jurisdictionRoot = fileURLToPath(new URL('../seed/jurisdiction/', import.meta.url));
const MONTHS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

type Row = Readonly<Record<string, unknown>>;

const readRows = (path: string): Row[] =>
	JSON.parse(
		path.endsWith('.gz')
			? gunzipSync(readFileSync(path)).toString('utf8')
			: readFileSync(path, 'utf8')
	) as Row[];

const bankRows = (stages: readonly string[]): Record<string, Row[]> => {
	const rows: Record<string, Row[]> = Object.fromEntries(stages.map((stage) => [stage, []]));
	const add = (directory: string) => {
		for (const name of readdirSync(directory)) {
			const table = name.replace(/\.json(\.gz)?$/, '');
			if (table !== name && table in rows) rows[table]!.push(...readRows(join(directory, name)));
		}
	};
	for (const lineage of readdirSync(jurisdictionRoot)) add(join(jurisdictionRoot, lineage));
	for (const entity of readdirSync(join(bankRoot, 'records'), { withFileTypes: true }))
		if (entity.isDirectory()) add(join(bankRoot, 'records', entity.name));
	return rows;
};

const periodsOf = (company: Row): string[] =>
	company.pay_frequency === 'SEMI_MONTHLY'
		? MONTHS.flatMap((month) => [`${month}-1`, `${month}-2`])
		: MONTHS;

test(
	'seed bank: every company builds a payroll for every seeded period',
	{
		skip: existsSync(join(bankRoot, 'records'))
			? false
			: `no seed bank at ${bankRoot} (a private checkout; set NORBITAL_HR_SEED_BANK)`,
		timeout: 1_800_000
	},
	async () => {
		const stages = manifestSeedStages(templateManifestPath).filter(
			(stage) => stage !== 'team' && stage !== 'user'
		);
		const session = await startPublicSeedHost('hr-payroll-seed-bank', {
			seed: { stages, rows: bankRows(stages), mapParameters: jsonSqlParameter },
			// A paid mark names every slip of an 85-person run in one push.
			requestBodyLimitBytes: 1 << 20
		});
		try {
			const companies = (await session.query(
				'select id, name, pay_frequency from companies order by name'
			)) as Row[];
			assert.ok(companies.length > 0, 'the bank seeded no company');
			const failures: string[] = [];
			for (const company of companies)
				for (const period of periodsOf(company)) {
					const run = await writeRows(session, 'payroll_runs', 'create', [
						{ company_id: company.id, period }
					]);
					const at = `${String(company.name)} ${period}`;
					const body = run.value as { resolution?: string; message?: string };
					if (body.resolution !== 'accepted') {
						failures.push(`${at}: ${body.message ?? JSON.stringify(run.value).slice(0, 400)}`);
						break;
					}
					const runId = createdIds(run.value)[0]!;
					const [count] = (await session.query(
						'select count(*)::int as n from payslips where payroll_run_id = $1',
						[runId]
					)) as { n: number }[];
					if (!(count!.n > 0)) failures.push(`${at}: no payslips`);
					await markRunPaid(session, runId);
				}
			assert.deepEqual(failures, []);
		} finally {
			await session.stop();
		}
	}
);
