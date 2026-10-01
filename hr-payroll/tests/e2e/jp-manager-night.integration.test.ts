import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { differential, PROFILES, writeReports } from './differential.ts';
import { boot, type Host } from './payroll-probe.ts';

const ids = new Set(['jp-ot-manager-night', 'jp-ot-manager-rest-night', 'jp-ot-manager-night-end']);
let host: Host;
beforeAll(async () => {
	host = await boot();
}, 300_000);
afterAll(() => host?.close());

it('JP managers receive only the night premium on saved normal and statutory-rest payslips', async () => {
	const jp = PROFILES.find((profile) => profile.code === 'JP')!;
	const entries = jp.entries().filter((entry) => ids.has(entry.tags.id));
	expect(entries).toHaveLength(ids.size);
	const report = await differential(
		host,
		{ code: 'JP', entries: () => entries },
		{
			batch: 3,
			concurrency: 1
		}
	);
	writeReports(
		process.env.DIFF_OUT ??
			join(process.cwd(), '..', '..', '.tmp', 'hr-takeover', 'jp-manager-night'),
		[report]
	);
	expect(report.unmapped).toEqual([]);
	expect(report.disagreements).toEqual([]);
	expect(report.agreed).toBe(3);
}, 300_000);
