import { automation } from '@norbital-ai/bolt';
import type { JsonObject } from '../lib/contracts.js';
import { LAW_ROWS, lawRead, lawsOf, standing } from '../data/model/jurisdiction/service/law.js';
import { queryRows, valueText } from '../lib/reads.js';
import { jsonObject, type Json } from '../lib/foundation.js';
import {
	FAMILIES,
	FAMILY_NOTES,
	referenceSources,
	SETTINGS_FAMILY,
	WHOLE_ROW
} from '../data/model/statutory_finding/service/research.js';

const byCode = (rows: readonly JsonObject[]): readonly JsonObject[] =>
	[...rows].toSorted((left, right) =>
		String(left.code ?? '').localeCompare(String(right.code ?? ''))
	);

const FAMILY_ROLE =
	"You research one family of one jurisdiction's payroll configuration. Report each legal instrument (an act, regulation, gazette notice or official rate announcement) that changed a value of the family or is announced to change it, and audit every rate, ceiling, amount, day count and deadline against the row's own `references` quotes and official law in force: a value that contradicts its own quoted law is a finding even when no search confirms it. Classify how each fits. Never write a model: the automation records your answer as proposals for human review.";
const CHANGES_ROLE =
	'You check one jurisdiction payroll configuration against one legal instrument. Report only the fields whose official value differs from the configuration given, each as one change. Never invent an effective date: leave `effective_from` empty unless the source states it. Never write a model: the automation records your answer as proposals for human review.';
/** One research agent per family: the jurisdiction's settings, each catalogue, its registered rules and effects. */
const SCOPES = [SETTINGS_FAMILY, ...FAMILIES] as const;
const text = (value: Json | undefined): string | null =>
	typeof value === 'string' && value !== '' ? value : null;

/**
 * The research agents. Without a family it fans out: one run per family of each jurisdiction asked for (or in use), all
 * at once, up to the automation's concurrency. A family run reads its law and asks one agent what changed and whether
 * each value still stands; with a finding, one agent drafts that instrument's changes to the family. An agent writes
 * nothing: it hands its answer to `statutory_filing`, which files one answer at a time, so agents never refuse each
 * other's writes and each run stays inside its CPU budget.
 */
export default automation({
	description:
		'Every Saturday, one research agent per family (the settings, each catalogue, the registered rules and effects) of each jurisdiction in use, all at once, reads official sources and audits its values; one agent per family a finding touches drafts its dated changes. Their answers are filed as proposed findings, not in force until a person confirms one.',
	on: [{ cron: '0 3 * * 6' }],
	input: {
		code: { kind: 'text', optional: true },
		family: { kind: 'text', optional: true },
		finding: { kind: 'text', optional: true }
	},
	policies: ['configuration_execution'],
	concurrency: { max: 16 },
	run: function* (input, ctx) {
		const code = text(input.code);
		const family = text(input.family);
		if (code === null || family === null) {
			const codes =
				code !== null
					? [code]
					: [
							...new Set(
								(yield* queryRows(ctx.query, {
									entity: { fields: ['settings_code'], limit: 10000 }
								})).entity.map((row) => valueText(row, 'settings_code'))
							)
						];
			for (const each of codes)
				for (const scope of SCOPES)
					yield* ctx.schedule('statutory_research', { code: each, family: scope });
			return;
		}
		const held = yield* queryRows(ctx.query, {
			...lawRead([code]),
			statutory_finding: { where: { jurisdiction_code: { eq: code } }, limit: 10000 },
			statutory_source: { where: { jurisdiction_code: { eq: code } }, limit: 10000 }
		});
		const law = lawsOf(held)(code, ctx.today);
		if (law === undefined) return;
		/** The dates of the changes in force that have yet to start. */
		const ahead = (held.jurisdiction_change ?? [])
			.filter((row) => standing(row) && valueText(row, 'effective_from') > ctx.today)
			.map((row) => valueText(row, 'effective_from'))
			.toSorted();
		const findings = held.statutory_finding ?? [];
		const finding = text(input.finding);

		if (finding !== null) {
			const instrument = findings.find((row) => row.id === finding);
			if (instrument === undefined) return;
			const rows = byCode(LAW_ROWS.flatMap((name) => (name === family ? law.rows[name] : [])));
			const answer = yield* ctx.ai.sys_2.infer({
				model: 'strong',
				tools: ['web_search'],
				steps: 3,
				label: `${code}/${family}`,
				system: CHANGES_ROLE,
				prompt: [
					`# ${code} · ${family}: ${valueText(instrument, 'title')}`,
					text(instrument.summary) ?? '',
					`Sources: ${JSON.stringify(instrument.source_urls)}`,
					`Quoted: ${text(instrument.source_quote) ?? 'nothing yet'}`,
					`This configuration is the law in force on ${ctx.today}. Changes already filed take effect on ${JSON.stringify(ahead)}.`,
					`Each change names one field: \`row_code\` the catalogue row's code (empty for the jurisdiction configuration), \`field_path\` its dot path (for example \`lookup.monthly_salary_ceiling\`), \`new_value\` the official value. A new or removed catalogue row uses \`field_path\` \`${WHOLE_ROW}\`, with \`new_value\` the whole row shaped like its neighbours or empty; it names subtotals by the codes below. A law that steps through several dates gives one change per date.`,
					"Give the law's own `effective_from` (YYYY-MM-DD) only where the source states it. Note doubts in `notes`.",
					'## Subtotals',
					'```json',
					JSON.stringify(law.rows.subtotal.map((row) => ({ code: row.code, name: row.name }))),
					'```',
					'## Jurisdiction configuration',
					'```json',
					JSON.stringify(law.settings, null, 2),
					'```',
					'## Current catalogue rows',
					'```json',
					JSON.stringify(rows, null, 2),
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
			yield* ctx.schedule('statutory_filing', {
				code,
				family,
				finding,
				answer: jsonObject({ changes: answer.changes ?? [] })
			});
			return;
		}

		const sources = held.statutory_source ?? [];
		const live = sources.filter((row) => row.status === 'ACTIVE');
		// an activated replacement takes over from the page it replaces
		const moved = new Set(live.map((row) => row.replaces_url));
		const places = [
			...live.filter((row) => !moved.has(row.url)).map((row) => valueText(row, 'url')),
			...referenceSources(
				FAMILIES.flatMap((name) => law.rows[name]),
				sources.map((row) => valueText(row, 'url'))
			)
				.filter((row) => row.status === 'ACTIVE')
				.map((row) => row.url)
		];
		const answer = yield* ctx.ai.sys_2.infer({
			model: 'strong',
			tools: ['web_search'],
			steps: 6,
			label: `${code}/${family}`,
			system: FAMILY_ROLE,
			prompt: [
				`# ${code}/${family}: what changed in the law`,
				`Check ${code}'s ${family} against official law as of ${ctx.today}. This configuration is the law in force on that day.`,
				`Each finding names one instrument by its official citation in \`instrument\` (for example \`PP 46/2015\`; the same law must keep the same citation), with \`source_urls\` and the exact sentence or table in \`source_quote\`.`,
				'`fit` is `VALUE` when a value in an existing row changes, `ROW` when a new or removed row of an existing family carries it, and `STRUCTURAL` when no family below can hold it (a new kind of scheme or calculation, a new subtotal, rule or filing). `families` names every family it touches; a new scheme is classified by what it does, not by what it is called.',
				'## Families',
				'```json',
				JSON.stringify(Object.fromEntries(SCOPES.map((name) => [name, FAMILY_NOTES[name]]))),
				'```',
				`## Audit these values of ${family}: every value, against its \`references\` and official law`,
				'```json',
				JSON.stringify(
					family === SETTINGS_FAMILY
						? law.settings
						: byCode(LAW_ROWS.flatMap((name) => (name === family ? law.rows[name] : [])))
				),
				'```',
				'## Subtotals',
				JSON.stringify(law.rows.subtotal.map((row) => row.code)),
				'## Changes already filed take effect on',
				JSON.stringify(ahead),
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
		yield* ctx.schedule('statutory_filing', {
			code,
			family,
			answer: jsonObject({
				findings: answer.findings ?? [],
				new_sources: answer.new_sources ?? []
			})
		});
	}
});
