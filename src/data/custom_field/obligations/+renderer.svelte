<script lang="ts">
	import { t } from '../../../lib/ui/t.js';

	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { ValueOf } from '@norbital-ai/bolt';
	import type f from './+definition.ts';

	type Value = ValueOf<typeof f.spec.shape>;
	import { Inline, Stack } from '@norbital-ai/ui/layout';

	let { view }: { view: CustomFieldView<Value> } = $props();
	const obligations = $derived(view.value ?? []);
</script>

{#if obligations.length === 0}
	<p class="text-meta">{t('component.obligations_none')}</p>
{:else}
	<Stack gap="sm">
		{#each obligations as obligation (obligation.code)}
			<div class="rounded-md border p-3 text-xs">
				<Inline justify="between" gap="sm">
					<span class="font-medium">{obligation.description}</span>
					<span class="text-meta">{obligation.status}</span>
				</Inline>
				<p class="text-meta">
					{obligation.trigger} · {obligation.timing} · {obligation.owner}
				</p>
				<p class="text-meta">{obligation.authority}</p>
			</div>
		{/each}
	</Stack>
{/if}
