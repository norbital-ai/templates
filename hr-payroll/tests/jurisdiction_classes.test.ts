// The seeded statutory formulas respect each jurisdiction's stored worker classifications.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { resolveRead } from '../src/lib/payroll_engine/registrations.ts';

type Row = { readonly code: string; readonly eligibility?: string };
const catalog = (path: string) =>
	JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as readonly Row[];
const eligible = (row: Row | undefined, context: object) => {
	assert.ok(row !== undefined && row.eligibility !== undefined);
	return evaluate(row.eligibility, 'CALCULATION', context, 'eligibility');
};
type Rule = { readonly code: string; readonly validate?: string; readonly lookup?: object };
const rule = (path: string, code: string) => {
	const rows = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as readonly Rule[];
	const found = rows.find((row) => row.code === code);
	assert.ok(found?.validate !== undefined);
	const [settings] = JSON.parse(
		readFileSync(
			new URL(path.replace(/[^/]+$/, 'jurisdiction_settings.json'), import.meta.url),
			'utf8'
		)
	) as readonly Rule[];
	return { validate: found.validate, lookup: { ...settings?.lookup, ...found.lookup } };
};
const accepts = (defined: { validate: string; lookup: object }, context: object) =>
	evaluate(defined.validate, 'CALCULATION', context, 'validate');
const coverage = { from: '2026-03-01', to: '2026-03-31' };

describe('jurisdiction worker classifications', () => {
	it('resolves a compound read, so a retried effect finds its own obligation', () => {
		const data = { entry: { id: 'row-1', entity_id: 'entity-1', catalog_id: 'catalog-1' } };
		assert.deepEqual(
			resolveRead(
				{
					obligation: {
						where: { occurrence_key: { eq: { var: "'MY:KEY:' + ctx.entry.entity_id" } } }
					},
					leave_catalog: { where: { id: { in: { var: '[ctx.entry.catalog_id]' } } } },
					payslip: { where: { id: { eq: { var: 'ctx.entry.id' } } }, limit: 10 }
				},
				data
			),
			{
				obligation: { where: { occurrence_key: { eq: 'MY:KEY:entity-1' } } },
				leave_catalog: { where: { id: { in: ['catalog-1'] } } },
				payslip: { where: { id: { eq: 'row-1' } }, limit: 10 }
			}
		);
	});
	it('falls back past a stored null: an MY version with no registrations raises its EPF task', () => {
		const version = (registrations: unknown) => ({ status: 'SEALED', registrations });
		const condition = `// js
const r = ctx.entry;
return r.status === 'SEALED' && !get(r, 'registrations', []).some((x) => get(x, 'scheme_code', '') === 'EPF');`;
		const open = (entry: object) => evaluate(condition, 'CALCULATION', { entry }, 'condition');
		assert.equal(open(version(null)), true);
		assert.equal(open(version([{ scheme_code: 'EPF' }])), false);
	});
	it('excludes a Singapore foreigner from CPF and includes citizens and PRs', () => {
		const cpf = catalog(
			'../seed/public/jurisdiction/SG/version_4/statutory_contribution_catalog.json'
		).find((row) => row.code === 'CPF');
		const context = (residency_status: string) => ({
			subject: { employment: { terms: { residency_status }, employee_extension_data: {} } },
			subtotals: { ADDITIONAL_WAGES: 100 },
			run: { salary_coverage: coverage },
			lookup: {}
		});
		assert.equal(eligible(cpf, context('CITIZEN')), true);
		assert.equal(eligible(cpf, context('PERMANENT_RESIDENT')), true);
		assert.equal(eligible(cpf, context('FOREIGNER')), false);
	});
	it('excludes China interns and contractors from pension and includes employees', () => {
		const pension = catalog(
			'../seed/public/jurisdiction/CN/version_4/statutory_contribution_catalog.json'
		).find((row) => row.code === 'PENSION');
		const context = (engagement: string) => ({
			subject: {
				employment: {
					engagement,
					effective_range: { from: '2025-01-01', to: null },
					employee_extension_data: { facts: {} }
				}
			},
			run: { salary_coverage: coverage },
			lookup: {}
		});
		assert.equal(eligible(pension, context('EMPLOYEE')), true);
		for (const engagement of ['PART_TIME', 'INTERN', 'CONTRACTOR', 'CONSULTANT', 'PAYEE'])
			assert.equal(eligible(pension, context(engagement)), false);
	});
	it('grants SINDA to an Employment Pass holder, not S Pass or Work Permit', () => {
		const sinda = catalog(
			'../seed/public/jurisdiction/SG/version_4/statutory_contribution_catalog.json'
		).find((row) => row.code === 'SINDA');
		assert.ok(sinda !== undefined);
		const lookup = (sinda as Row & { lookup: object }).lookup;
		const context = (category: string, residency_status = 'FOREIGNER') => ({
			subject: {
				employment: {
					terms: { residency_status, work_authorisation_category: category },
					employee_extension_data: { term_facts: { race: 'INDIAN' } }
				}
			},
			subtotals: { ADDITIONAL_WAGES: 100 },
			run: { salary_coverage: coverage },
			lookup
		});
		assert.equal(eligible(sinda, context('EMPLOYMENT_PASS')), true);
		assert.equal(eligible(sinda, context('S_PASS')), false);
		assert.equal(eligible(sinda, context('WORK_PERMIT')), false);
		assert.equal(eligible(sinda, context('', 'CITIZEN')), true);
	});
	it('accepts only declared Singapore pass categories on a contract', () => {
		for (const version of ['version_3', 'version_4']) {
			const categories = rule(
				`../seed/public/jurisdiction/SG/${version}/registered_rule.json`,
				'CONTRACT_CATEGORIES'
			);
			const context = (category: string) => ({
				entry: {
					terms: { residency_status: 'FOREIGNER', work_authorisation_category: category }
				},
				lookup: categories.lookup
			});
			for (const category of ['EMPLOYMENT_PASS', 'S_PASS', 'WORK_PERMIT', ''])
				assert.equal(accepts(categories, context(category)), true);
			assert.equal(accepts(categories, context('INVALID')), false);
		}
	});
});
