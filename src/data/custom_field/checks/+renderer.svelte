<script lang="ts">
	import { t } from '../../../lib/ui/t.js';
	import InfoTip from '../../../lib/ui/InfoTip.svelte';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { ValueOf } from '@norbital-ai/bolt';
	import type f from './+definition.ts';

	type Value = ValueOf<typeof f.spec.shape>;
	import { Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';

	let { view }: { view: CustomFieldView<Value> } = $props();
	const checks = $derived(view.value ?? []);
</script>

{#if checks.length === 0}
	<p class="text-meta">—</p>
{:else}
	<Grid gap="sm" minimum="card">
		{#each checks as check (check.code)}
			<div class="rounded-md border p-3 text-xs">
				<Inline justify="between" gap="sm">
					<span class="font-medium break-words">{check.code}</span>
					<InfoTip label={t('renderer.checks.details', { code: check.code })}>
						<Scroll name={t('renderer.checks.details', { code: check.code })} max="compact">
							<Stack gap="sm">
								<p class="whitespace-pre-wrap">{check.message}</p>
								<p class="text-meta">{t('renderer.checks.condition')}</p>
								<p class="break-words font-mono">{check.when}</p>
								{#if check.authority}<p class="text-meta whitespace-pre-wrap">
										{check.authority}
									</p>{/if}
							</Stack>
						</Scroll>
					</InfoTip>
					<span class="text-meta">{check.at} · {check.severity}</span>
				</Inline>
			</div>
		{/each}
	</Grid>
{/if}
