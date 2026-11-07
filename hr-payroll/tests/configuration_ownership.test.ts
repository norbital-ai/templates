// One owner per value: settings hold shared tables, a single row's values live on that row, and no path is a string.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { describe, it } from 'vitest';
import { settingsConstants } from '../src/lib/payroll_engine/contracts.ts';
import { PARAM_KEYS, paramsFor } from '../src/lib/payroll_engine/params.ts';
import { TABLES } from '../src/lib/payroll_engine/tables.ts';

/** Keys the engine builds in code rather than naming in a seed expression. */
/** Keys the engine builds in code rather than naming in a seed expression. `constants` is spread into `ctx.lookup`. */
const CODE_READ = new Set(['cpf_rates', 'constants']);
const ROOT = 'seed/public/jurisdiction';
const JURISDICTIONS = readdirSync(ROOT);
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const rows = (path: string): readonly Record<string, unknown>[] => {
	const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
	return (Array.isArray(value) ? value : [value]).filter(isObject);
};
const versions = (code: string) => readdirSync(join(ROOT, code));
const files = (code: string, version: string, skip = 'jurisdiction_settings.json') =>
	readdirSync(join(ROOT, code, version))
		.filter((file) => file !== skip)
		.map((file) => join(ROOT, code, version, file));
const settings = (code: string, version: string) =>
	rows(join(ROOT, code, version, 'jurisdiction_settings.json'));

/** The expression fields on a row, without its own lookup declaration. */
const expressionOf = (row: Record<string, unknown>): string =>
	[
		'calculation',
		'eligibility',
		'conversion',
		'incurred_on',
		'employee_amount',
		'employer_amount',
		'condition',
		'validate',
		'effects',
		'entitlement'
	]
		.flatMap((key) => (typeof row[key] === 'string' ? [String(row[key])] : []))
		.join('\n');

const counts = new Map<string, Map<string, number>>();
const readerCount = (key: string, code: string): number => {
	let held = counts.get(code);
	if (held === undefined) {
		held = new Map();
		const reference =
			/ctx\.lookup\.([a-z0-9_]+)\b|get\(ctx\.lookup, ['"]([a-z0-9_]+)['"]|get\(ctx, ['"]lookup\.([a-z0-9_]+)['"]/g;
		for (const version of versions(code))
			for (const path of files(code, version))
				for (const row of rows(path))
					for (const match of expressionOf(row).matchAll(reference)) {
						const name = match[1] ?? match[2] ?? match[3];
						if (name !== undefined) held.set(name, (held.get(name) ?? 0) + 1);
					}
		counts.set(code, held);
	}
	return held.get(key) ?? 0;
};

describe('configuration ownership', () => {
	it('declares every settings key as a shared-table shape', () => {
		for (const code of JURISDICTIONS)
			for (const version of versions(code))
				for (const row of settings(code, version)) {
					const lookup = isObject(row.lookup) ? row.lookup : {};
					for (const [key, value] of Object.entries(lookup)) {
						assert.ok(
							Object.hasOwn(TABLES, key),
							`${code}/${version}: settings lookup.${key} is not a declared shared table`
						);
						assert.equal(
							typeof value === 'object' && value !== null,
							true,
							`${code}/${version}: settings lookup.${key} is a scalar or code list, not a table`
						);
						const schema = TABLES[key as keyof typeof TABLES];
						Schema.decodeUnknownSync(schema as Schema.ConstraintDecoder<unknown>)(value);
					}
				}
	});

	it('declares every catalog row lookup key as a typed param', () => {
		const families: Readonly<Record<string, keyof typeof PARAM_KEYS>> = {
			'allowance_catalog.json': 'allowance_catalog',
			'overtime_catalog.json': 'overtime_catalog',
			'statutory_contribution_catalog.json': 'statutory_contribution_catalog',
			'leave_catalog.json': 'leave_catalog',
			'claim_catalog.json': 'claim_catalog',
			'adhoc_catalog.json': 'adhoc_catalog',
			'loan_catalog.json': 'loan_catalog'
		};
		for (const code of JURISDICTIONS)
			for (const version of versions(code))
				for (const [file, family] of Object.entries(families)) {
					const declared: ReadonlySet<string> = new Set(PARAM_KEYS[family]);
					for (const row of rows(join(ROOT, code, version, file))) {
						const lookup = isObject(row.lookup) ? row.lookup : {};
						const schema = paramsFor(family, String(row.code ?? ''));
						assert.ok(schema !== undefined, `${code}/${version}/${file}: no param schema`);
						Schema.decodeUnknownSync(schema)(lookup);
						for (const key of Object.keys(lookup))
							assert.ok(
								declared.has(key),
								`${code}/${version}/${file}: lookup.${key} is not a typed param`
							);
					}
				}
	});

	it('spreads the shared constants into the settings lookup', () => {
		const view = settingsConstants({
			id: 'law',
			code: 'XX',
			lookup: { constants: { minor_unit: 0.01, no_cap: true } }
		});
		assert.equal(view.minor_unit, 0.01);
		assert.equal(view.no_cap, true);
	});

	it('keeps a value read by one row on that row, not in settings', () => {
		for (const code of JURISDICTIONS)
			for (const version of versions(code))
				for (const row of settings(code, version)) {
					const lookup = isObject(row.lookup) ? row.lookup : {};
					for (const key of Object.keys(lookup))
						if (!CODE_READ.has(key))
							assert.notEqual(
								readerCount(key, code),
								1,
								`${code}/${version}: settings lookup.${key} has exactly one row reader; move it to that row`
							);
				}
	});

	it('keeps every seeded producer role legal', () => {
		for (const code of JURISDICTIONS)
			for (const version of versions(code))
				for (const path of files(code, version))
					for (const row of rows(path)) {
						const name = path.split('/').at(-1);
						if (name === 'allowance_catalog.json')
							assert.ok(
								!(row.party === 'EMPLOYER' && row.include_in_rate === true),
								`${path}: an employer-only allowance is in the employee rate`
							);
						if (name === 'leave_catalog.json')
							assert.ok(
								!(
									row.pay_treatment === 'UNPAID' &&
									typeof row.conversion === 'string' &&
									row.conversion.trim() !== ''
								),
								`${path}: an unpaid leave row carries a conversion`
							);
						if (name !== 'adhoc_catalog.json')
							assert.equal(
								Object.hasOwn(row, 'off_cycle_eligible'),
								false,
								`${path}: off_cycle_eligible is adhoc-only`
							);
					}
	});

	it('keeps no string field path', () => {
		for (const code of JURISDICTIONS)
			for (const version of versions(code))
				for (const path of files(code, version, '')) {
					const text = readFileSync(path, 'utf8');
					assert.doesNotMatch(text, /[a-z_]+_field['"]/, `${path}: a string field path remains`);
				}
	});

	it('does not repeat a contract term in settings', () => {
		const terms = new Set([
			'normal_hours_per_day',
			'normal_hours_per_week',
			'normal_days_per_week',
			'rate',
			'allowances',
			'service_started_on',
			'effective_range'
		]);
		for (const code of JURISDICTIONS)
			for (const version of versions(code))
				for (const row of settings(code, version)) {
					const lookup = isObject(row.lookup) ? row.lookup : {};
					for (const key of Object.keys(lookup))
						assert.equal(
							terms.has(key),
							false,
							`${code}/${version}: settings lookup.${key} repeats a contract term`
						);
				}
	});

	it('declares reads as variables or literals, never a bare ctx path', () => {
		for (const code of JURISDICTIONS)
			for (const version of versions(code))
				for (const path of files(code, version))
					for (const row of rows(path)) {
						const reads = isObject(row.reads) ? row.reads : {};
						for (const [name, value] of Object.entries(reads)) {
							assert.equal(typeof value, 'object', `${path}: reads.${name} is a bare value`);
							if (!isObject(value)) continue;
							for (const [field, source] of Object.entries(value))
								assert.equal(
									typeof source === 'string' && source.startsWith('ctx.'),
									false,
									`${path}: reads.${name}.${field} is a bare ctx path`
								);
						}
					}
	});
});
