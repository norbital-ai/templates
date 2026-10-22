import { Effect, Option, Result, Schema } from 'effect';
import { automation, jsonDiff } from '@norbital-ai/bolt';
import { cloneSettingsFields } from '../lib/payroll_engine/settings_version.js';
import {
	allowedUrl,
	changeSummary,
	lineageCodes,
	pageFrom,
	rowChanges,
	sourcesFrom,
	unverifiedQuotes,
	withoutRows
} from '../lib/payroll_engine/statutory_drift.js';
import {
	completeSnapshot,
	conciseSnapshot,
	COVERAGE_SCOPES,
	snapshotFields,
	snapshotSelect,
	SNAPSHOT_MODELS,
	SNAPSHOT_OUTPUT,
	STATUTORY_RESEARCH_ROLE,
	type StatutorySnapshot
} from '../lib/payroll_engine/statutory_snapshot.js';
/**
 * Every Saturday at 03:00 UTC, and when started by payroll authority: one run researches every sealed in-force
 * jurisdiction lineage (or the one `code` given) at once — lineages side by side, one multi-step inference per coverage
 * scope in turn — and
 * persists a complete corrected unsealed successor where every changed row cites official evidence that re-appears on
 * its page; a row whose evidence does not hold is left out. A no-change that leaves a coverage scope pending is
 * reported as incomplete, and a change names the scopes it did not reach. It never seals.
 */
const statutory_drift = automation({
	description:
		'Every Saturday, research every sealed in-force jurisdiction lineage at once — one web-researching inference per coverage scope — and save a corrected unsealed draft where official evidence verifies a change. A manual start may name one code. It never seals a version.',
	on: { cron: '0 3 * * 6' },
	input: { code: { kind: 'text', optional: true } },
	output: {
		kind: 'object',
		fields: {
			lineages: { kind: 'list', of: { kind: 'text' } },
			drafted: { kind: 'list', of: { kind: 'text' } },
			// A change the research reported that its evidence could not carry, as `<CODE>: <why>`.
			refused: { kind: 'list', of: { kind: 'text' } },
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
	// One lineage's snapshot (its first in-force version), or null when there is nothing to research.
	const prepare = (code: string) =>
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
			if (version == null) return null;
			if (held.rows.some((draft) => draft.cloned_from_id === version.id)) return null;
			const sources = sourcesFrom(version.sources);
			if (sources.urls.length === 0) return null;
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
			return { code, version, sources, snapshot };
		});
	type Prepared = Exclude<Effect.Success<ReturnType<typeof prepare>>, null>;
	const json = Schema.decodeUnknownSync(Schema.Json);
	// One lineage's research: one multi-step inference per coverage scope, each with its own step budget, over the draft
	// the scope before it left; a verified change becomes an unsealed draft.
	const research = ({ code, version, sources, snapshot }: Prepared) =>
		Effect.gen(function* () {
			let draft = snapshot;
			let effective_from = ctx.today;
			const summaries: string[] = [];
			// the scopes not resolved: their pass failed, ran out of budget, or answered an unusable draft
			const pending: string[] = [];
			for (const scope of COVERAGE_SCOPES) {
				const pass = yield* Effect.result(
					ctx.ai.sys_2.infer({
						model: 'strong',
						tools: ['web_search', 'browser_navigate', 'browser_snapshot', 'browser_act'],
						steps: 1000,
						system: STATUTORY_RESEARCH_ROLE,
						prompt: `Jurisdiction ${code}; review as of ${ctx.today}. This pass researches coverage scope ${scope} only. Official entry points and extraction instructions:\n${JSON.stringify(sources.entries ?? sources.urls)}\nComplete snapshot index (read original values in memory):\n${conciseSnapshot(draft)}`,
						initial: json({
							changed: false,
							summary: '',
							effective_from: ctx.today,
							coverage: [{ scope, status: 'pending' }],
							unresolved: [],
							snapshot: draft
						}),
						output: SNAPSHOT_OUTPUT
					})
				);
				if (Result.isFailure(pass)) {
					pending.push(`${scope} (${pass.failure.message})`);
					continue;
				}
				const result = pass.success;
				const open = result.coverage.some((item) => item.status === 'pending');
				if (
					!result.changed ||
					result.summary.trim() === '' ||
					!completeSnapshot(snapshot, result.snapshot)
				) {
					if (result.changed)
						pending.push(`${scope} (a change without a summary or a complete snapshot)`);
					else if (open) pending.push(scope);
					continue;
				}
				if (open) pending.push(scope);
				draft = result.snapshot;
				summaries.push(result.summary);
				// one draft takes effect once its latest correction does
				if (result.effective_from > effective_from) effective_from = result.effective_from;
			}
			// a no-change with any pending scope is incomplete, never a verified no-change; a change still drafts its
			// verified rows and names the pending scopes in its summary
			if (summaries.length === 0)
				return pending.length === 0
					? { code, drafted: false }
					: {
							code,
							drafted: false,
							failed: `${code}: incomplete — not resolved: ${pending.join(', ')}`
						};
			const summary =
				pending.length === 0
					? summaries.join('\n\n')
					: `${summaries.join('\n\n')}\n\nNot resolved: ${pending.join(', ')}.`;
			const refuse = (why: string) => ({
				code,
				drafted: false,
				refused: `${code}: ${why}${pending.length === 0 ? '' : `; not resolved: ${pending.join(', ')}`}`
			});
			const changes = rowChanges(
				snapshot,
				draft,
				jsonDiff(json(snapshot), json(draft), SNAPSHOT_OUTPUT.fields.snapshot)
			);
			if (Result.isFailure(changes)) return refuse(changes.failure);
			const rows = changes.success;
			if (rows.length === 0) return refuse('a change that edits no row');
			const evidence = rows.flatMap((row) => row.evidence);
			const cited = [...new Set(evidence.map((row) => row.url))].filter((url) =>
				allowedUrl(url, sources)
			);
			// A page that cannot be read verifies none of its quotes: its failure is the page's absence.
			const fetched = yield* Effect.forEach(cited, (url) => Effect.option(ctx.web.read(url)), {
				concurrency: 'unbounded'
			});
			const pages = fetched.flatMap((item) => {
				const page = Option.isSome(item) ? pageFrom(item.value) : null;
				return page == null ? [] : [page];
			});
			// a row whose evidence does not hold (none fresh, an unlisted origin, a quote not on its page) goes back to the
			// governing version's; the rest are still drafted
			const unverified = unverifiedQuotes(pages, evidence, sources);
			const dropped = rows.filter(
				(row) => row.evidence.length === 0 || row.evidence.some((cite) => unverified.includes(cite))
			);
			const kept = rows.filter((row) => !dropped.includes(row));
			const why = dropped
				.map(
					(row) =>
						`${row.section}/${row.code} (${
							row.evidence.length === 0
								? 'cites no new url and quote'
								: row.evidence
										.filter((cite) => unverified.includes(cite))
										.map((cite) =>
											allowedUrl(cite.url, sources)
												? `quote not found: "${cite.quote.slice(0, 60)}" at ${cite.url}`
												: `cites unlisted ${cite.url}`
										)
										.join('; ')
						})`
				)
				.join(', ');
			if (kept.length === 0) return refuse(`no row's evidence held: ${why}`);
			const corrected = withoutRows(snapshot, draft, dropped);
			// The governing version's research registry (`sources`) carries over unchanged through `version`.
			yield* ctx.act('jurisdiction_settings.create', {
				...cloneSettingsFields({ ...version, ...corrected.settings }, effective_from),
				change_summary: changeSummary(kept, summary),
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
			return dropped.length === 0
				? { code, drafted: true }
				: { code, drafted: true, refused: `${code}: dropped ${why}` };
		});
	const lineages = lineageCodes(inForce);
	type Outcome = {
		readonly code: string;
		readonly drafted: boolean;
		readonly refused?: string;
		readonly failed?: string;
	};
	const failure = (code: string) => (error: { readonly message: string }) =>
		Effect.succeed({ code, drafted: false, failed: `${code}: ${error.message}` });
	// Snapshots are read one lineage at a time: concurrent reads share one host crossing and its size limit. The
	// inferences then run at once; a lineage that fails is reported and the others still finish.
	const prepared = yield* Effect.forEach(lineages, (code) =>
		prepare(code).pipe(
			Effect.map((ready) => ({ code, ready })),
			Effect.catch(failure(code))
		)
	);
	const results = yield* Effect.forEach(
		prepared,
		(item): Effect.Effect<Outcome> =>
			!('ready' in item)
				? Effect.succeed(item)
				: item.ready === null
					? Effect.succeed({ code: item.code, drafted: false })
					: research(item.ready).pipe(Effect.catch(failure(item.code))),
		{ concurrency: 'unbounded' }
	);
	return {
		lineages,
		drafted: results.filter((result) => result.drafted).map((result) => result.code),
		refused: results.flatMap((result) => (result.refused === undefined ? [] : [result.refused])),
		failed: results.flatMap((result) => (result.failed === undefined ? [] : [result.failed]))
	};
});
