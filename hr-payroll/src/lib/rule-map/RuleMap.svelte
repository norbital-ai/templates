<script lang="ts">
	/**
	 * The rule map of one settings version (`graph.ts`): every input, table, rule, line, base,
	 * scheme and check its stored expressions connect, in dependency columns from the inputs to the
	 * payslip. Choosing a node lights what it depends on and what depends on it, lists its
	 * expressions and one-step neighbours (each a link to that node), and the tracker rows whose
	 * `config_path` names it.
	 */
	import { t } from '../ui/t.js';
	import { bolt } from '$bolt';
	import { Button, Input } from '@norbital-ai/ui';
	import { Cluster, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { live, liveRows } from '../ui/live.svelte.js';
	import { everyField } from '../every-field.js';
	import {
		adjacent,
		CATALOGUE_COLLECTIONS,
		KIND_COLUMN,
		reach,
		ruleMap,
		type RuleMapInput,
		type RuleNode
	} from './graph.js';
	import { citationParts, rowsForNode, type TrackerRow } from './tracker.js';
	import { lineageTracker } from './tracker-files.js';
	import { formatCalendarDate } from '../ui/display-formatters.js';

	let {
		version
	}: {
		readonly version: {
			readonly id: Id<'jurisdiction_settings'>;
			readonly code: string;
			readonly jurisdiction_code: string;
		};
	} = $props();

	const record = live(() =>
		bolt.get('jurisdiction_settings', version.id, everyField('jurisdiction_settings'))
	);
	const where = $derived({ settings_id: { eq: version.id }, approval_id: { isNull: true } });
	const schemes = liveRows(() =>
		bolt.read('statutory_contributions', {
			where,
			select: everyField('statutory_contributions'),
			all: true
		})
	);
	const catalogueReads = CATALOGUE_COLLECTIONS.map((collection) => ({
		collection,
		rows: liveRows(() =>
			bolt.read(collection, { where, select: everyField(collection), all: true } as never)
		)
	}));

	// The trackers are the template's own documents, loaded only when a map is opened.
	const trackerLoad = $derived(
		lineageTracker({ code: version.code, jurisdiction_code: version.jurisdiction_code })
	);

	const map = $derived(
		record.current == null
			? null
			: ruleMap({
					version: record.current,
					schemes: schemes.current ?? [],
					catalogues: Object.fromEntries(
						catalogueReads.map(({ collection, rows }) => [collection, rows.current ?? []])
					)
				})
	);
	const byId = $derived(new Map((map?.nodes ?? []).map((node) => [node.id, node])));

	let filter = $state('');
	let selected = $state<string | null>(null);
	const chosen = $derived(selected == null ? null : (byId.get(selected) ?? null));
	const upstream = $derived(
		map == null || selected == null ? new Set<string>() : reach(map, selected, 'up')
	);
	const downstream = $derived(
		map == null || selected == null ? new Set<string>() : reach(map, selected, 'down')
	);
	const columns = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		const out: RuleNode[][] = [[], [], [], [], [], []];
		for (const node of map?.nodes ?? [])
			if (
				needle === '' ||
				node.id.toLowerCase().includes(needle) ||
				node.label.toLowerCase().includes(needle) ||
				node.id === selected ||
				upstream.has(node.id) ||
				downstream.has(node.id)
			)
				out[KIND_COLUMN[node.kind]]!.push(node);
		return out.map((column) => column.toSorted((a, b) => a.id.localeCompare(b.id)));
	});
	const COLUMN_TITLES = [
		'component.rule_map_inputs',
		'component.rule_map_rules',
		'component.rule_map_lines',
		'component.rule_map_bases',
		'component.rule_map_schemes',
		'component.rule_map_payslip'
	] as const;
	const tone = (id: string) =>
		selected == null
			? ''
			: id === selected
				? 'ring-2 ring-ring'
				: upstream.has(id)
					? 'bg-muted'
					: downstream.has(id)
						? 'bg-accent'
						: 'opacity-40';
</script>

{#snippet chip(id: string)}
	{@const node = byId.get(id)}
	<Button
		variant="outline"
		size="sm"
		class="h-auto py-0.5 font-mono text-xs"
		onclick={() => (selected = id)}
	>
		{node?.label ?? id}
	</Button>
{/snippet}

{#snippet body(tracker: readonly TrackerRow[])}
	<Stack gap="md" data-rule-map>
		<Input
			value={filter}
			placeholder={t('component.rule_map_filter')}
			oninput={(event) => (filter = event.currentTarget.value)}
		/>
		<Scroll name={t('component.rule_map')} axis="x" class="max-w-full">
			<Grid tracks="repeat(6, minmax(12rem, 1fr))" gap="sm" class="min-w-[72rem]">
				{#each columns as column, index (index)}
					<Stack gap="xs">
						<p class="text-overline text-muted-foreground">
							{t(COLUMN_TITLES[index]!)} · {column.length}
						</p>
						<Scroll name={t(COLUMN_TITLES[index]!)} max="standard" layout="stack" gap="xs">
							{#each column as node (node.id)}
								<button
									type="button"
									class="rounded-md border border-border bg-card px-2 py-1 text-left text-xs hover:bg-muted {tone(
										node.id
									)}"
									title={node.id}
									data-rule-node={node.id}
									onclick={() => (selected = selected === node.id ? null : node.id)}
								>
									<span class="block truncate font-medium">{node.label}</span>
									{#if rowsForNode(tracker, node.config).length > 0}
										<span class="block text-muted-foreground tabular-nums"
											>§ {rowsForNode(tracker, node.config).length}</span
										>
									{/if}
								</button>
							{/each}
						</Scroll>
					</Stack>
				{/each}
			</Grid>
		</Scroll>

		{#if chosen && map}
			{@const trackerOf = rowsForNode(tracker, chosen.config)}
			<Stack
				as="section"
				gap="sm"
				class="rounded-md border border-border p-3 text-xs"
				data-rule-detail
			>
				<p class="font-medium">
					{chosen.label} <span class="text-muted-foreground">· {chosen.kind}</span>
				</p>
				<div>
					<p class="text-meta">{t('component.rule_map_reads')}</p>
					<Cluster gap="xs">
						{#each adjacent(map, chosen.id, 'up') as id (id)}{@render chip(id)}{/each}
					</Cluster>
				</div>
				<div>
					<p class="text-meta">{t('component.rule_map_read_by')}</p>
					<Cluster gap="xs">
						{#each adjacent(map, chosen.id, 'down') as id (id)}{@render chip(id)}{/each}
					</Cluster>
				</div>
				{#if chosen.expressions.length > 0}
					<div>
						<p class="text-meta">
							{t('component.rule_map_expressions', { count: chosen.expressions.length })}
						</p>
						<Stack as="ol" gap="xs" class="m-0 list-decimal pl-4 font-mono">
							{#each chosen.expressions.slice(0, 40) as entry, index (index)}
								<li class="break-words">
									<span class="text-muted-foreground">{entry.field}</span>
									{entry.expression}
								</li>
							{/each}
						</Stack>
					</div>
				{/if}
				{#if trackerOf.length > 0}
					<table class="w-full text-xs">
						<thead>
							<tr class="text-meta text-left">
								<th class="py-0.5 pr-2 font-normal">{t('component.rule_map_citation')}</th>
								<th class="py-0.5 pr-2 font-normal">{t('component.rule_map_effective')}</th>
								<th class="py-0.5 font-normal">{t('component.rule_map_status')}</th>
							</tr>
						</thead>
						<tbody>
							{#each trackerOf as row (row.id)}
								{@const cite = citationParts(row.citation || row.provision)}
								<tr class="border-t border-border align-top" data-tracker-row={row.id}>
									<td class="py-0.5 pr-2">
										<span class="line-clamp-2"
											>{#if cite.url}<a
													class="underline"
													href={cite.url}
													target="_blank"
													rel="noreferrer">{cite.title}</a
												>{:else}{cite.title}{/if}</span
										>
									</td>
									<td class="py-0.5 pr-2 whitespace-nowrap tabular-nums"
										>{row.effective_from ? formatCalendarDate(row.effective_from) : '—'} → {row.effective_to
											? formatCalendarDate(row.effective_to)
											: '—'}</td
									>
									<td class="py-0.5 whitespace-nowrap">{row.status}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</Stack>
		{/if}
	</Stack>
{/snippet}

{#await trackerLoad}
	{@render body([])}
{:then tracker}
	{@render body(tracker)}
{:catch}
	{@render body([])}
{/await}
