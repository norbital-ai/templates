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
	import { rowsForNode, trackerRows, trackerRowsOf, type TrackerRow } from './tracker.js';

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
	// ponytail: every tracker is parsed, then filtered to the lineage; key the files by profile if that grows slow.
	const trackerFiles = import.meta.glob('../../../docs/inventory/*.csv', {
		query: '?raw',
		import: 'default'
	}) as Record<string, () => Promise<string>>;
	const everyRow = Promise.all(Object.values(trackerFiles).map((load) => load())).then((texts) =>
		texts.flatMap(trackerRows)
	);
	const trackerLoad = $derived(
		everyRow.then((rows) =>
			trackerRowsOf(rows, { code: version.code, jurisdiction_code: version.jurisdiction_code })
		)
	);

	const map = $derived(
		record.current == null
			? null
			: ruleMap({
					version: record.current as unknown as RuleMapInput['version'],
					schemes: (schemes.current ?? []) as unknown as RuleMapInput['schemes'],
					catalogues: Object.fromEntries(
						catalogueReads.map(({ collection, rows }) => [collection, rows.current ?? []])
					) as unknown as RuleMapInput['catalogues']
				})
	);
	const byId = $derived(new Map((map?.nodes ?? []).map((node) => [node.id, node])));

	let filter = $state('');
	let selected = $state<string | null>(null);
	const chosen = $derived(selected == null ? null : (byId.get(selected) ?? null));
	const upstream = $derived(map == null || selected == null ? new Set<string>() : reach(map, selected, 'up'));
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
	<Button variant="outline" size="sm" class="h-auto py-0.5 font-mono text-xs" onclick={() => (selected = id)}>
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
								<span class="block truncate text-muted-foreground"
									>{node.kind}{#if rowsForNode(tracker, node.config).length > 0}
										· {t('component.rule_map_tracker_count', {
											count: rowsForNode(tracker, node.config).length
										})}{/if}</span
								>
							</button>
						{/each}
					</Scroll>
				</Stack>
			{/each}
		</Grid>
	</Scroll>

	{#if chosen && map}
		{@const trackerOf = rowsForNode(tracker, chosen.config)}
		<Stack as="section" gap="sm" class="rounded-md border border-border p-3 text-xs" data-rule-detail>
			<p class="font-medium">
				{chosen.label} <span class="text-muted-foreground">· {chosen.kind} · {chosen.id}</span>
			</p>
			{#if chosen.config.length > 0}
				<p class="font-mono text-muted-foreground">{chosen.config.join('; ')}</p>
			{/if}
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
			<div>
				<p class="text-meta">{t('component.rule_map_tracker', { count: trackerOf.length })}</p>
				<Stack as="ul" gap="xs">
					{#each trackerOf as row (row.id)}
						<li data-tracker-row={row.id}>
							<span class="font-mono">{row.id}</span>
							<span class="rounded-sm bg-muted px-1">{row.status}</span>
							{row.provision}
							{#if row.reason}<span class="text-muted-foreground">— {row.reason}</span>{/if}
						</li>
					{/each}
				</Stack>
			</div>
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
