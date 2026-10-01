<script lang="ts">
	import { t } from '../../../lib/ui/t.js';

	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { ValueOf } from '@norbital-ai/bolt';
	import type f from './+definition.ts';

	type Value = ValueOf<typeof f.spec.shape>;
	import { Inline, Stack } from '@norbital-ai/ui/layout';

	let { view }: { view: CustomFieldView<Value> } = $props();
	const duties = $derived(view.value ?? []);
</script>

{#if duties.length === 0}
	<p class="text-meta">{t('component.obligations_none')}</p>
{:else}
	<Stack gap="sm">
		{#each duties as duty (duty.code)}
			<div class="rounded-md border p-3 text-xs">
				<Inline justify="between" gap="sm">
					<span class="font-medium">{duty.label ?? duty.code}</span>
					<span class="text-meta"
						>{duty.subject} · {duty.trigger.on}{duty.trigger.every
							? ` · ${duty.trigger.every}`
							: ''}</span
					>
				</Inline>
				<p class="text-meta font-mono">{duty.due}</p>
				<p class="text-meta">{duty.authority}</p>
			</div>
		{/each}
	</Stack>
{/if}
