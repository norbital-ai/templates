import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { Schema } from 'effect';
import { formatSeedRow } from '../seed/cel.ts';
import { formatCel } from '../src/lib/ui/format/code_text.ts';

const expression =
	'has(employee.facts) && has(employee.facts.eligible) && employee.facts.eligible == true && service_months >= 12 ? 14.000000000000123 : 0.0';
const formatted = formatCel(expression);
type Row = Record<string, Schema.Json>;

describe('seed CEL presentation', () => {
	it('formats declared nested expressions without changing source rows or same-named business data', () => {
		assert.notEqual(formatted, expression);
		const rows: readonly [string, Row, Row][] = [
			[
				'leave_catalog',
				{
					name: expression,
					eligibility: expression,
					entitlement: {
						days: expression,
						window_key: expression,
						carry_forward: expression,
						hours_per_day: expression,
						bands: [{ service_months: 12, days: 14 }]
					}
				},
				{
					name: expression,
					eligibility: formatted,
					entitlement: {
						days: formatted,
						window_key: formatted,
						carry_forward: formatted,
						hours_per_day: formatted,
						bands: [{ service_months: 12, days: 14 }]
					}
				}
			],
			[
				'statutory_contribution_catalog',
				{
					references: [{ title: expression }],
					configuration: {
						assessment: expression,
						assessable: { ordinary: expression },
						person: { age: expression },
						rules: [
							{
								when: expression,
								employee: expression,
								employer: expression,
								contribution: expression
							}
						],
						warn_when: [{ when: expression, message: expression }],
						refuse_when: [{ when: expression, message: expression }]
					}
				},
				{
					references: [{ title: expression }],
					configuration: {
						assessment: formatted,
						assessable: { ordinary: formatted },
						person: { age: formatted },
						rules: [
							{ when: formatted, employee: formatted, employer: formatted, contribution: formatted }
						],
						warn_when: [{ when: formatted, message: expression }],
						refuse_when: [{ when: formatted, message: expression }]
					}
				}
			],
			[
				'claim_catalog',
				{
					eligibility: expression,
					qualifies_when: expression,
					bands: [
						{
							when: expression,
							amount: expression,
							limit: { amount: expression, on_exceed: 'CAP' }
						}
					]
				},
				{
					eligibility: formatted,
					qualifies_when: formatted,
					bands: [
						{ when: formatted, amount: formatted, limit: { amount: formatted, on_exceed: 'CAP' } }
					]
				}
			],
			[
				'work_catalog',
				{
					eligibility: expression,
					quantity: expression,
					rate: expression,
					denominator: expression,
					counts_toward: [expression]
				},
				{
					eligibility: formatted,
					quantity: formatted,
					rate: formatted,
					denominator: formatted,
					counts_toward: [expression]
				}
			],
			[
				'allowance_catalog',
				{ eligibility: expression, amount: expression },
				{ eligibility: formatted, amount: formatted }
			],
			[
				'employment_contract',
				{ facts: { amount: expression, days: expression } },
				{ facts: { amount: expression, days: expression } }
			]
		];
		for (const [collection, original, expected] of rows) {
			const snapshot = structuredClone(original);
			assert.deepEqual(formatSeedRow(collection, original), expected, collection);
			assert.deepEqual(original, snapshot, `${collection}: source unchanged`);
			assert.deepEqual(formatSeedRow(collection, expected), expected, `${collection}: idempotent`);
		}
	});

	it('formats behaviour predicates and suspension rules while preserving identifiers and selections', () => {
		const original: Row = {
			payroll: { pay_date: expression, monthly_wage: expression, currency: expression },
			suspension_kinds: [
				{ code: expression, counts_as_attended: expression, scheduled: expression, pay: expression }
			],
			behaviours: {
				version: 1,
				rules: [
					{
						id: expression,
						when: expression,
						effect: expression,
						reads: {
							subject: {
								collection: expression,
								where: { and: [{ id: { eq: expression } }, { active: { eq: true } }] },
								select: [expression]
							}
						}
					}
				]
			}
		};
		assert.deepEqual(formatSeedRow('jurisdiction_settings', original), {
			payroll: { pay_date: formatted, monthly_wage: formatted, currency: expression },
			suspension_kinds: [
				{ code: expression, counts_as_attended: formatted, scheduled: formatted, pay: formatted }
			],
			behaviours: {
				version: 1,
				rules: [
					{
						id: expression,
						when: formatted,
						effect: formatted,
						reads: {
							subject: {
								collection: expression,
								where: { and: [{ id: { eq: formatted } }, { active: { eq: true } }] },
								select: [expression]
							}
						}
					}
				]
			}
		});
	});

	it('formats each executable rule family and leaves policy prose and literal financial data intact', () => {
		for (const family of ['TASKS', 'OBLIGATIONS']) {
			assert.deepEqual(
				formatSeedRow('rule_set', {
					family,
					rules: {
						when: expression,
						applies_when: expression,
						due: expression,
						amount: expression,
						description: expression
					}
				}),
				{
					family,
					rules: {
						when: formatted,
						applies_when: formatted,
						due: formatted,
						amount: formatted,
						description: expression
					}
				}
			);
		}
		assert.deepEqual(
			formatSeedRow('rule_set', {
				family: 'VALIDATIONS',
				rules: { when: expression, message: expression }
			}),
			{ family: 'VALIDATIONS', rules: { when: formatted, message: expression } }
		);
		assert.deepEqual(
			formatSeedRow('rule_set', {
				family: 'PAYROLL',
				code: 'record_retention',
				rules: { until: expression }
			}),
			{ family: 'PAYROLL', code: 'record_retention', rules: { until: formatted } }
		);
		assert.deepEqual(
			formatSeedRow('rule_set', {
				family: 'PAYROLL',
				code: 'overtime_classification',
				rules: {
					limits: [
						{
							code: expression,
							from: expression,
							limit: expression,
							applies: expression,
							hours: expression
						}
					]
				}
			}),
			{
				family: 'PAYROLL',
				code: 'overtime_classification',
				rules: {
					limits: [
						{
							code: expression,
							from: formatted,
							limit: formatted,
							applies: formatted,
							hours: formatted
						}
					]
				}
			}
		);
		const literal: Row = {
			family: 'PAYROLL',
			code: 'rates',
			rules: { amount: expression, rate: 0.1234567890123 }
		};
		assert.deepEqual(formatSeedRow('rule_set', literal), literal);
		const field = { header: expression, value: expression };
		const expectedField = { header: expression, value: formatted };
		assert.deepEqual(
			formatSeedRow('rule_set', {
				family: 'EXPORTS',
				rules: {
					file: expression,
					when: expression,
					applies_when: expression,
					columns: [field],
					records: [{ each: expression, fields: [field] }],
					summary: { key: expression, each: expression, fields: [field] },
					header: [field],
					trailer: [field]
				}
			}),
			{
				family: 'EXPORTS',
				rules: {
					file: formatted,
					when: formatted,
					applies_when: formatted,
					columns: [expectedField],
					records: [{ each: formatted, fields: [expectedField] }],
					summary: { key: formatted, each: formatted, fields: [expectedField] },
					header: [expectedField],
					trailer: [expectedField]
				}
			}
		);
	});
});
