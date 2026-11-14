// One owner per value: settings hold shared tables, a single row's values live on that row, and no path is a string.
import assert from 'node:assert/strict';
import { Schema } from 'effect';
import { describe, it } from 'vitest';
import { LAW_ROWS } from '../../src/lib/law.ts';
import { settingsConstants } from '../../src/lib/payroll_engine/contracts.ts';
import { paramsFor } from '../../src/lib/payroll_engine/params.ts';
import { SEEDED } from './seeded.ts';

/** Keys the engine builds in code rather than naming in a seed expression. `constants` is spread into `ctx.lookup`. */
const CODE_READ = new Set(['cpf_rates', 'constants']);
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
/** Every seeded law as it stands on each of its change dates. */
const LAWS = SEEDED.flatMap(({ standing }) => standing);
/** Every row of a law, with the family it belongs to. */
const rowsOf = (law: (typeof LAWS)[number]) =>
	LAW_ROWS.flatMap((family) => law.rows[family].map((row) => ({ family, row })));

/** The expression fields on a row, without its own lookup declaration. */
const expressionOf = (row: Record<string, unknown>): string =>
	[
		'calculation',
		'eligibility',
		'conversion',
		'paid_share',
		'payout',
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
		for (const law of LAWS.filter((one) => one.code === code))
			for (const { row } of rowsOf(law))
				for (const match of expressionOf(row).matchAll(reference)) {
					const name = match[1] ?? match[2] ?? match[3];
					if (name !== undefined) held.set(name, (held.get(name) ?? 0) + 1);
				}
		counts.set(code, held);
	}
	return held.get(key) ?? 0;
};

describe('configuration ownership', () => {
	it('keeps every settings key a shared table, never a scalar or a code list', () => {
		for (const law of LAWS) {
			const lookup = isObject(law.settings.lookup) ? law.settings.lookup : {};
			for (const [key, value] of Object.entries(lookup))
				assert.equal(
					typeof value === 'object' && value !== null,
					true,
					`${law.code}/${law.on}: settings lookup.${key} is a scalar or code list, not a table`
				);
		}
	});

	it('declares every catalog row lookup key as a typed param', () => {
		const families = [
			'allowance_catalog',
			'overtime_catalog',
			'statutory_contribution_catalog',
			'leave_catalog',
			'claim_catalog',
			'adhoc_catalog',
			'loan_catalog'
		] as const;
		for (const law of LAWS)
			for (const family of families) {
				for (const row of law.rows[family]) {
					const lookup = isObject(row.lookup) ? row.lookup : {};
					const schema = paramsFor(family, String(row.code ?? ''));
					assert.ok(schema !== undefined, `${law.code}/${law.on}/${family}: no param schema`);
					// a key the row's schema does not declare is not a typed param
					Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(lookup);
				}
			}
	});

	it('spreads the shared constants into the settings lookup', () => {
		const view = settingsConstants({
			code: 'XX',
			lookup: { constants: { minor_unit: 0.01, no_cap: true } }
		});
		assert.equal(view.minor_unit, 0.01);
		assert.equal(view.no_cap, true);
	});

	it('keeps a value read by one row on that row, not in settings', () => {
		for (const law of LAWS) {
			const lookup = isObject(law.settings.lookup) ? law.settings.lookup : {};
			for (const key of Object.keys(lookup))
				if (!CODE_READ.has(key))
					assert.notEqual(
						readerCount(key, law.code),
						1,
						`${law.code}/${law.on}: settings lookup.${key} has exactly one row reader; move it to that row`
					);
		}
	});

	it('keeps every seeded producer role legal', () => {
		for (const law of LAWS)
			for (const { family, row } of rowsOf(law)) {
				const path = `${law.code}/${law.on}/${family}/${String(row.code)}`;
				// one pricing rule per catalog (a leave's paid_share and payout), with no flag beside it
				if (['allowance_catalog', 'claim_catalog', 'leave_catalog'].includes(family))
					for (const key of ['pay_treatment', 'direction', 'party', 'prorate'])
						assert.equal(Object.hasOwn(row, key), false, `${path}: ${key} is not a field`);
				if (family !== 'adhoc_catalog')
					assert.equal(
						Object.hasOwn(row, 'off_cycle_eligible'),
						false,
						`${path}: off_cycle_eligible is adhoc-only`
					);
			}
	});

	it('keeps no string field path', () => {
		for (const { code, changes } of SEEDED)
			assert.doesNotMatch(
				JSON.stringify(changes),
				/[a-z_]+_field['"]/,
				`${code}: a string field path remains`
			);
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
		for (const law of LAWS) {
			const lookup = isObject(law.settings.lookup) ? law.settings.lookup : {};
			for (const key of Object.keys(lookup))
				assert.equal(
					terms.has(key),
					false,
					`${law.code}/${law.on}: settings lookup.${key} repeats a contract term`
				);
		}
	});

	it('declares reads as variables or literals, never a bare ctx path', () => {
		for (const law of LAWS)
			for (const { family, row } of rowsOf(law)) {
				const path = `${law.code}/${law.on}/${family}/${String(row.code)}`;
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
