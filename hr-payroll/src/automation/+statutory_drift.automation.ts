import { Effect, Option, Schema } from 'effect';
import { automation } from '@norbital-ai/bolt';
import { cloneSettingsFields } from '../lib/payroll_engine/settings_version.js';
import {
	allowedUrl,
	findingFrom,
	lineageCodes,
	pageFrom,
	shouldDraft,
	sourcesFrom,
	unverifiedQuotes
} from '../lib/payroll_engine/statutory_drift.js';
import {
	completeSnapshot,
	supportedSnapshotChanges,
	conciseSnapshot,
	snapshotFields,
	snapshotSelect,
	SNAPSHOT_MODELS,
	SNAPSHOT_OUTPUT,
	STATUTORY_RESEARCH_ROLE,
	type StatutorySnapshot
} from '../lib/payroll_engine/statutory_snapshot.js';
/**
 * Every Saturday at 03:00 UTC, and when started by payroll authority: one run researches every sealed in-force
 * jurisdiction lineage (or the one `code` given) at once — one multi-step inference per lineage, side by side — and
 * persists a complete corrected unsealed successor where official evidence verifies the changes. It never seals.
 */
const statutory_drift = automation({
	description:
		'Every Saturday, research every sealed in-force jurisdiction lineage at once — one web-researching inference per lineage — and save a corrected unsealed draft where official evidence verifies a change. A manual start may name one code. It never seals a version.',
	on: { cron: '0 3 * * 6' },
	input: { code: { kind: 'text', optional: true } },
	output: {
		kind: 'object',
		fields: {
			lineages: { kind: 'list', of: { kind: 'text' } },
			drafted: { kind: 'list', of: { kind: 'text' } },
			failed: { kind: 'list', of: { kind: 'text' } }
		}
	},
	runAs: ['statutory_drift_automation'],
	concurrency: { max: 1 }
});
export default statutory_drift;
statutory_drift.run(function* (input, ctx) {
	// the in-force lineages, light; each research reads its own snapshot (one lineage per crossing)
	const { rows: inForce } = yield* ctx.read('jurisdiction_settings', {
		where: {
			...(input.code == null || input.code === '' ? {} : { code: { eq: input.code } }),
			sealed_at: { isNull: false },
			voided_at: { isNull: true },
			effective_range: { contains: { today: '' } }
		},
		select: { id: true, code: true },
		all: true
	});
	// one research per lineage (its first in-force version), all at once: each is a long multi-step inference
	const research = (code: string) =>
		Effect.gen(function* () {
			const read = {
				where: { settings_id: { in: { member: 'versions', field: 'id' } } },
				all: true
			} as const;
			// Drafts and snapshot rows depend only on the in-force versions: one native keyed read keeps them together.
			const { versions, held, adhoc, allowance, claim, leave, loan, work, contribution, rules } =
				yield* ctx.read({
					versions: {
						collection: 'jurisdiction_settings',
						where: {
							code: { eq: code },
							sealed_at: { isNull: false },
							voided_at: { isNull: true },
							effective_range: { contains: { today: '' } }
						},
						select: {
							id: true,
							code: true,
							jurisdiction_code: true,
							name: true,
							employee_input_schema: true,
							entity_input_schema: true,
							behaviours: true,
							payroll: true,
							suspension_kinds: true,
							sources: true,
							reference_tables: true,
							change_summary: true,
							effective_range: true,
							sealed_at: true,
							voided_at: true,
							void_reason: true
						},
						all: true
					},
					held: {
						collection: 'jurisdiction_settings',
						where: {
							cloned_from_id: { in: { member: 'versions', field: 'id' } },
							sealed_at: { isNull: true },
							voided_at: { isNull: true }
						},
						select: { id: true, cloned_from_id: true },
						all: true
					},
					adhoc: {
						collection: 'adhoc_catalog',
						...read,
						select: { ...snapshotSelect(SNAPSHOT_MODELS.adhoc_catalog.fields), settings_id: true }
					},
					allowance: {
						collection: 'allowance_catalog',
						...read,
						select: {
							...snapshotSelect(SNAPSHOT_MODELS.allowance_catalog.fields),
							settings_id: true
						}
					},
					claim: {
						collection: 'claim_catalog',
						...read,
						select: { ...snapshotSelect(SNAPSHOT_MODELS.claim_catalog.fields), settings_id: true }
					},
					leave: {
						collection: 'leave_catalog',
						...read,
						select: { ...snapshotSelect(SNAPSHOT_MODELS.leave_catalog.fields), settings_id: true }
					},
					loan: {
						collection: 'loan_catalog',
						...read,
						select: { ...snapshotSelect(SNAPSHOT_MODELS.loan_catalog.fields), settings_id: true }
					},
					work: {
						collection: 'work_catalog',
						...read,
						select: { ...snapshotSelect(SNAPSHOT_MODELS.work_catalog.fields), settings_id: true }
					},
					contribution: {
						collection: 'statutory_contribution_catalog',
						...read,
						select: {
							...snapshotSelect(SNAPSHOT_MODELS.statutory_contribution_catalog.fields),
							settings_id: true
						}
					},
					rules: {
						collection: 'rule_set',
						...read,
						select: { ...snapshotSelect(SNAPSHOT_MODELS.rule_set.fields), settings_id: true }
					}
				});
			const version = versions.rows[0];
			if (version == null) return { code, drafted: false };
			if (held.rows.some((draft) => draft.cloned_from_id === version.id))
				return { code, drafted: false };
			const sources = sourcesFrom(version.sources);
			if (sources.urls.length === 0) return { code, drafted: false };
			const snapshot = {
				settings: snapshotFields(version, SNAPSHOT_MODELS.settings.fields),
				adhoc_catalog: adhoc.rows
					.filter((row) => row.settings_id === version.id)
					.map((row) => snapshotFields(row, SNAPSHOT_MODELS.adhoc_catalog.fields)),
				allowance_catalog: allowance.rows
					.filter((row) => row.settings_id === version.id)
					.map((row) => snapshotFields(row, SNAPSHOT_MODELS.allowance_catalog.fields)),
				claim_catalog: claim.rows
					.filter((row) => row.settings_id === version.id)
					.map((row) => snapshotFields(row, SNAPSHOT_MODELS.claim_catalog.fields)),
				leave_catalog: leave.rows
					.filter((row) => row.settings_id === version.id)
					.map((row) => snapshotFields(row, SNAPSHOT_MODELS.leave_catalog.fields)),
				loan_catalog: loan.rows
					.filter((row) => row.settings_id === version.id)
					.map((row) => snapshotFields(row, SNAPSHOT_MODELS.loan_catalog.fields)),
				work_catalog: work.rows
					.filter((row) => row.settings_id === version.id)
					.map((row) => snapshotFields(row, SNAPSHOT_MODELS.work_catalog.fields)),
				statutory_contribution_catalog: contribution.rows
					.filter((row) => row.settings_id === version.id)
					.map((row) => snapshotFields(row, SNAPSHOT_MODELS.statutory_contribution_catalog.fields)),
				suspension_kind: version.suspension_kinds ?? [],
				rule_set: rules.rows
					.filter((row) => row.settings_id === version.id)
					.map((row) => snapshotFields(row, SNAPSHOT_MODELS.rule_set.fields))
			} as StatutorySnapshot;
			const result = yield* ctx.ai.sys_2.infer({
				model: 'strong',
				tools: ['web_search', 'web_read', 'browser_navigate', 'browser_snapshot', 'browser_act'],
				steps: 1000,
				system: STATUTORY_RESEARCH_ROLE,
				prompt: `Jurisdiction ${code}; review as of ${ctx.today}. Official entry points and extraction instructions:\n${JSON.stringify(sources.entries ?? sources.urls)}\nComplete snapshot index (read original values in memory):\n${conciseSnapshot(snapshot)}`,
				initial: Schema.decodeUnknownSync(Schema.Json)({
					changed: false,
					summary: '',
					effective_from: ctx.today,
					quotes: [],
					unresolved: [],
					snapshot
				}),
				output: SNAPSHOT_OUTPUT
			});
			const finding = findingFrom(result);
			if (
				!finding.changed ||
				!completeSnapshot(snapshot, result.snapshot) ||
				!supportedSnapshotChanges(snapshot, result.snapshot, result.quotes)
			)
				return { code, drafted: false };
			const cited = [...new Set(finding.quotes.map((row) => row.url))];
			if (cited.some((url) => !allowedUrl(url, sources))) return { code, drafted: false };
			// A page that cannot be read verifies none of its quotes: its failure is the page's absence.
			const fetched = yield* Effect.forEach(cited, (url) => Effect.option(ctx.web.read(url)), {
				concurrency: 'unbounded'
			});
			const pages = fetched.flatMap((item) => {
				const page = Option.isSome(item) ? pageFrom(item.value) : null;
				return page == null ? [] : [page];
			});
			if (!shouldDraft(finding, unverifiedQuotes(pages, finding.quotes, sources)))
				return { code, drafted: false };
			const corrected = result.snapshot;
			yield* ctx.act('jurisdiction_settings.create', {
				...cloneSettingsFields({ ...version, ...corrected.settings }, result.effective_from),
				change_summary: finding.summary,
				adhoc_catalog: { create: corrected.adhoc_catalog },
				allowance_catalog: { create: corrected.allowance_catalog },
				claim_catalog: { create: corrected.claim_catalog },
				leave_catalog: { create: corrected.leave_catalog },
				loan_catalog: { create: corrected.loan_catalog },
				work_catalog: { create: corrected.work_catalog },
				statutory_contribution_catalog: { create: corrected.statutory_contribution_catalog },
				suspension_kinds: corrected.suspension_kind,
				rule_set: { create: corrected.rule_set }
			});
			return { code, drafted: true };
		});
	const lineages = lineageCodes(inForce);
	// a lineage whose research fails is reported; the others still finish
	const results = yield* Effect.forEach(
		lineages,
		(code) =>
			research(code).pipe(
				Effect.catch((error) =>
					Effect.succeed({
						code,
						drafted: false,
						failed: `${code}: ${error.message}`
					})
				)
			),
		{ concurrency: 'unbounded' }
	);
	return {
		lineages,
		drafted: results.filter((result) => result.drafted).map((result) => result.code),
		failed: results.flatMap((result) => ('failed' in result ? [result.failed] : []))
	};
});
