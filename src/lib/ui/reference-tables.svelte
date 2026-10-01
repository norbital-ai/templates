<script lang="ts">
	/**
	 * A settings version's reference tables as plain tables: one per declared table, a row per
	 * reference row — code, label, the band's from/to where the table is banded, each declared value
	 * column, and the days it is in force. Read only.
	 */
	import InfoTip from './InfoTip.svelte';
	import { t } from './t.js';
	import { bolt } from '$bolt';
	import { Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import * as Predicate from 'effect/Predicate';
	import { decodeNumber } from '../wire.js';
	import { EmptyState } from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';
	import { liveRows } from './live.svelte.js';
	import { formatNumeric, formatSettingsRange } from './display-formatters.js';

	type Declaration = {
		readonly name: string;
		readonly label?: string | null;
		readonly range?: unknown;
		readonly columns?:
			| readonly {
					readonly key: string;
					readonly label?: string | null;
					readonly description?: string | null;
			  }[]
			| null;
	};
	let {
		version
	}: {
		readonly version: {
			readonly id: Id<'jurisdiction_settings'>;
			readonly tables?: readonly Declaration[] | null;
		};
	} = $props();

	const rows = liveRows(() =>
		bolt.read('reference_rows', {
			where: { settings_id: { eq: version.id } },
			select: {
				table: true,
				code: true,
				label: true,
				range_from: true,
				range_to: true,
				values: true,
				effective_range: true
			},
			orderBy: { table: 'asc' },
			all: true
		})
	);
	const byTable = $derived(Map.groupBy(rows.current ?? [], (row) => row.table));
	const cell = (value: unknown) =>
		value == null || value === ''
			? '—'
			: Predicate.isNumber(value) || /^-?\d+(\.\d+)?$/.test(String(value))
				? formatNumeric(value)
				: String(value);
	const sorted = (list: NonNullable<typeof rows.current>) =>
		list.toSorted(
			(a, b) =>
				(a.range_from == null ? -Infinity : decodeNumber(a.range_from)) -
					(b.range_from == null ? -Infinity : decodeNumber(b.range_from)) ||
				String(a.code).localeCompare(String(b.code))
		);
</script>

{#if (version.tables ?? []).length === 0}
	<EmptyState title={t('component.reference_tables_none')} />
{:else}
	<Stack gap="lg">
		{#each version.tables ?? [] as table (table.name)}
			{@const list = sorted(byTable.get(table.name) ?? [])}
			{@const columns = table.columns ?? []}
			{@const banded = table.range != null}
			<section data-reference-table={table.name}>
				<Inline gap="xs" align="center">
					<h3 class="text-overline">
						{table.label ?? table.name} <span class="text-muted-foreground">· {list.length}</span>
					</h3>
					<InfoTip label={table.label ?? table.name}>{t('component.reference_table_help')}</InfoTip>
				</Inline>
				<Scroll name={table.label ?? table.name} axis="x" class="max-w-full">
					<table class="w-full text-sm tabular-nums">
						<thead>
							<tr class="text-meta border-b border-border text-left">
								<th class="py-1 pr-3 font-normal">{t('component.code')}</th>
								<th class="py-1 pr-3 font-normal">{t('component.name')}</th>
								{#if banded}
									<th class="py-1 pr-3 text-right font-normal">{t('component.band_from')}</th>
									<th class="py-1 pr-3 text-right font-normal">{t('component.band_to')}</th>
								{/if}
								{#each columns as column (column.key)}
									<th class="py-1 pr-3 text-right font-normal"
										><Inline gap="xs" align="center"
											>{column.label ?? column.key}<InfoTip label={column.label ?? column.key}
												>{column.description ?? t('component.reference_column_help')}</InfoTip
											></Inline
										></th
									>
								{/each}
								<th class="py-1 font-normal">{t('component.rule_map_effective')}</th>
							</tr>
						</thead>
						<tbody>
							{#each list as row, index (`${row.code}:${index}`)}
								<tr class="border-b border-border/60">
									<td class="py-1 pr-3 font-mono text-xs">{row.code}</td>
									<td class="py-1 pr-3">{row.label ?? ''}</td>
									{#if banded}
										<td class="py-1 pr-3 text-right">{cell(row.range_from)}</td>
										<td class="py-1 pr-3 text-right">{cell(row.range_to)}</td>
									{/if}
									{#each columns as column (column.key)}
										<td class="py-1 pr-3 text-right"
											>{cell((row.values as Record<string, unknown> | null)?.[column.key])}</td
										>
									{/each}
									<td class="py-1 whitespace-nowrap">{formatSettingsRange(row.effective_range)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</Scroll>
			</section>
		{/each}
	</Stack>
{/if}
