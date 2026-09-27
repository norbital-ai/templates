import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Catalogue probe only. EA 1955 s.60A(4)(a)'s first proviso excludes rest days,
// s.60D(1) gazetted holidays and their paid substitutes from the reg.2 104-hour cap.
// The execution boundary is covered separately in planned-overtime-split.test.ts.
type Settings = {
	id: string;
	work_rules: {
		limits: {
			key: string;
			period?: string;
			measure: string;
			max_hours?: number;
			counts_day_when?: string;
			counts_beyond_normal_when?: string;
		}[];
	};
};

for (const lineage of ['MY', 'MY-nihon']) {
	const versions: Settings[] = JSON.parse(
		readFileSync(
			new URL(`../seed/jurisdiction/${lineage}/jurisdiction_settings.json`, import.meta.url),
			'utf8'
		)
	);
	for (const version of versions)
		test(`${lineage} ${version.id}: 104-hour cap uses ordinary/off-day overtime`, () => {
			const limit = version.work_rules.limits.find((row) => row.key === 'monthly_ot');
			assert.ok(limit);
			assert.equal(limit.measure, 'OVERTIME_HOURS');
			assert.equal(limit.period, 'MONTH');
			assert.equal(limit.max_hours, 104);
			assert.equal((limit.counts_day_when ?? '').trim(), '');
			assert.equal((limit.counts_beyond_normal_when ?? '').trim(), '');
		});
}
