<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RendererProps, Value } from './$types.js';
	import { Inline, Stack } from '@norbital-ai/ui/layout';

	let { value }: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const obligations = $derived((value ?? []) as Value);
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
