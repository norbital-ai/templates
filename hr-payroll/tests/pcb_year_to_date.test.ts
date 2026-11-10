// PCB carries EPF and SOCSO + EIS relief across the tax year: each scheme apart, each to its own cap.
// Every expected figure is the LHDN formula worked by hand for one RM6,000 month: EPF 660, SOCSO 29.75, EIS 11.90.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { Schema } from 'effect';
import { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { isJsonObject } from '../src/lib/payroll_engine/foundation.ts';

const catalog = Schema.decodeUnknownSync(Schema.Array(JsonObject))(
	JSON.parse(
		readFileSync(
			'seed/public/jurisdiction/MY/version_5/statutory_contribution_catalog.json',
			'utf8'
		)
	)
);
const pcb = catalog.find((row) => row.code === 'PCB');
assert.ok(pcb !== undefined);
const [settings] = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ lookup: JsonObject })))(
	JSON.parse(
		readFileSync('seed/public/jurisdiction/MY/version_5/jurisdiction_settings.json', 'utf8')
	)
);

const pcbIn = (month: number, taxPaid: number) =>
	evaluate(
		String(pcb.employee_amount),
		'CALCULATION',
		{
			subject: {
				employment: {
					terms: { residency_status: 'CITIZEN' },
					employee_extension_data: {
						statutory: { PCB: { socso_eis_relief: true } }
					}
				}
			},
			lookup: {
				...((settings?.lookup as Record<string, unknown> | undefined)?.['constants'] as object),
				...settings?.lookup,
				...(isJsonObject(pcb.lookup) ? pcb.lookup : {})
			},
			run: { period: `2026-${String(month).padStart(2, '0')}` },
			subtotals: { ORDINARY_WAGES: 6000, ADDITIONAL_WAGES: 6000 },
			statutory: {
				EPF: { employee: 660, employer: 780 },
				SOCSO: { employee: 29.75, employer: 104.15 },
				EIS: { employee: 11.9, employer: 11.9 }
			},
			balances: {
				ytd: { FINAL_PAY: 6000 * (month - 1) },
				statutory_contribution: {
					'EPF.employee': 660 * (month - 1),
					'SOCSO.employee': 29.75 * (month - 1),
					'EIS.employee': 11.9 * (month - 1),
					'PCB.employee': taxPaid
				}
			}
		},
		'PCB'
	);

describe('PCB across the tax year', () => {
	it('January relieves one month of SOCSO and EIS', () => {
		assert.equal(pcbIn(1, 0), 207.15);
	});
	it('February accumulates them, and prior SOCSO stays out of the EPF cap', () => {
		assert.equal(pcbIn(2, 207.15), 206.7);
	});
	it('EPF relief stops at RM4,000, part-way through the month that reaches it', () => {
		assert.equal(pcbIn(7, 1230), 204.65);
	});
	it('SOCSO and EIS relief stops at RM350 and the EPF relief stays spent', () => {
		assert.equal(pcbIn(10, 1840), 203.85);
	});
});
