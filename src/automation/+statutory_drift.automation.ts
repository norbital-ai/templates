import { Effect, Option, Result, Schema } from 'effect';
import { automation, jsonDiff } from '@norbital-ai/bolt';
import { readAll, Reads, readsFrom } from '../lib/payroll_engine/foundation.js';
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
	decodeSnapshot,
	agentDraft,
	agentView,
	conciseSnapshot,
	mergeAgent,
	snapshotFields,
	snapshotProblem,
	snapshotSelect,
	SNAPSHOT_MODELS,
	SNAPSHOT_OUTPUT,
	STATUTORY_RESEARCH_ROLE,
	type StatutorySnapshot
} from '../lib/payroll_engine/statutory_snapshot.js';
import {
	AGENT_JOBS,
	AGENT_SECTIONS,
	RESEARCH_AGENT_NAMES
} from '../lib/payroll_engine/research_agents.js';
/** Catalogue rows per page: every page fits one crossing. */
const SECTION_PAGE = 50;
/**
 * Every Saturday at 03:00 UTC, and when started by payroll authority: one run researches every sealed in-force
 * jurisdiction lineage (or the one `code` given) one lineage at a time — six agents per lineage (catalog, contribution,
 * rules, behaviour, obligations, settings) side by side — merges each lineage's answers and persists
 * a complete corrected unsealed successor where every changed row cites official evidence that re-appears on its page;
 * a row whose evidence does not hold is left out. A no-change that leaves an agent unresolved is reported as
 * incomplete, and a change names the agents it did not resolve. It never seals: a person reviews and seals the draft.
 */
export default automation('statutory_drift', {
	description:
		'Every Saturday, research every sealed in-force jurisdiction lineage one lineage at a time — six web-researching agents per lineage, side by side — and save a corrected unsealed draft where official evidence verifies a change. A manual start may name one code. It never seals a version.',
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
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		// the in-force lineages, light; each research reads its own snapshot
		const { rows: inForce } = yield* ctx.query('jurisdiction_settings', {
			where: {
				...(input.code == null || input.code === '' ? {} : { code: { eq: input.code } }),
				sealed_at: { isNull: false },
				voided_at: { isNull: true },
				effective_range: { contains: ctx.today }
			},
			select: { id: true, code: true },
			all: true
		});
		// One lineage's snapshot (its first in-force version), or null when there is nothing to research.
		const prepare = (code: string) =>
			Effect.gen(function* () {
				// the in-force versions and their open drafts, light; a lineage left out reads no catalogue
				const { versions, held } = yield* ctx.query({
					versions: {
						from: 'jurisdiction_settings',
						where: {
							code: { eq: code },
							sealed_at: { isNull: false },
							voided_at: { isNull: true },
							effective_range: { contains: ctx.today }
						},
						select: {
							id: true,
							code: true,
							jurisdiction_code: true,
							name: true,
							employee_input_schema: true,
							entity_input_schema: true,
							behaviours: true,
							references: true,
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
						from: 'jurisdiction_settings',
						where: {
							cloned_from_id: { in: { member: 'versions', field: 'id' } },
							sealed_at: { isNull: true },
							voided_at: { isNull: true }
						},
						select: { id: true, cloned_from_id: true },
						all: true
					}
				});
				const version = versions.rows[0];
				if (version == null) return null;
				if (held.rows.some((draft) => draft.cloned_from_id === version.id)) return null;
				const sources = sourcesFrom(version.sources);
				if (sources.urls.length === 0) return null;
				// The governing version's catalogues, a section at a time and a page per crossing: one rule set can outweigh a
				// crossing, and every page passes through the workspace engine's own memory.
				const where = { settings_id: { eq: version.id } };
				const adhoc = yield* readAll(
					'adhoc_catalog',
					where,
					SECTION_PAGE,
					snapshotSelect(SNAPSHOT_MODELS.adhoc_catalog.fields)
				);
				const allowance = yield* readAll(
					'allowance_catalog',
					where,
					SECTION_PAGE,
					snapshotSelect(SNAPSHOT_MODELS.allowance_catalog.fields)
				);
				const claim = yield* readAll(
					'claim_catalog',
					where,
					SECTION_PAGE,
					snapshotSelect(SNAPSHOT_MODELS.claim_catalog.fields)
				);
				const leave = yield* readAll(
					'leave_catalog',
					where,
					SECTION_PAGE,
					snapshotSelect(SNAPSHOT_MODELS.leave_catalog.fields)
				);
				const loan = yield* readAll(
					'loan_catalog',
					where,
					SECTION_PAGE,
					snapshotSelect(SNAPSHOT_MODELS.loan_catalog.fields)
				);
				const work = yield* readAll(
					'work_catalog',
					where,
					SECTION_PAGE,
					snapshotSelect(SNAPSHOT_MODELS.work_catalog.fields)
				);
				const contribution = yield* readAll(
					'statutory_contribution_catalog',
					where,
					SECTION_PAGE,
					snapshotSelect(SNAPSHOT_MODELS.statutory_contribution_catalog.fields)
				);
				const rules = yield* readAll(
					'rule_set',
					where,
					SECTION_PAGE,
					snapshotSelect(SNAPSHOT_MODELS.rule_set.fields)
				);
				const snapshot = yield* decodeSnapshot({
					settings: snapshotFields(version, SNAPSHOT_MODELS.settings.fields),
					adhoc_catalog: adhoc.map((row) =>
						snapshotFields(row, SNAPSHOT_MODELS.adhoc_catalog.fields)
					),
					allowance_catalog: allowance.map((row) =>
						snapshotFields(row, SNAPSHOT_MODELS.allowance_catalog.fields)
					),
					claim_catalog: claim.map((row) =>
						snapshotFields(row, SNAPSHOT_MODELS.claim_catalog.fields)
					),
					leave_catalog: leave.map((row) =>
						snapshotFields(row, SNAPSHOT_MODELS.leave_catalog.fields)
					),
					loan_catalog: loan.map((row) => snapshotFields(row, SNAPSHOT_MODELS.loan_catalog.fields)),
					work_catalog: work.map((row) => snapshotFields(row, SNAPSHOT_MODELS.work_catalog.fields)),
					statutory_contribution_catalog: contribution.map((row) =>
						snapshotFields(row, SNAPSHOT_MODELS.statutory_contribution_catalog.fields)
					),
					suspension_kind: version.suspension_kinds ?? [],
					rule_set: rules.map((row) => snapshotFields(row, SNAPSHOT_MODELS.rule_set.fields)),
					behaviour_rule: (version.behaviours?.rules ?? []).map(({ id, ...rule }) => ({
						code: id,
						...rule
					}))
				});
				return { code, version, sources, snapshot };
			}).pipe(Effect.provideService(Reads, readsFrom(ctx.query)));
		type Prepared = Exclude<Effect.Success<ReturnType<typeof prepare>>, null>;
		const json = Schema.decodeUnknownSync(Schema.Json);
		// The rows a merged draft changed whose evidence holds: each cites a fresh quote that re-appears on its page on a
		// registered official site. A row whose evidence does not hold goes back to the governing version's; the failure
		// says why no row is left.
		const verify = (
			sources: Prepared['sources'],
			snapshot: StatutorySnapshot,
			draft: StatutorySnapshot
		) =>
			Effect.gen(function* () {
				const changes = rowChanges(
					snapshot,
					draft,
					jsonDiff(json(snapshot), json(draft), SNAPSHOT_OUTPUT.fields.snapshot)
				);
				if (Result.isFailure(changes)) return Result.fail(changes.failure);
				const rows = changes.success;
				if (rows.length === 0) return Result.fail('a change that edits no row');
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
				const unverified = unverifiedQuotes(pages, evidence, sources);
				const dropped = rows.filter(
					(row) =>
						row.evidence.length === 0 || row.evidence.some((cite) => unverified.includes(cite))
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
				if (kept.length === 0) return Result.fail(`no row's evidence held: ${why}`);
				return Result.succeed({
					kept,
					dropped,
					why,
					corrected: withoutRows(snapshot, draft, dropped)
				});
			});
		// One lineage's research: six agents side by side, each one multi-step inference with its own step budget over the
		// sections it owns and its own sources; their answers merge into one snapshot, and a verified change becomes an
		// unsealed draft.
		const research = ({ code, version, sources, snapshot }: Prepared) =>
			Effect.gen(function* () {
				const answers = yield* Effect.forEach(
					RESEARCH_AGENT_NAMES,
					(agent) =>
						Effect.result(
							ctx.ai.sys_2.infer({
								model: 'strong',
								tools: ['web_search', 'browser_navigate', 'browser_snapshot', 'browser_act'],
								steps: 1000,
								// its transcript reads as `statutory_drift · MY · contribution` in the agent panel
								label: `${code} · ${agent}`,
								system: STATUTORY_RESEARCH_ROLE,
								// Markdown, as the transcript renders it: headed sections, the sources a list, the index a fenced block
								prompt: [
									`# ${code} · ${agent}`,
									`Review as of ${ctx.today}. You are the ${agent} agent: you own ${AGENT_JOBS[agent]} (snapshot sections: ${AGENT_SECTIONS[agent].map((section) => `\`${section}\``).join(', ')}).`,
									...(sources.agents[agent] === undefined
										? []
										: [`## Supplementary instructions for ${code}`, sources.agents[agent]]),
									'## Your official sources and how to read them',
									sources.entries
										.filter((entry) => entry.agent === agent)
										.map(
											(entry, at) =>
												`${at}. <${entry.url}> (\`/sources/${at}\`)\n   ${entry.instructions}`
										)
										.join('\n'),
									'## Index of the snapshot sections you own (read original values in memory)',
									`\`\`\`json\n${conciseSnapshot(agentView(snapshot, agent))}\n\`\`\``
								].join('\n\n'),
								initial: json({
									changed: false,
									summary: '',
									effective_from: ctx.today,
									coverage: [{ scope: agent, status: 'pending' }],
									unresolved: [],
									sources: sources.entries
										.filter((entry) => entry.agent === agent)
										.map(({ url, instructions }) => ({ url, instructions })),
									// its own rows only: the engine holds every agent's draft for the whole inference
									snapshot: agentDraft(snapshot, agent)
								}),
								output: SNAPSHOT_OUTPUT
							})
						).pipe(Effect.map((answer) => ({ agent, answer }))),
					{ concurrency: 'unbounded' }
				);
				let draft = snapshot;
				let effective_from = ctx.today;
				const summaries: string[] = [];
				// what each agent could not verify, for the person who reviews the draft
				const unresolved: string[] = [];
				// the agents not resolved: their inference failed, ran out of budget, or answered an unusable draft
				const pending: string[] = [];
				for (const { agent, answer } of answers) {
					if (Result.isFailure(answer)) {
						pending.push(`${agent} (${answer.failure.message})`);
						continue;
					}
					const result = answer.success;
					unresolved.push(...result.unresolved.map((item) => `${agent}: ${item}`));
					const open = result.coverage.some((item) => item.status === 'pending');
					// an agent that drafts no settings answers for the governing version's
					const answered = AGENT_SECTIONS[agent].includes('settings')
						? result.snapshot
						: { ...result.snapshot, settings: snapshot.settings };
					if (!completeSnapshot(snapshot, answered)) {
						pending.push(
							`${agent} (an incomplete snapshot: ${snapshotProblem(snapshot, answered) ?? ''})`
						);
						continue;
					}
					if (open) pending.push(agent);
					// only the agent's own rows are taken: what it edited elsewhere belongs to another agent. What it drafted is
					// that difference, declared or not: an agent its time ran out on keeps every edit it made, verified below
					const merged = mergeAgent(draft, agent, answered);
					if (JSON.stringify(merged) === JSON.stringify(draft)) continue;
					draft = merged;
					// a missing paragraph never discards evidenced rows: the change summary lists every row anyway
					summaries.push(
						`${agent}: ${result.summary.trim() === '' ? '(no summary written; see the rows above)' : result.summary}`
					);
					// one draft takes effect once its latest correction does
					if (result.effective_from > effective_from) effective_from = result.effective_from;
				}
				// Each agent's source entries as it left them: an added or changed entry is taken only when it is a live page
				// (not a document) on a registered official site and readable now; an agent always keeps one entry.
				const switched = yield* Effect.forEach(
					answers,
					({ agent, answer }) =>
						Effect.gen(function* () {
							const own = sources.entries.filter((entry) => entry.agent === agent);
							const proposed = Result.isSuccess(answer) ? answer.success.sources : own;
							const fresh = proposed.filter(
								(entry) =>
									!own.some(
										(old) => old.url === entry.url && old.instructions === entry.instructions
									)
							);
							const live = yield* Effect.forEach(
								fresh,
								(entry) =>
									allowedUrl(entry.url, sources)
										? Effect.option(ctx.web.read(entry.url)).pipe(
												Effect.map(
													(page) =>
														Option.isSome(page) &&
														/html/i.test(page.value.contentType ?? '') &&
														page.value.text.trim() !== ''
												)
											)
										: Effect.succeed(false),
								{ concurrency: 'unbounded' }
							);
							const refused = fresh.filter((_, at) => !live[at]);
							const reasons = refused.map(
								(entry) =>
									`${agent} source ${entry.url} (${allowedUrl(entry.url, sources) ? 'not a readable live page' : 'not on a registered official site'})`
							);
							const next = proposed
								.filter((entry) => !refused.includes(entry))
								.map(({ url, instructions }) => ({ agent, url, instructions }));
							if (next.length === 0)
								return {
									entries: own,
									notes: [],
									refused: proposed.length === 0 ? [`${agent} removed every source`] : reasons
								};
							const notes = [
								...next.flatMap((entry) => {
									const was = own.find((old) => old.url === entry.url);
									return was === undefined
										? [`${agent} added ${entry.url}`]
										: was.instructions === entry.instructions
											? []
											: [`${agent} rewrote the instructions for ${entry.url}`];
								}),
								...own
									.filter((old) => !next.some((entry) => entry.url === old.url))
									.map((old) => `${agent} removed ${old.url}`)
							];
							return { entries: next, notes, refused: reasons };
						}),
					{ concurrency: 'unbounded' }
				);
				const sourceNotes = switched.flatMap((item) => item.notes);
				const refusals = switched.flatMap((item) => item.refused);
				// a no-change with any unresolved agent is incomplete, never a verified no-change; a change still drafts its
				// verified rows and names the unresolved agents in its summary
				if (summaries.length === 0 && sourceNotes.length === 0)
					return {
						code,
						drafted: false,
						...(pending.length === 0
							? {}
							: { failed: `${code}: incomplete — not resolved: ${pending.join(', ')}` }),
						...(refusals.length === 0 ? {} : { refused: `${code}: ${refusals.join(', ')}` })
					};
				const notResolved = pending.length === 0 ? '' : `; not resolved: ${pending.join(', ')}`;
				// the rows whose evidence holds; a failure says why none is drafted
				const checked =
					summaries.length === 0
						? Result.succeed({ kept: [], dropped: [], why: '', corrected: snapshot })
						: yield* verify(sources, snapshot, draft);
				if (Result.isFailure(checked) && sourceNotes.length === 0)
					return {
						code,
						drafted: false,
						refused: `${code}: ${[checked.failure, ...refusals].join(', ')}${notResolved}`
					};
				const { kept, dropped, why, corrected } = Result.isSuccess(checked)
					? checked.success
					: { kept: [], dropped: [], why: '', corrected: snapshot };
				const summary = [
					...summaries,
					...(sourceNotes.length === 0
						? []
						: [`Sources:\n${sourceNotes.map((item) => `- ${item}`).join('\n')}`]),
					...(unresolved.length === 0
						? []
						: [`Unresolved:\n${unresolved.map((item) => `- ${item}`).join('\n')}`]),
					...(pending.length === 0 ? [] : [`Not resolved: ${pending.join(', ')}.`])
				].join('\n\n');
				// The governing version's research registry (`sources`) carries over through `version`, with each agent's
				// admitted entries when one switched.
				yield* ctx.act('jurisdiction_settings.create', {
					...cloneSettingsFields(
						{
							...version,
							...corrected.settings,
							...(sourceNotes.length === 0
								? {}
								: {
										sources: {
											...version.sources,
											entries: switched.flatMap((item) => item.entries)
										}
									}),
							behaviours: {
								version: 1,
								rules: corrected.behaviour_rule.map(({ code: id, ...rule }) => ({ id, ...rule }))
							}
						},
						effective_from
					),
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
				const reasons = [
					...(Result.isFailure(checked)
						? [checked.failure]
						: dropped.length === 0
							? []
							: [`dropped ${why}`]),
					...refusals
				];
				return reasons.length === 0
					? { code, drafted: true }
					: { code, drafted: true, refused: `${code}: ${reasons.join(', ')}` };
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
		// Keep one lineage's snapshot and six agent drafts within the cell's 128 MiB budget.
		// Prepare the next lineage only after the current research finishes.
		const results = yield* Effect.forEach(
			lineages,
			(code): Effect.Effect<Outcome> =>
				prepare(code).pipe(
					Effect.flatMap((ready) =>
						ready === null ? Effect.succeed({ code, drafted: false }) : research(ready)
					),
					Effect.catch(failure(code))
				),
			{ concurrency: 1 }
		);
		return {
			lineages,
			drafted: results.filter((result) => result.drafted).map((result) => result.code),
			refused: results.flatMap((result) => (result.refused === undefined ? [] : [result.refused])),
			failed: results.flatMap((result) => (result.failed === undefined ? [] : [result.failed]))
		};
	}
});
