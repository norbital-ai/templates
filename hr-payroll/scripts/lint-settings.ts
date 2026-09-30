/**
 * `lint:settings`: the settings linter (`src/lib/lint/settings-lint.ts`) over every seeded
 * settings version that is not voided, and over each lineage's governing versions.
 *
 *   node --experimental-strip-types --import ./scripts/ts-source-resolve.mjs \
 *     scripts/lint-settings.ts [--warnings] [LINEAGE…]
 *
 * Prints every error, and per lineage the warnings counted by rule (`--warnings` lists them).
 * Exits 1 on any error. `tests/settings-lint.test.ts` reads the seeds through `seededLineages`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
	lintLineage,
	lintSettingsVersion,
	type LintFinding,
	type LintTree
} from '../src/lib/lint/settings-lint.ts';

/** Where each child family of a version is seeded. */
const FAMILIES = {
	schemes: 'statutory_contributions',
	catalogueLeaves: 'leave_catalogue',
	loanCatalogue: 'loan_catalogue',
	claimCatalogue: 'claim_catalogue',
	adhocCatalogue: 'adhoc_catalogue',
	allowanceCatalogue: 'allowance_catalogue',
	referenceRows: 'reference_rows'
} as const;

type Seeded = Record<string, unknown>;

export type SeededLineage = {
	readonly lineage: string;
	/** Every seeded version, voided ones included. */
	readonly versions: readonly Seeded[];
	/** Every version that is not voided, with the rows under it. */
	readonly trees: readonly { readonly name: string; readonly tree: LintTree }[];
};

const read = (dir: URL, collection: string): Seeded[] => {
	for (const file of [`${collection}.json`, `${collection}.json.gz`]) {
		let bytes: Buffer;
		try {
			bytes = readFileSync(new URL(file, dir));
		} catch {
			continue;
		}
		const text = (file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
		return JSON.parse(text) as Seeded[];
	}
	return [];
};

export function seededLineages(
	root: URL = new URL('../seed/jurisdiction/', import.meta.url)
): SeededLineage[] {
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map(({ name: lineage }) => {
			const dir = new URL(`${lineage}/`, root);
			const versions = read(dir, 'jurisdiction_settings');
			const children = Object.entries(FAMILIES).map(
				([family, collection]) =>
					[family, Map.groupBy(read(dir, collection), (row) => row.settings_id)] as const
			);
			const trees = versions
				.filter((version) => version.voided_at == null)
				.map((version) => ({
					name: `${lineage} ${String(version.name)} (${String(version.id)})`,
					tree: {
						source: version,
						...Object.fromEntries(
							children.map(([family, rows]) => [family, rows.get(version.id) ?? []])
						)
					} as LintTree
				}));
			return { lineage, versions, trees };
		});
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const listWarnings = args.includes('--warnings');
	const only = new Set(args.filter((arg) => !arg.startsWith('--')));
	let errors = 0;
	for (const { lineage, versions, trees } of seededLineages()) {
		if (only.size > 0 && !only.has(lineage)) continue;
		const findings: (LintFinding & { readonly version: string })[] = [
			...lintLineage(versions).map((finding) => ({ ...finding, version: lineage })),
			...trees.flatMap(({ name, tree }) =>
				lintSettingsVersion(tree).map((finding) => ({ ...finding, version: name }))
			)
		];
		const counts = new Map<string, number>();
		for (const finding of findings) {
			if (finding.severity === 'error') {
				errors += 1;
				console.log(
					`error ${finding.rule} ${finding.version} ${finding.where}: ${finding.message}`
				);
			} else {
				counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
				if (listWarnings)
					console.log(
						`warning ${finding.rule} ${finding.version} ${finding.where}: ${finding.message}`
					);
			}
		}
		const summary = [...counts].map(([rule, count]) => `${rule} ${count}`).join(', ');
		console.log(`${lineage}: ${trees.length} versions, warnings: ${summary || 'none'}`);
	}
	console.log(errors === 0 ? 'No settings errors.' : `${errors} settings errors.`);
	process.exitCode = errors === 0 ? 0 : 1;
}
