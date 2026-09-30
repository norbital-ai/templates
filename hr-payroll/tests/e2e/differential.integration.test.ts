/**
 * The differential probe: every scenario of `tests/e2e/profiles/*.ts` on the production path (the built artifact,
 * `/__bolt/act`, `payroll_runs.create`, the saved payslips) against its independent oracle, `tests/e2e/oracle/*.ts`.
 * One host for the whole run; each profile concurrently, its scenarios batched as employees of shared companies
 * (`tests/e2e/differential.ts`). `pnpm test:differential` builds first.
 *
 * Env: DIFF_PROFILE=<code>[,<code>] runs those profiles only; DIFF_BATCH (default 25) scenarios per company;
 * DIFF_CONCURRENCY (default 2) batches in flight per profile; DIFF_OUT the report directory (default the realm's
 * `.tmp/r9-diff`). Reports: `<out>/<profile>.json` (summary, every disagreement, every unmapped scenario) and
 * `<out>/agree.json` (agreed / disagreed scenarios per tracker row and branch, per profile).
 */
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { boot, type Host } from './payroll-probe.ts';
import { differential, PROFILES, writeReports } from './differential.ts';

const only = (process.env.DIFF_PROFILE ?? '').split(',').filter((code) => code !== '');
const profiles = only.length === 0 ? PROFILES : PROFILES.filter((p) => only.includes(p.code));
const unknown = only.filter((code) => !PROFILES.some((p) => p.code === code));
const out = process.env.DIFF_OUT ?? join(process.cwd(), '..', '..', '.tmp', 'r9-diff');

let host: Host;
beforeAll(async () => {
	host = await boot();
}, 300_000);
afterAll(() => host?.close());

it('every profile scenario: the saved payslip agrees with the oracle to 0.01', async () => {
	expect(
		unknown,
		`DIFF_PROFILE names no profile: ${PROFILES.map((p) => p.code).join(', ')}`
	).toEqual([]);
	const reports = await Promise.all(
		profiles.map((p) =>
			differential(host, p, {
				batch: Number(process.env.DIFF_BATCH ?? 25),
				concurrency: Number(process.env.DIFF_CONCURRENCY ?? 2),
				log: (line) => console.log(line)
			})
		)
	);
	writeReports(out, reports);
	console.table(
		Object.fromEntries(
			reports.map((r) => [
				r.profile,
				{
					scenarios: r.scenarios,
					agreed: r.agreed,
					disagreed: r.disagreed,
					unmapped: r.unmapped.length
				}
			])
		)
	);
	console.log(`reports: ${out}`);
	expect(
		reports.filter((r) => r.disagreed > 0).map((r) => `${r.profile}: ${r.disagreed} disagreed`),
		`see ${out}/<profile>.json`
	).toEqual([]);
}, 3_600_000);
