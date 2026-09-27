import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Environment } from '@marcbachmann/cel-js';

// Allocation expressions only. MSF's sharing arrangement assigns half the pool
// by default; an explicitly recorded zero is a zero allocation. These probes do
// not establish eligibility, the leave-taking window, hour/day units or payment.
const engine = new Environment({ unlistedVariablesAreDyn: true });
const rows: {
	id: string;
	code: string;
	settings_id: string;
	entitlement: { bands: { eligibility: string; days: number | string }[] };
}[] = JSON.parse(
	readFileSync(new URL('../seed/jurisdiction/SG/leave_catalogue.json', import.meta.url), 'utf8')
);
const versions: { id: string; effective_range: { start: string } }[] = JSON.parse(
	readFileSync(
		new URL('../seed/jurisdiction/SG/jurisdiction_settings.json', import.meta.url),
		'utf8'
	)
);
for (const version of versions) {
	const row = rows.find(
		(row) => row.settings_id === version.id && row.code === 'SHARED_PARENTAL_LEAVE'
	);
	assert.ok(row);
	const profiles = [{ date: '2026-03-31', pool: 6 }];
	if (version.effective_range.start >= '2026-04-01')
		profiles.push({ date: '2026-04-01', pool: 10 });
	for (const { date, pool } of profiles)
		for (const weeks of [-1, 0, 1, pool / 2, pool])
			test(`SG catalogue ${row.id}: ${date}, allocated weeks ${weeks}`, () => {
				// -1 is the documented context value for a missing declaration; zero
				// remains an actual allocation. Context mapping has its own probe below.
				const context = { event: { date, child_shared_weeks: weeks } };
				const band = row.entitlement.bands.find((candidate) =>
					engine.evaluate(candidate.eligibility || 'true', context)
				);
				assert.ok(band);
				const actual =
					typeof band.days === 'number' ? band.days : engine.evaluate(band.days, context);
				assert.equal(actual, (weeks === -1 ? pool / 2 : weeks) * 7);
			});
}

test('SG catalogue context: a missing allocation has the documented default', async () => {
	const { EXPRESSION_CONTEXTS } = await import('../src/lib/expressions/contexts.ts');
	assert.partialDeepStrictEqual(EXPRESSION_CONTEXTS.person.blank, {
		event: { child_shared_weeks: -1 }
	});
	assert.partialDeepStrictEqual(EXPRESSION_CONTEXTS.entry.blank, {
		person: { event: { child_shared_weeks: -1 } }
	});
});

test('SG context: absent and zero shared-parental declarations stay distinct', async () => {
	const { personContext } = await import('../src/lib/payroll/run/eligibility.ts');
	for (const [weeks, expected] of [
		[undefined, -1],
		[null, -1],
		[0, 0],
		[1, 1]
	] as const) {
		const actual = personContext({
			employee: {},
			employment: { service_start: '2024-01-01' },
			terms: {},
			asOf: '2026-09-01',
			event: { kind: 'BIRTH', date: '2026-04-01', child_index: 1 },
			children: [{ child_birthdate: '2026-04-01', shared_parental_weeks: weeks }]
		}).event.child_shared_weeks;
		assert.equal(actual, expected);
	}
});
