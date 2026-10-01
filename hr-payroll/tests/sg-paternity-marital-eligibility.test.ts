import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Environment } from '@marcbachmann/cel-js';

// CDCA s.12I(2) permits a sole adoptive father. These direct catalogue probes
// isolate marital status for an otherwise qualifying citizen infant's adoption.
// They do not prove adoption dates, parentage, prior marriage or persistence.
const engine = new Environment({ unlistedVariablesAreDyn: true });
const rows: { id: string; settings_id: string; code: string; eligibility: string }[] = JSON.parse(
	readFileSync(new URL('../seed/jurisdiction/SG/leave_catalogue.json', import.meta.url), 'utf8')
);
const settings: { id: string; voided_at: string | null }[] = JSON.parse(
	readFileSync(
		new URL('../seed/jurisdiction/SG/jurisdiction_settings.json', import.meta.url),
		'utf8'
	)
);
const active = new Set(settings.filter((row) => row.voided_at == null).map((row) => row.id));
const paternity = rows.filter(
	(row) => row.code === 'PATERNITY_LEAVE' && active.has(row.settings_id)
);
assert.equal(paternity.length, 4);

for (const row of paternity) {
	for (const marital_status of ['SINGLE', 'MARRIED', 'DIVORCED'])
		test(`SG paternity ${row.id}: adoptive father ${marital_status}`, () => {
			assert.equal(
				engine.evaluate(row.eligibility, {
					employee: { gender: 'MALE', marital_status },
					employment: { service_months: 12 },
					event: { kind: 'ADOPTION', child_citizenship: 'CITIZEN', child_age: 0 }
				}),
				true
			);
		});
	for (const [label, gender, service, kind, marital_status, expected] of [
		['natural father married to mother', 'MALE', 12, 'BIRTH', 'MARRIED', true],
		['natural father never married to mother', 'MALE', 12, 'BIRTH', 'SINGLE', false],
		['adoptive mother', 'FEMALE', 12, 'ADOPTION', 'SINGLE', false],
		['adoptive father below service threshold', 'MALE', 2, 'ADOPTION', 'SINGLE', false],
		['no qualifying event', 'MALE', 12, '', 'MARRIED', false]
	] as const)
		test(`SG paternity ${row.id}: ${label}`, () => {
			assert.equal(
				engine.evaluate(row.eligibility, {
					employee: { gender, marital_status },
					employment: { service_months: service },
					event: { kind, child_citizenship: 'CITIZEN', child_age: 0 }
				}),
				expected
			);
		});
}
