import { sync, type Finding, type Json } from '@norbital-ai/bolt';
import { commissionRuleWorkbook } from '../../../../lib/workbook.js';

export default sync('commission_rules', 'sheet', {
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
			fixed_rate: Number(rule.fixed_rate),
			spread_pct: Number(rule.spread_pct),
			eligibility_expression: rule.eligibility_expression,
			amount_expression: rule.amount_expression,
			parameters: JSON.stringify(rule.parameters ?? []),
			active: rule.active
		}));
	}
});
