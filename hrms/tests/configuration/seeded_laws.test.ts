// Each seeded law is its changes over time: the whole law on 1 December 2025, then one patch per date the law changed.
// The law holds together on every one of those dates, and every row it names by code exists on that date.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { LAW_ROWS, type Law } from '../../src/data/model/jurisdiction/service/law.ts';
import { checkLaw } from '../../src/data/model/jurisdiction/service/configuration.ts';
import { isJsonObject, stableJson } from '../../src/lib/foundation.ts';
import { SEEDED } from './seeded.ts';

/** What a law says: its settings and rows, without the citations and wording any two dates may differ by anyway. */
const said = (law: Law): string =>
	stableJson({
		settings: law.settings,
		rows: LAW_ROWS.map((family) =>
			law.rows[family].map(({ references: _references, name: _name, ...row }) => row)
		)
	});

/**
 * Hosts that refuse a plain reader (docs/0003, "References"): a bot or script challenge, or no answer at all. A reference
 * cites a copy that opens instead (the authority's own API, another official host, a dated archive snapshot), or names
 * its instrument with no link: a source nobody can open is not cited.
 */
const REFUSES =
	/^https?:\/\/(?:(?:www\.)?kwsp\.gov\.my|hrdcorp\.gov\.my|(?:www\.)?perkeso\.gov\.my|(?:jtksm|gajiminimum)\.mohr\.gov\.my|sso\.agc\.gov\.sg|peraturan\.bpk\.go\.id\/Details|jdih\.kemenkeu\.go\.id|www\.peraturan\.go\.id|www\.mol\.go\.th|www\.dsd\.go\.th|www\.sec\.or\.th|laws\.mol\.gov\.tw|baohiemxahoi\.gov\.vn|natlex\.ilo\.org|privacy\.gov\.ph|(?:www|car|query)\.dole\.gov\.ph|laws\.e-gov\.go\.jp\/law|(?:jkq|ybj|zfgjj)\.km\.gov\.cn|mp\.weixin\.qq\.com|www\.facebook\.com|ppid\.bps\.go\.id|data\.sekadaukab\.go\.id|disnakertrans\.kalselprov\.go\.id)\//;
/** Every URL a value cites, in a `url` field or inside its wording. */
const cited = (value: unknown): readonly string[] =>
	typeof value === 'string'
		? (value.match(/https?:\/\/[^\s"<>，。；：）（、」』】]+/g) ?? [])
		: Array.isArray(value)
			? value.flatMap(cited)
			: isJsonObject(value)
				? Object.values(value).flatMap(cited)
				: [];

describe('the seeded laws', () => {
	for (const { code, changes, standing } of SEEDED) {
		it(`${code}: the first change is the whole law on 2025-12-01, and no two changes share a date`, () => {
			const dates = changes.map((row) => String(row.effective_from));
			assert.equal(dates[0], '2025-12-01');
			assert.equal(new Set(dates).size, dates.length);
			for (const row of changes) {
				assert.equal(row.jurisdiction_code, code);
				assert.equal(row.finding_id ?? null, null, `${code} ${String(row.effective_from)}`);
			}
		});

		it(`${code}: every reference cites a page a plain reader can open`, () => {
			assert.deepEqual(
				changes.flatMap((row) => cited(row.law)).filter((url) => REFUSES.test(url)),
				[]
			);
		});

		it(`${code}: every later change changes something on its date`, () => {
			for (const [index, law] of standing.entries()) {
				const before = standing[index - 1];
				if (before === undefined) continue;
				assert.notEqual(said(law), said(before), `${code} ${law.on} repeats ${before.on}`);
			}
		});

		it(`${code}: folded at each change date, the law passes the write checks`, () => {
			const seen = new Set<string>();
			for (const law of standing)
				assert.doesNotThrow(() => checkLaw(law, seen), `${code} ${law.on}`);
		});

		it(`${code}: every row a row names by code exists on that date`, () => {
			for (const law of standing) {
				const codes = (family: (typeof LAW_ROWS)[number]) =>
					new Set(law.rows[family].map((row) => String(row.code)));
				const subtotals = codes('subtotal');
				const schemes = codes('statutory_contribution_catalog');
				const missing = LAW_ROWS.flatMap((family) =>
					law.rows[family].flatMap((row) => [
						...(['subtotal', 'previous', 'employer_cost_subtotal'] as const).flatMap((field) =>
							row[field] == null || subtotals.has(String(row[field]))
								? []
								: [`${family}/${String(row.code)}.${field} ${String(row[field])}`]
						),
						...(Array.isArray(row.depends_on) ? row.depends_on : []).flatMap((scheme) =>
							schemes.has(String(scheme))
								? []
								: [`${family}/${String(row.code)}.depends_on ${String(scheme)}`]
						)
					])
				);
				const { conversions } = law.settings;
				const back_pay = isJsonObject(conversions) ? conversions.back_pay : undefined;
				if (
					back_pay != null &&
					back_pay !== true &&
					(typeof back_pay !== 'string' || !subtotals.has(back_pay))
				)
					missing.push(`conversions.back_pay ${String(back_pay)}`);
				assert.deepEqual(missing, [], `${code} ${law.on}`);
			}
		});
	}
});
