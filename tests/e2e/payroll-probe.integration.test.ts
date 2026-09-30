/**
 * Every registered payroll probe case (`tests/e2e/probes/*.ts`) on one production host: the built artifact under
 * bolt-server's `start()`, writes through `/__bolt/act`, the Payroll app's `payroll_runs.create`, the saved payslips.
 * Each case owns its company and people, so the cases run concurrently. `pnpm test:probe` builds first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, cases, runCase, type Host } from './payroll-probe.ts';

import.meta.glob('./probes/*.ts', { eager: true });

let host: Host;
beforeAll(async () => {
	host = await boot();
}, 300_000);
afterAll(() => host?.close());

describe.concurrent('payroll probe', () => {
	for (const probe of cases)
		it(`${probe.profile} ${probe.id}`, async () => {
			const slips = await runCase(host, probe);
			for (const slip of slips)
				expect(slip.differences, `${slip.employment} saved ${JSON.stringify(slip.actual)}`).toEqual(
					[]
				);
		}, 120_000);
});
