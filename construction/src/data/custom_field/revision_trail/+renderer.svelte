<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, type UiContext } from '@norbital-ai/ui';
	import { Scroll } from '@norbital-ai/ui/layout';

	type Entry = {
		readonly version: string;
		readonly saved_on: string;
		readonly reference?: string | null;
		readonly summary?: string | null;
	};

	let {
		view,
		ctx
	}: {
		view: CustomFieldView<'revision_trail'>;
		ctx: UiContext & Partial<Pick<PageContext, 't'>>;
	} = $props();

	const t = (key: Parameters<PageContext['t']>[0]) => ctx.t?.(key) ?? key;
	const entries = $derived<readonly Entry[]>(view.value ?? []);
</script>

{#if entries.length === 0}
	<span class="text-sm text-muted-foreground">{t('component.no_value')}</span>
{:else}
	<Scroll axis="x" name={t('project_files.revision_history')}>
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="border-b border-border text-micro text-muted-foreground">
					<th class="py-1.5 pr-3">{t('project_files.col_version')}</th>
					<th class="py-1.5 pr-3">{t('project_files.col_issued_on')}</th>
					<th class="py-1.5 pr-3">{t('project_files.col_reference')}</th>
					<th class="py-1.5">{t('project_files.col_notes')}</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-border/60">
				{#each [...entries].reverse() as entry, idx (entry.version + entry.saved_on + idx)}
					<tr>
						<td class="py-1.5 pr-3"><Badge variant="outline">{entry.version}</Badge></td>
						<td class="py-1.5 pr-3 tabular-nums">{entry.saved_on}</td>
						<td class="py-1.5 pr-3 font-mono text-xs">
							{entry.reference ?? t('component.no_value')}
						</td>
						<td class="py-1.5 text-muted-foreground">
							{entry.summary ?? t('component.no_value')}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</Scroll>
{/if}
