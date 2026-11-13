import { automation } from '@norbital-ai/bolt';
import { add_days } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { JsonObject } from '../lib/payroll_engine/contracts.js';
import { objectValue, queryAllRows, queryRows, valueText } from '../lib/payroll_engine/reads.js';
import { jsonObject, Refusal, type Json } from '../lib/payroll_engine/foundation.js';
import {
	officialSource,
	SETTINGS_FAMILY,
	WHOLE_ROW
} from '../lib/payroll_engine/statutory_change.js';
import {
	FAMILIES,
	FAMILY_NOTES,
	planChanges,
	referenceSources,
	sortFindings,
	type KnownChange
} from '../lib/payroll_engine/statutory_research.js';

/** Native identity and audit columns never travel into a researched object. */
const SYSTEM = new Set(['id', 'revision', 'created_at', 'updated_at', 'created_by', 'updated_by']);
const business = (row: JsonObject): JsonObject =>
	Object.fromEntries(
		Object.entries(row).filter(([key]) => !SYSTEM.has(key) && !key.startsWith('$'))
	);
const byCode = (rows: readonly JsonObject[]): readonly JsonObject[] =>
	[...rows].toSorted((left, right) =>
		String(left.code ?? '').localeCompare(String(right.code ?? ''))
	);

/** Confirmed law this close to taking effect needs merging before the payroll that reads it. */
const DUE_DAYS = 14;
const FINDINGS_ROLE =
	"You watch one jurisdiction's payroll law for what changed. Report each legal instrument (an act, regulation, gazette notice or official rate announcement) that differs from the configuration given or is announced to change it, and classify how it fits. Never write a model: the automation records your answer as proposals for human review.";
const AUDIT_ROLE =
	"You audit one family of a jurisdiction's payroll configuration value by value. For each row, compare every rate, ceiling, amount and day count with the row's own `references` quotes and with official law in force, and report each instrument whose official value differs from the configuration. A value that contradicts its own quoted law is a finding even when no search confirms it. Never write a model: the automation records your answer as proposals for human review.";
const CHANGES_ROLE =
	'You check one jurisdiction payroll configuration against one legal instrument. Report only the fields whose official value differs from the configuration given, each as one change. Never invent an effective date: leave `effective_from` empty unless the source states it. Never write a model: the automation records your answer as proposals for human review.';
const fromOf = (row: JsonObject): string => String(objectValue(row.effective_range).from ?? '');
const toOf = (row: JsonObject): string | null => {
	const to = objectValue(row.effective_range).to;
	return typeof to === 'string' ? to : null;
};
const text = (value: Json | undefined): string | null =>
	typeof value === 'string' && value !== '' ? value : null;

export default automation({
	description:
		'Every Saturday, one research agent per jurisdiction in use reads its official sources and records each legal instrument it finds as a proposed statutory finding, classified against the catalogue families; a second agent per affected family drafts the dated changes. It never writes configuration.',
	on: [{ cron: '0 3 * * 6' }],
	input: {
		code: { kind: 'text', optional: true },
		family: { kind: 'text', optional: true },
		finding: { kind: 'text', optional: true }
	},
	output: {
		kind: 'object',
		fields: {
			sources: { kind: 'text', many: true },
			researched: { kind: 'text', many: true },
			proposed: { kind: 'text', many: true },
			known: { kind: 'text', many: true }
		}
	},
	policies: ['configuration_execution'],
	concurrency: { max: 12 },
	run: function* (input, ctx) {
		const none = { sources: [], researched: [], proposed: [], known: [] };
		const code = text(input.code);
		// One run per jurisdiction in use: a single run may not exceed the host's 3 s guest CPU budget.
		if (code === null) {
			const used = yield* queryAllRows(ctx.query, {
				entity: { fields: ['settings_code'], limit: 10000 },
				statutory_change: {
					where: {
						applied_version_id: { is_null: true },
						effective_from: { lte: add_days(ctx.today, DUE_DAYS) },
						finding_id: { is: { status: { eq: 'CONFIRMED' } } }
					},
					fields: ['jurisdiction_code', 'effective_from'],
					limit: 10000
				}
			});
			for (const settings_code of new Set(
				(used.entity ?? []).map((row) => valueText(row, 'settings_code'))
			))
				yield* ctx.schedule('statutory_research', {
					code: settings_code,
					...(text(input.family) === null ? {} : { family: input.family })
				});
			// the watch finds what is new; only a value-by-value audit finds a value that was wrong or went stale unannounced
			if (text(input.family) === null)
				for (const settings_code of new Set(
					(used.entity ?? []).map((row) => valueText(row, 'settings_code'))
				))
					for (const family of FAMILIES)
						yield* ctx.schedule('statutory_research', { code: settings_code, family });
			const due = [
				...new Set(
					(used.statutory_change ?? []).map(
						(row) => `${valueText(row, 'jurisdiction_code')} ${valueText(row, 'effective_from')}`
					)
				)
			].toSorted();
			if (due.length > 0)
				yield* ctx.notify([
					{
						title: 'Statutory releases are due to merge',
						description: due.join(', '),
						to: [{ team: 'hr_controller' }],
						once: `statutory-due-${ctx.today}`
					}
				]);
			return none;
		}

		const held = yield* queryAllRows(ctx.query, {
			jurisdiction_settings: {
				where: { code: { eq: code }, status: { eq: 'SEALED' } },
				limit: 10000
			},
			statutory_finding: { where: { jurisdiction_code: { eq: code } }, limit: 10000 },
			statutory_source: { where: { jurisdiction_code: { eq: code } }, limit: 10000 },
			statutory_change: { where: { jurisdiction_code: { eq: code } }, limit: 10000 }
		});
		const sealed = (held.jurisdiction_settings ?? []).toSorted((left, right) =>
			fromOf(left).localeCompare(fromOf(right))
		);
		const standing = sealed.filter((row) => {
			const to = toOf(row);
			return to === null || ctx.today <= to;
		});
		const inForce = standing.find((row) => fromOf(row) <= ctx.today);
		if (inForce === undefined) return none;
		const findings = held.statutory_finding ?? [];
		const sources = held.statutory_source ?? [];
		const live = sources.filter((row) => row.status === 'ACTIVE');
		// an activated replacement takes over from the page it replaces
		const moved = new Set(live.map((row) => row.replaces_url));
		const active = live.filter((row) => !moved.has(row.url));

		// an update names each record at the revision it is read at now
		const at = Effect.fnUntraced(function* (
			model: 'statutory_finding' | 'statutory_source',
			ids: readonly string[]
		) {
			const { [model]: rows = [] } = yield* queryRows(ctx.query, {
				[model]: { where: { id: { in: [...ids] } }, fields: ['revision'], limit: 10000 }
			});
			return new Map(
				rows.map((row) => [
					valueText(row, 'id'),
					{ id: row.id ?? null, revision: row.revision ?? null }
				])
			);
		});
		const write = Effect.fnUntraced(function* (
			callable: 'statutory_finding.create' | 'statutory_source.create',
			rows: readonly JsonObject[]
		) {
			if (rows.length === 0) return [];
			const acts: JsonObject = { [callable]: rows };
			const answer = yield* ctx.act(acts);
			if (answer.kind !== 'committed')
				return yield* Effect.fail(
					new Refusal({ message: `${callable}: the write was held for approval.` })
				);
			return answer.records;
		});

		const finding = text(input.finding);
		if (finding !== null) {
			const family = text(input.family);
			const instrument = findings.find((row) => row.id === finding);
			if (family === null || instrument === undefined)
				return yield* Effect.fail(new Refusal({ message: `${finding}: no such finding.` }));
			const ids = standing.map((row) => valueText(row, 'id'));
			const children = yield* queryAllRows(ctx.query, {
				subtotal: { where: { settings_id: { in: ids } }, limit: 10000 },
				...(family === SETTINGS_FAMILY
					? {}
					: { [family]: { where: { settings_id: { in: ids } }, limit: 10000 } })
			});
			const rowsOf = (id: string) =>
				byCode((children[family] ?? []).filter((row) => row.settings_id === id).map(business));
			const label = `${code}/${family}`;
			const answer = yield* ctx.ai.sys_2.infer({
				model: 'strong',
				tools: ['web_search'],
				steps: 3,
				label,
				system: CHANGES_ROLE,
				prompt: [
					`# ${code} · ${family}: ${valueText(instrument, 'title')}`,
					text(instrument.summary) ?? '',
					`Sources: ${JSON.stringify(instrument.source_urls)}`,
					`Quoted: ${text(instrument.source_quote) ?? 'nothing yet'}`,
					`This configuration is effective ${JSON.stringify(inForce.effective_range)}. Sealed later versions start ${JSON.stringify(standing.filter((row) => fromOf(row) > ctx.today).map(fromOf))}.`,
					`Each change names one field: \`row_code\` the catalogue row's code (empty for the jurisdiction configuration), \`field_path\` its dot path (for example \`lookup.monthly_salary_ceiling\`), \`new_value\` the official value. A new or removed catalogue row uses \`field_path\` \`${WHOLE_ROW}\`, with \`new_value\` the whole row shaped like its neighbours or empty; it names subtotals by the codes below. A law that steps through several dates gives one change per date.`,
					"Give the law's own `effective_from` (YYYY-MM-DD) only where the source states it. Note doubts in `notes`.",
					'## Subtotals',
					'```json',
					JSON.stringify(
						(children.subtotal ?? [])
							.filter((row) => row.settings_id === inForce.id)
							.map((row) => ({ code: row.code, name: row.name }))
					),
					'```',
					'## Jurisdiction configuration',
					'```json',
					JSON.stringify(business(inForce), null, 2),
					'```',
					'## Current catalogue rows',
					'```json',
					JSON.stringify(rowsOf(valueText(inForce, 'id')), null, 2),
					'```',
					'If nothing differs, return no changes. Use `web_search` at most twice; do not browse or open pages.'
				].join('\n\n'),
				initial: { changes: [] },
				output: {
					kind: 'object',
					fields: {
						changes: {
							kind: 'object',
							many: true,
							fields: {
								row_code: { kind: 'text', optional: true },
								field_path: { kind: 'text' },
								new_value: { kind: 'json', optional: true },
								effective_from: { kind: 'text', optional: true },
								notes: { kind: 'text', optional: true }
							}
						}
					}
				}
			});
			const statusOf = new Map(findings.map((row) => [row.id, row.status]));
			const known: readonly KnownChange[] = (held.statutory_change ?? []).map((row) => ({
				family: valueText(row, 'family'),
				row_code: text(row.row_code),
				field_path: valueText(row, 'field_path'),
				new_value: row.new_value ?? null,
				effective_from: text(row.effective_from),
				settled: statusOf.get(row.finding_id ?? '') === 'REJECTED' || row.applied_version_id != null
			}));
			const { planned, skipped } = planChanges({
				family,
				versions: standing.map((row) => ({
					id: valueText(row, 'id'),
					from: fromOf(row),
					to: toOf(row),
					settings: business(row),
					rows: rowsOf(valueText(row, 'id')),
					subtotals: (children.subtotal ?? []).filter((subtotal) => subtotal.settings_id === row.id)
				})),
				known,
				reported: answer.changes ?? [],
				today: ctx.today
			});
			if (planned.length > 0) {
				const acts: JsonObject = {
					'statutory_change.create': planned.map((change) => ({
						...change,
						finding_id: finding,
						jurisdiction_code: code
					}))
				};
				const written = yield* ctx.act(acts);
				if (written.kind !== 'committed')
					return yield* Effect.fail(
						new Refusal({ message: 'statutory_change.create: the write was held for approval.' })
					);
			}
			const named = (row: { family: string; row_code: string | null; field_path: string }) =>
				`${label}/${row.row_code ?? 'settings'}/${row.field_path}`;
			return { ...none, researched: [label], proposed: planned.map(named), known: skipped };
		}

		const families = FAMILIES.filter(
			(family) => text(input.family) === null || family === input.family
		);
		const scoped = valueText(inForce, 'id');
		const catalogues = yield* queryAllRows(ctx.query, {
			subtotal: { where: { settings_id: { eq: scoped } }, limit: 10000 },
			...Object.fromEntries(
				FAMILIES.map((family) => [family, { where: { settings_id: { eq: scoped } }, limit: 10000 }])
			)
		});
		const audit = text(input.family) !== null;
		const label = audit ? `${code}/${input.family}` : code;
		const rowsOfSources = FAMILIES.flatMap((family) => catalogues[family] ?? []);
		const bootstrapped = referenceSources(
			rowsOfSources,
			sources.map((row) => valueText(row, 'url'))
		);
		const places = [
			...active.map((row) => valueText(row, 'url')),
			...bootstrapped.filter((row) => row.status === 'ACTIVE').map((row) => row.url)
		];
		const answer = yield* ctx.ai.sys_2.infer({
			model: 'strong',
			tools: ['web_search'],
			steps: 6,
			label,
			system: audit ? AUDIT_ROLE : FINDINGS_ROLE,
			prompt: [
				`# ${label}: what changed in the law`,
				`Check ${code} against official law as of ${ctx.today}. This configuration is effective ${JSON.stringify(inForce.effective_range)}.`,
				`Each finding names one instrument by its official citation in \`instrument\` (for example \`PP 46/2015\`; the same law must keep the same citation), with \`source_urls\` and the exact sentence or table in \`source_quote\`.`,
				'`fit` is `VALUE` when a value in an existing row changes, `ROW` when a new or removed row of an existing family carries it, and `STRUCTURAL` when no family below can hold it (a new kind of scheme or calculation, a new subtotal, rule or filing). `families` names every family it touches; a new scheme is classified by what it does, not by what it is called.',
				'## Families',
				'```json',
				JSON.stringify(
					Object.fromEntries(
						[SETTINGS_FAMILY, ...FAMILIES].map((family) => [
							family,
							{
								holds: FAMILY_NOTES[family],
								rows: (catalogues[family] ?? []).map((row) => ({
									code: row.code,
									name: row.name,
									lookup: row.lookup
								}))
							}
						])
					)
				),
				'```',
				...(!audit
					? []
					: [
							'## Audit these rows: every value, against its `references` and official law',
							'```json',
							JSON.stringify(
								families.flatMap((family) => byCode(catalogues[family] ?? []).map(business))
							),
							'```'
						]),
				'## Subtotals',
				JSON.stringify((catalogues.subtotal ?? []).map((row) => row.code)),
				'## Jurisdiction configuration',
				'```json',
				JSON.stringify(business(inForce)),
				'```',
				'## Sealed later versions',
				JSON.stringify(standing.filter((row) => fromOf(row) > ctx.today).map((row) => row.name)),
				'## Official places to check',
				JSON.stringify(places),
				'List an official place you find that is missing above in `new_sources`, with `replaces_url` when it replaces one that moved.',
				'## Already on file; do not report these again',
				JSON.stringify(findings.map((row) => row.title)),
				'If nothing differs, return no findings. Use `web_search` at most four times; do not browse or open pages. Use only government, tax-authority or social-security sources.'
			].join('\n\n'),
			initial: { findings: [], new_sources: [] },
			output: {
				kind: 'object',
				fields: {
					findings: {
						kind: 'object',
						many: true,
						fields: {
							instrument: { kind: 'text' },
							title: { kind: 'text' },
							fit: { kind: 'enum', values: ['VALUE', 'ROW', 'STRUCTURAL'] },
							families: { kind: 'text', many: true },
							summary: { kind: 'text', optional: true },
							announced_on: { kind: 'text', optional: true },
							source_urls: { kind: 'text', many: true },
							source_quote: { kind: 'text', optional: true },
							notes: { kind: 'text', optional: true }
						}
					},
					new_sources: {
						kind: 'object',
						many: true,
						fields: {
							url: { kind: 'text' },
							title: { kind: 'text' },
							family: { kind: 'text', optional: true },
							replaces_url: { kind: 'text', optional: true }
						}
					}
				}
			}
		});

		const { fresh, merged, decided } = sortFindings(
			answer.findings ?? [],
			findings.map((row) => ({
				id: valueText(row, 'id'),
				instrument_key: valueText(row, 'instrument_key'),
				status: valueText(row, 'status'),
				source_urls: (Array.isArray(row.source_urls) ? row.source_urls : []).map(String)
			}))
		);
		const recorded = new Set([
			...sources.map((row) => row.url),
			...bootstrapped.map((row) => row.url)
		]);
		const proposedSources = new Map(
			(answer.new_sources ?? [])
				.filter((row) => !recorded.has(row.url) && URL.canParse(row.url))
				.map((row) => [row.url, row])
		);
		if (live.length > active.length) {
			const retired: JsonObject = {
				'statutory_source.update': live
					.filter((row) => moved.has(row.url))
					.map((row) => ({ target: row, set: { status: 'RETIRED' } }))
			};
			yield* ctx.act(retired);
		}
		const created = yield* write('statutory_finding.create', [
			...fresh.map((row) =>
				jsonObject({ ...row, jurisdiction_code: code, research_run_id: ctx.run.id })
			)
		]);
		if (merged.length > 0) {
			const targets = yield* at(
				'statutory_finding',
				merged.map(([target]) => String(target))
			);
			const urls: JsonObject = {
				'statutory_finding.update': merged.map(([target, source_urls]) => ({
					target: targets.get(String(target)) ?? null,
					set: { source_urls }
				}))
			};
			yield* ctx.act(urls);
		}
		const opened = yield* write('statutory_source.create', [
			...bootstrapped.map(({ title, url }) =>
				jsonObject({
					title,
					url,
					jurisdiction_code: code,
					origin: 'REFERENCE',
					research_run_id: ctx.run.id
				})
			),
			...[...proposedSources.values()].map((row) =>
				jsonObject({
					...row,
					jurisdiction_code: code,
					origin: 'AGENT',
					research_run_id: ctx.run.id
				})
			)
		]);
		// a sealed version's official citation needs no second review; every active source records this check
		const checked = [
			...active.map((row) => valueText(row, 'id')),
			...bootstrapped.flatMap((row, index) =>
				row.status === 'ACTIVE' ? [String(opened[index]?.id)] : []
			)
		];
		if (checked.length > 0) {
			const targets = yield* at('statutory_source', checked);
			const stamped: JsonObject = {
				'statutory_source.update': checked.map((target) => ({
					target: targets.get(target) ?? null,
					set: { status: 'ACTIVE', last_checked_on: ctx.today }
				}))
			};
			yield* ctx.act(stamped);
		}
		const ids = created.filter((row) => row.model === 'statutory_finding');
		for (const [index, row] of fresh.entries()) {
			const id = ids[index]?.id;
			if (id === undefined || row.fit === 'STRUCTURAL') continue;
			for (const family of row.families ?? [])
				yield* ctx.schedule('statutory_research', { code, family, finding: String(id) });
		}
		return {
			sources: [...places, ...(answer.findings ?? []).flatMap((row) => row.source_urls ?? [])]
				.filter(officialSource)
				.filter((url, index, all) => all.indexOf(url) === index),
			researched: [label],
			proposed: fresh.map((row) => row.instrument_key),
			known: decided
		};
	}
});
