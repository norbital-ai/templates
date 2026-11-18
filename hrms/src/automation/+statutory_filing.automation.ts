import { automation } from '@norbital-ai/bolt';
import { Effect, Schema } from 'effect';
import type { JsonObject } from '../lib/payroll_engine/contracts.js';
import { lawRead, lawsOf, standing } from '../lib/law.js';
import { idsOf, objectValue, queryRows, valueText } from '../lib/payroll_engine/reads.js';
import { isJsonObject, jsonObject, Refusal, type Json } from '../lib/payroll_engine/foundation.js';
import {
	FAMILIES,
	planChanges,
	referenceSources,
	sortFindings
} from '../lib/payroll_engine/statutory_research.js';

const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
/** What a research agent answers, as `statutory_research` hands it on. */
const Answer = Schema.Struct({
	findings: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				instrument: Schema.String,
				title: Schema.String,
				fit: Schema.Literals(['VALUE', 'ROW', 'STRUCTURAL']),
				families: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
				summary: Text,
				announced_on: Text,
				source_urls: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
				source_quote: Text,
				notes: Text
			})
		)
	),
	new_sources: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				url: Schema.String,
				title: Schema.String,
				family: Text,
				replaces_url: Text
			})
		)
	),
	changes: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				row_code: Text,
				field_path: Schema.String,
				new_value: Schema.optionalKey(Schema.NullOr(Schema.Json)),
				effective_from: Text,
				notes: Text
			})
		)
	)
});
const text = (value: Json | undefined): string | null =>
	typeof value === 'string' && value !== '' ? value : null;
/** The finding a change was filed under, read plain or with its status. */
const findingOf = (row: JsonObject): string | null =>
	isJsonObject(row.finding_id) ? String(row.finding_id.id) : text(row.finding_id);

/**
 * Files one research agent's answer: its findings and sources, or the changes it drafted for one finding. One answer at
 * a time across every jurisdiction, so no two filings refuse each other's writes; a filing is a few reads and writes,
 * never an agent. A new finding asks `statutory_research` for one drafting agent per family it touches.
 */
export default automation({
	description:
		'Files what one research agent found: proposed findings and their sources, or the dated changes it drafted for a finding. One at a time; a change is not in force until a person confirms its finding.',
	input: {
		code: { kind: 'text' },
		family: { kind: 'text' },
		finding: { kind: 'text', optional: true },
		answer: { kind: 'json' }
	},
	policies: ['configuration_execution'],
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		const { code, family } = input;
		const answer = yield* Schema.decodeUnknownEffect(Answer)(input.answer).pipe(
			Effect.mapError(
				() => new Refusal({ message: `${code}/${family}: not an answer a research agent gives.` })
			)
		);
		const held = yield* queryRows(ctx.query, {
			...lawRead([code]),
			statutory_finding: { where: { jurisdiction_code: { eq: code } }, limit: 10000 },
			statutory_source: { where: { jurisdiction_code: { eq: code } }, limit: 10000 }
		});
		const law = lawsOf(held)(code, ctx.today);
		if (law === undefined) return;
		const changes = held.jurisdiction_change ?? [];
		const findings = held.statutory_finding ?? [];
		const sources = held.statutory_source ?? [];

		// an update names each record at the revision it is read at now
		const at = Effect.fnUntraced(function* (
			model: 'statutory_finding' | 'statutory_source' | 'jurisdiction_change',
			ids: readonly string[]
		) {
			// one typed read per model whose rows the run updates
			const rows =
				model === 'statutory_finding'
					? (yield* queryRows(ctx.query, {
							statutory_finding: {
								where: { id: { in: idsOf('statutory_finding', ids) } },
								fields: ['revision'],
								limit: 10000
							}
						})).statutory_finding
					: model === 'statutory_source'
						? (yield* queryRows(ctx.query, {
								statutory_source: {
									where: { id: { in: idsOf('statutory_source', ids) } },
									fields: ['revision'],
									limit: 10000
								}
							})).statutory_source
						: (yield* queryRows(ctx.query, {
								jurisdiction_change: {
									where: { id: { in: idsOf('jurisdiction_change', ids) } },
									fields: ['revision'],
									limit: 10000
								}
							})).jurisdiction_change;
			return new Map(
				rows.map((row) => [
					valueText(row, 'id'),
					{ id: row.id ?? null, revision: row.revision ?? null }
				])
			);
		});
		const write = Effect.fnUntraced(function* (acts: JsonObject) {
			if (Object.keys(acts).length === 0) return [];
			const written = yield* ctx.act(acts);
			if (written.kind !== 'committed')
				return yield* Effect.fail(
					new Refusal({ message: `${code}/${family}: the write was held for approval.` })
				);
			return written.records;
		});

		const finding = text(input.finding);
		if (finding !== null) {
			const instrument = findings.find((row) => row.id === finding);
			if (instrument === undefined) return;
			const patchOf = (row: JsonObject) => ({
				effective_from: valueText(row, 'effective_from'),
				law: objectValue(row.law)
			});
			const mine = changes.filter((row) => findingOf(row) === finding);
			const { planned, undated } = planChanges({
				family,
				chain: changes.filter(standing).map((row) => ({
					id: valueText(row, 'id'),
					effective_from: valueText(row, 'effective_from'),
					patch: objectValue(row.law)
				})),
				drafted: mine.map(patchOf),
				known: changes
					.filter((row) => findingOf(row) !== null && findingOf(row) !== finding)
					.map(patchOf),
				reported: answer.changes ?? []
			});
			// one change per date under a finding: a later family's patch joins the row its date already has
			const drafted = new Map(mine.map((row) => [valueText(row, 'effective_from'), row]));
			const fresh = planned.filter((patch) => !drafted.has(patch.effective_from));
			const grown = planned.flatMap((patch) => {
				const row = drafted.get(patch.effective_from);
				return row === undefined ? [] : [{ id: valueText(row, 'id'), law: patch.law }];
			});
			const targets = yield* at(
				'jurisdiction_change',
				grown.map((row) => row.id)
			);
			yield* write({
				...(fresh.length === 0
					? {}
					: {
							'jurisdiction_change.create': fresh.map((patch) => ({
								...patch,
								finding_id: finding,
								jurisdiction_code: code
							}))
						}),
				...(grown.length === 0
					? {}
					: {
							'jurisdiction_change.update': grown.map((row) => ({
								target: targets.get(row.id) ?? null,
								set: { law: row.law }
							}))
						}),
				// what the source does not date is left for a person: a change of law always has its date
				...(undated.length === 0 || instrument.status === 'REJECTED'
					? {}
					: {
							'statutory_finding.update': [
								{
									target: { id: instrument.id ?? null, revision: instrument.revision ?? null },
									set: {
										notes: [text(instrument.notes), `Undated, ${code}/${family}:`, ...undated]
											.filter((line) => line !== null)
											.join('\n')
									}
								}
							]
						})
			});
			return;
		}

		const live = sources.filter((row) => row.status === 'ACTIVE');
		// an activated replacement takes over from the page it replaces
		const moved = new Set(live.map((row) => row.replaces_url));
		const active = live.filter((row) => !moved.has(row.url));
		const bootstrapped = referenceSources(
			FAMILIES.flatMap((name) => law.rows[name]),
			sources.map((row) => valueText(row, 'url'))
		);
		const { fresh, merged } = sortFindings(
			answer.findings ?? [],
			findings.map((row) => ({
				id: valueText(row, 'id'),
				instrument_key: valueText(row, 'instrument_key'),
				status: valueText(row, 'status'),
				source_urls: (Array.isArray(row.source_urls) ? row.source_urls : []).map(String)
			}))
		);
		if (live.length > active.length)
			yield* write({
				'statutory_source.update': live
					.filter((row) => moved.has(row.url))
					.map((row) => ({ target: row, set: { status: 'RETIRED' } }))
			});
		const created = yield* write(
			fresh.length === 0
				? {}
				: {
						'statutory_finding.create': fresh.map((row) =>
							jsonObject({ ...row, jurisdiction_code: code, research_run_id: ctx.trigger.id })
						)
					}
		);
		if (merged.length > 0) {
			const targets = yield* at(
				'statutory_finding',
				merged.map(([target]) => target)
			);
			yield* write({
				'statutory_finding.update': merged.map(([target, source_urls]) => ({
					target: targets.get(target) ?? null,
					set: { source_urls }
				}))
			});
		}
		const recorded = new Set([
			...sources.map((row) => row.url),
			...bootstrapped.map((row) => row.url)
		]);
		const proposedSources = new Map(
			(answer.new_sources ?? [])
				.filter((row) => !recorded.has(row.url) && URL.canParse(row.url))
				.map((row) => [row.url, row])
		);
		const opened = yield* write(
			bootstrapped.length + proposedSources.size === 0
				? {}
				: {
						'statutory_source.create': [
							...bootstrapped.map(({ title, url }) =>
								jsonObject({
									title,
									url,
									jurisdiction_code: code,
									origin: 'REFERENCE',
									research_run_id: ctx.trigger.id
								})
							),
							...[...proposedSources.values()].map((row) =>
								jsonObject({
									...row,
									jurisdiction_code: code,
									origin: 'AGENT',
									research_run_id: ctx.trigger.id
								})
							)
						]
					}
		);
		// an official citation the law already carries needs no second review; every active source records this check
		const checked = [
			...active.map((row) => valueText(row, 'id')),
			...bootstrapped.flatMap((row, index) =>
				row.status === 'ACTIVE' ? [String(opened[index]?.id)] : []
			)
		];
		if (checked.length > 0) {
			const targets = yield* at('statutory_source', checked);
			yield* write({
				'statutory_source.update': checked.map((target) => ({
					target: targets.get(target) ?? null,
					set: { status: 'ACTIVE', last_checked_on: ctx.today }
				}))
			});
		}
		// each new finding's changes: one drafting agent per family it touches, all at once
		const ids = created.filter((row) => row.model === 'statutory_finding');
		for (const [index, row] of fresh.entries()) {
			const id = ids[index]?.id;
			if (id === undefined || row.fit === 'STRUCTURAL') continue;
			for (const touched of row.families ?? [])
				yield* ctx.schedule('statutory_research', { code, family: touched, finding: id });
		}
	}
});
