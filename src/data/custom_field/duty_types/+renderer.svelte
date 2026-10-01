<script lang="ts">
	import { t } from '../../../lib/ui/t.js';

	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { ValueOf } from '@norbital-ai/bolt';
	import type f from './+definition.ts';

	type Value = ValueOf<typeof f.spec.shape>;
	import InfoTip from '../../../lib/ui/InfoTip.svelte';
	import { Grid, Inline } from '@norbital-ai/ui/layout';

	let { view }: { view: CustomFieldView<Value> } = $props();
	const duties = $derived(view.value ?? []);
</script>

{#if duties.length === 0}
	<p class="text-meta">{t('component.obligations_none')}</p>
{:else}
	<Grid gap="sm" minimum="card">
		{#each duties as duty (duty.code)}
			<div class="rounded-md border p-3 text-xs">
				<Inline justify="between" gap="sm">
					<span class="font-medium break-words">{duty.label ?? duty.code}</span>
					<InfoTip
						label={t('renderer.duty_types.details', { code: duty.code })}
						contentClass="max-h-[min(24rem,70dvh)] max-w-[min(32rem,90vw)] overflow-y-auto"
					>
						<p class="whitespace-pre-wrap">{duty.authority}</p>
					</InfoTip>
					<span class="text-meta"
						>{duty.subject} · {duty.trigger.on}{duty.trigger.every
							? ` · ${duty.trigger.every}`
							: ''}</span
					>
				</Inline>
				<p class="text-meta font-mono">{duty.due}</p>
			</div>
		{/each}
	</Grid>
{/if}
