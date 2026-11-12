import { model } from '../../../../../.norbital/models/commission_rules.ts';
import { Result } from 'effect';
import { type Finding } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/std/wire';
import {
	commissionFault,
	DEFAULT_COMMISSION_EXPRESSION
} from '../../../../lib/commission-expressions.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { commissionRuleWorkbook } from '../../../../lib/workbook.js';

type Expressions = {
	readonly eligibility: string;
	readonly amount: string;
	readonly parameters: readonly { readonly name: string; readonly value: string }[];
};
/** Both expressions compile to their kinds and every parameter has a unique name and a decimal value. */
const valid = ({ eligibility, amount, parameters }: Expressions) =>
	Result.isSuccess(
		Result.try(() => {
			if (!amount) throw new Error('Missing amount expression');
			const fault = commissionFault(eligibility, 'bool') ?? commissionFault(amount, 'money');
			if (fault !== undefined) throw new Error(fault);
			const names = new Set<string>();
			for (const parameter of parameters) {
				if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parameter.name) || names.has(parameter.name))
					throw new Error('Duplicate or invalid parameter name');
				names.add(parameter.name);
				Decimal.of(parameter.value);
			}
		})
	);
export default model({
	description: 'commission rules',
	record_label:
		"[record.currency != null ? string(record.currency) : '', record.effective_on != null ? string(record.effective_on) : ''].filter(part, part != '').join(' · ')",
	fields: {
		eligibility_expression: { kind: 'text', format: 'cel', default: 'true' },
		amount_expression: { kind: 'text', format: 'cel', default: DEFAULT_COMMISSION_EXPRESSION },
		parameters: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'object',
				fields: { name: { kind: 'text' }, value: { kind: 'text' } },
				many: true
			}
		},
		code: {
			kind: 'enum',
			values: ['default'],
			default: 'default',
			hidden: true
		},
		currency: {
			kind: 'currency'
		},
		effective_on: {
			kind: 'date'
		},
		basis_unit: {
			optional: true,
			kind: 'text'
		},
		fixed_rate: {
			default: '0',
			kind: 'money',
			currency: 'currency',
			scale: 4
		},
		spread_pct: {
			default: '0',
			kind: 'decimal',
			scale: 2,
			min: 0,
			max: 100
		},
		active: {
			kind: 'bool',
			default: true
		}
	},
	outputs: { default: { fields: 'all' } },
	constraints: {
		natural_key: { unique: ['code', 'currency', 'effective_on'], import_key: true },
		fixed_rate_nonnegative: {
			check: {
				fixed_rate: {
					gte: '0'
				}
			}
		}
	},
	indexes: { search: { text: ['basis_unit'] } },
	syncs: {
		sheet: {
			with: 'file',
			parser: ['xlsx', 'csv'],
			schema: commissionRuleWorkbook,
			read: function* ({ records }, ctx) {
				const findings: Finding[] = [];
				const rows: Record<string, Json>[] = [];
				const isParameter = (value: unknown): value is { name: string; value: string } =>
					typeof value === 'object' &&
					value !== null &&
					'name' in value &&
					'value' in value &&
					typeof value.name === 'string' &&
					typeof value.value === 'string';
				for (const record of records) {
					const at = Number(record.$at ?? 0);
					let parameters: { name: string; value: string }[] | undefined;
					if (record.parameters) {
						let parsed: unknown;
						try {
							parsed = JSON.parse(record.parameters);
						} catch {
							parsed = undefined;
						}
						if (!Array.isArray(parsed) || !parsed.every(isParameter)) {
							findings.push({
								at,
								field: 'Parameters (JSON)',
								severity: 'refuse',
								message: 'Parameters must be a JSON array of { name, value } objects.'
							});
							continue;
						}
						parameters = parsed;
					}
					const row: Record<string, Json> = {
						code: record.code || 'default',
						currency: record.currency,
						effective_on: record.effective_on,
						fixed_rate: record.fixed_rate,
						spread_pct: record.spread_pct,
						eligibility_expression: record.eligibility_expression,
						amount_expression: record.amount_expression
					};
					if (record.basis_unit != null && record.basis_unit.trim() !== '')
						row.basis_unit = record.basis_unit;
					if (parameters !== undefined) row.parameters = parameters;
					if (record.active !== undefined) row.active = record.active;
					rows.push(row);
				}
				return { rows, findings };
			},
			write: function* (_input, ctx) {
				const { commission_rules: rules } = yield* ctx.query({
					commission_rules: {
						fields: [
							'code',
							'currency',
							'effective_on',
							'basis_unit',
							'fixed_rate',
							'spread_pct',
							'eligibility_expression',
							'amount_expression',
							'parameters',
							'active'
						],
						order_by: { effective_on: 'desc' },
						limit: 10000
					}
				});
				return rules.rows.map((rule) => ({
					code: rule.code,
					currency: rule.currency,
					effective_on: rule.effective_on,
					basis_unit: rule.basis_unit ?? '',
					fixed_rate: rule.fixed_rate.to_number(),
					spread_pct: rule.spread_pct.to_number(),
					eligibility_expression: rule.eligibility_expression,
					amount_expression: rule.amount_expression,
					parameters: JSON.stringify(rule.parameters ?? []),
					active: rule.active
				}));
			}
		}
	},
	create: {
		columns: {
			fields: [
				'eligibility_expression',
				'amount_expression',
				'parameters',
				'code',
				'currency',
				'effective_on',
				'basis_unit',
				'fixed_rate',
				'spread_pct',
				'active'
			]
		},
		transform: function* (changes, ctx) {
			const expressions = changes.map(({ after }) => ({
				eligibility: after.eligibility_expression ?? 'true',
				amount: after.amount_expression ?? DEFAULT_COMMISSION_EXPRESSION,
				parameters: after.parameters ?? []
			}));
			if (!expressions.every(valid)) yield* ctx.refuse('errors.commission_expression_invalid');
			return changes.map(({ set }) => set);
		}
	},
	update: {
		columns: {
			fields: [
				'eligibility_expression',
				'amount_expression',
				'parameters',
				'fixed_rate',
				'spread_pct',
				'active'
			]
		},
		transform: function* (changes, ctx) {
			const expressions = changes.map(({ after }) => ({
				eligibility: after.eligibility_expression,
				amount: after.amount_expression,
				parameters: after.parameters ?? []
			}));
			if (!expressions.every(valid)) yield* ctx.refuse('errors.commission_expression_invalid');
			return changes.map((c) => c.set);
		}
	}
});
