<script lang="ts">
	/**
	 * How the payslip's line items are produced, deterministically and for the whole version.
	 *
	 * A scheme's base is the signed sum of every line that opted into it (a catalogue band, a work
	 * band, or one of the engine-priced work lines); its rules then turn that base into employee and
	 * employer shares. A rule that names `produced.<code>` is a dependency, so the engine computes
	 * schemes in dependency order — the order below, with cycle-free code order as the floor.
	 */
	import { client } from '../workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { orderSchemes, producedMentions } from '../../collections/payroll_runs/lib/mentions.js';
	import { optInLines } from '../payroll/opt-in-lines.js';

	let { version }: { readonly version: WorkspaceRow<'jurisdiction_settings'> } = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const versionId = $derived(String(version.id));
	const approved = { approval_id: { isNull: true } } as const;
	const catalogueQuery = () => ({
		where: { settings_id: { eq: versionId }, ...approved },
		columns: { id: true, code: true, bands: true },
		limit: 500
	});
	const leave = $derived(client.db.leave_catalogue.findMany(catalogueQuery())?.current ?? []);
	const loan = $derived(client.db.loan_catalogue.findMany(catalogueQuery())?.current ?? []);
	const claim = $derived(client.db.claim_catalogue.findMany(catalogueQuery())?.current ?? []);
	const allowance = $derived(
		client.db.allowance_catalogue.findMany(catalogueQuery())?.current ?? []
	);
	const payment = $derived(client.db.payment_catalogue.findMany(catalogueQuery())?.current ?? []);
	const schemesQuery = $derived(
		client.db.statutory_contributions.findMany({
			where: { settings_id: { eq: versionId }, ...approved },
			columns: { id: true, code: true, name: true, rules: true },
			orderBy: { code: 'asc' },
			limit: 500
		})
	);

	const lines = $derived(
		optInLines({
			catalogues: [
				['LEAVE', leave],
				['LOAN', loan],
				['CLAIM', claim],
				['ALLOWANCE', allowance],
				['PAYMENT', payment]
			],
			work: version.work_rules,
			engineLineLabels: {
				salary: t('renderer.work_rules.line_salary'),
				absence: t('renderer.work_rules.line_absence'),
				night: t('renderer.work_rules.line_night')
			}
		})
	);
	const baseLinesOf = (contributionId: string) => {
		const seen = new Map<string, { code: string; effect: 'INCLUDE' | 'REDUCE' }>();
		for (const line of lines)
			if (line.contribution_id === contributionId && !seen.has(`${line.code}:${line.effect}`))
				seen.set(`${line.code}:${line.effect}`, { code: line.code, effect: line.effect });
		return [...seen.values()];
	};
	/**
	 * Dependency order, computed from the rules themselves: `produced.<code>` mentions order the
	 * schemes, and a version the write gate let through cannot loop.
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
					{@const baseLines = baseLinesOf(entry.row.id)}
					<tr class="border-t border-border align-top">
						<td class="py-1.5 pr-3 tabular-nums text-muted-foreground">{index + 1}</td>
						<td class="py-1.5 pr-4">
							<span class="font-medium">{entry.row.code}</span>
							<span class="text-muted-foreground"> · {entry.row.name}</span>
						</td>
						<td class="py-1.5 pr-4">
							{#if baseLines.length === 0}
								<span class="text-meta">{t('component.scheme_used_by_empty')}</span>
							{:else}
								<ul class="flex flex-wrap gap-1">
									{#each baseLines as line (`${line.code}:${line.effect}`)}
										<li class="rounded-sm bg-muted px-1.5 py-0.5 text-xs">
											{line.code}
											{line.effect === 'REDUCE' ? '−' : '+'}
										</li>
									{/each}
								</ul>
							{/if}
						</td>
						<td class="py-1.5 pr-4 text-muted-foreground">
							{t('component.flow_rules_hint', { count: entry.row.rules.length })}
						</td>
						<td class="py-1.5">
							{#if producedMentions(entry.row.rules).length === 0}
								<span class="text-muted-foreground">—</span>
							{:else}
								<ul class="flex flex-wrap gap-1">
									{#each producedMentions(entry.row.rules) as code (code)}
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
