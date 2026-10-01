<script lang="ts">
	import { t } from '../../../lib/ui/t.js';

	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { ValueOf } from '@norbital-ai/bolt';
	import type f from './+definition.ts';

	type Value = ValueOf<typeof f.spec.shape>;
	import InfoTip from '../../../lib/ui/InfoTip.svelte';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';

	let { view }: { view: CustomFieldView<Value> } = $props();
	const obligations = $derived(view.value ?? []);
</script>

{#if obligations.length === 0}
	<p class="text-meta">{t('component.obligations_none')}</p>
{:else}
	<Grid gap="sm" minimum="card">
		{#each obligations as obligation (obligation.code)}
			<div class="rounded-md border p-3 text-xs">
				<Inline justify="between" gap="sm">
					<span class="font-medium break-words">{obligation.code}</span>
					<InfoTip
						label={t('renderer.obligations.details', { code: obligation.code })}
						contentClass="max-h-[min(24rem,70dvh)] max-w-[min(32rem,90vw)] overflow-y-auto"
					>
						<Stack gap="sm">
							<p class="whitespace-pre-wrap">{obligation.description}</p>
							<p class="text-meta whitespace-pre-wrap">{obligation.authority}</p>
						</Stack>
					</InfoTip>
				</Inline>
				<p class="text-meta">
					{obligation.trigger} · {obligation.timing} · {obligation.owner}
				</p>
			</div>
		{/each}
	</Grid>
{/if}
