<script lang="ts">
	/**
	 * How the payslip's line items are produced, deterministically and for the whole version.
	 *
	 * A scheme states its wage as one `assessed_on` formula over the reserved lines and its
	 * version's catalogue rows; its rules then turn that base into employee and employer shares.
	 * A rule or formula that names `produced.<code>` is a dependency, so the engine computes
	 * schemes in dependency order — the order below, with cycle-free code order as the floor.
	 */
	import { client } from '../workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { orderSchemes, producedMentions } from '../../collections/payroll_runs/lib/mentions.js';

	let { version }: { readonly version: WorkspaceRow<'jurisdiction_settings'> } = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const versionId = $derived(String(version.id));
	const approved = { approval_id: { isNull: true } } as const;
	const schemesQuery = $derived(
		client.db.statutory_contributions.findMany({
			where: { settings_id: { eq: versionId }, ...approved },
			columns: { id: true, code: true, name: true, rules: true, assessed_on: true },
			orderBy: { code: 'asc' },
			limit: 500
		})
	);

	/**
	 * Dependency order, computed from the expressions themselves: `produced.<code>` mentions order
	 * the schemes, and a version the write gate let through cannot loop.
	 */
	const ordered = $derived.by(() => {
		const schemes = schemesQuery?.current ?? [];
		try {
			return orderSchemes(schemes.map((row) => ({ row })));
		} catch {
			return schemes.map((row) => ({ row }));
		}
	});
</script>

<Stack gap="xs">
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-meta text-left">
					<th class="py-1 pr-3 font-normal">#</th>
					<th class="py-1 pr-4 font-normal">{t('component.flow_scheme')}</th>
					<th class="py-1 pr-4 font-normal">{t('component.flow_inputs')}</th>
					<th class="py-1 pr-4 font-normal">{t('component.flow_rules')}</th>
					<th class="py-1 font-normal">{t('component.flow_reads')}</th>
				</tr>
			</thead>
			<tbody>
				{#each ordered as entry, index (`${entry.row.code}:${index}`)}
					{@const reads = producedMentions(entry.row.rules, entry.row.assessed_on ?? '')}
					<tr class="border-t border-border align-top">
						<td class="py-1.5 pr-3 tabular-nums text-muted-foreground">{index + 1}</td>
						<td class="py-1.5 pr-4">
							<span class="font-medium">{entry.row.code}</span>
							<span class="text-muted-foreground"> · {entry.row.name}</span>
						</td>
						<td class="py-1.5 pr-4">
							{#if (entry.row.assessed_on ?? '').trim() === ''}
								<span class="text-meta">{t('component.scheme_used_by_empty')}</span>
							{:else}
								<span class="font-mono text-xs">{entry.row.assessed_on}</span>
							{/if}
						</td>
						<td class="py-1.5 pr-4 text-muted-foreground">
							{t('component.flow_rules_hint', { count: entry.row.rules.length })}
						</td>
						<td class="py-1.5">
							{#if reads.length === 0}
								<span class="text-muted-foreground">—</span>
							{:else}
								<ul class="flex flex-wrap gap-1">
									{#each reads as code (code)}
										<li class="rounded-sm bg-muted px-1.5 py-0.5 text-xs">produced.{code}</li>
									{/each}
								</ul>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Stack>
