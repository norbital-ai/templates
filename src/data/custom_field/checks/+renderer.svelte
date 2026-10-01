<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { ValueOf } from '@norbital-ai/bolt';
	import type f from './+definition.ts';

	type Value = ValueOf<typeof f.spec.shape>;
	import { Inline, Stack } from '@norbital-ai/ui/layout';

	let { view }: { view: CustomFieldView<Value> } = $props();
	const checks = $derived(view.value ?? []);
</script>

{#if checks.length === 0}
	<p class="text-meta">—</p>
{:else}
	<Stack gap="sm">
		{#each checks as check (check.code)}
			<div class="rounded-md border p-3 text-xs">
				<Inline justify="between" gap="sm">
					<span class="font-medium">{check.code}</span>
					<span class="text-meta">{check.at} · {check.severity}</span>
				</Inline>
				<p class="text-meta font-mono">{check.when}</p>
				<p>{check.message}</p>
				{#if check.authority}<p class="text-meta">{check.authority}</p>{/if}
			</div>
		{/each}
	</Stack>
{/if}
