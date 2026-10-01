import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { settingsInForce } from '../src/lib/jurisdiction_settings.ts';
import { dutyTypesOf, materialise, obligationContext } from '../src/lib/obligations/materialise.ts';

const versions = JSON.parse(
	readFileSync(
		new URL('../seed/jurisdiction/CN/jurisdiction_settings.json', import.meta.url),
		'utf8'
	)
);

test('CN Shanghai 2026 base declaration remains due 25 June for an employer opened during May or June', () => {
	// Shanghai Tax Bureau Notice 2026 No.1: declarations 1 May–25 June 2026;
	// all participating employers, including employers first opened during this window.
	// https://shanghai.chinatax.gov.cn/zcfw/zcfgk/sbf/202604/t480144.html
	for (const opened of ['2026-01-01', '2026-05-01', '2026-06-01']) {
		const version = settingsInForce(versions, 'CN', opened)!;
		const raised = materialise({
			duties: dutyTypesOf(version),
			settingsId: version.id,
			companyId: 'synthetic-company',
			currency: 'CNY',
			existing: new Set(),
			event: {
				on: 'CALENDAR',
				every: 'YEAR',
				date: opened,
				ref: '2026',
				subject: { kind: 'COMPANY', id: 'synthetic-company' },
				context: obligationContext({
					company: { region: 'SHANGHAI', facts: {} },
					period: { start: '2026-01-01', end: '2026-12-31' }
				})
			}
		});
		assert.deepEqual(
			raised.filter((row) => row.duty_code === 'SI_BASE_DECLARATION_2026').map((row) => row.due_on),
			['2026-06-25'],
			opened
		);
	}
});
