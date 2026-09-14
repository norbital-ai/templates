<script lang="ts">
	/**
	 * The official pages one settings version was transcribed from (RFC 0001 §4). Sources are
	 * inlined, not a collection: they evidence the version they belong to, and the statutory drift
	 * automation reads them monthly.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const rows = $derived<readonly string[]>(props.value?.urls ?? []);

	function emit(next: readonly string[]): void {
		if (props.mode === 'edit') props.onValueChange({ urls: [...next] } satisfies Value);
	}
</script>

{#if props.mode === 'display'}
	<span>{t('renderer.sources.url_count', { count: rows.length })}</span>
{:else}
	<Stack gap="sm">
		{#each rows as url, index (index)}
			<div class="flex items-center gap-2">
				<Input
					class="flex-1"
					value={url}
					{disabled}
					placeholder={'https://'}
					oninput={(event) =>
						emit(
							rows.map((entry, position) =>
								position === index ? event.currentTarget.value : entry
							)
						)}
				/>
				<Button
					variant="ghost"
					size="sm"
					{disabled}
					onclick={() => emit(rows.filter((_entry, position) => position !== index))}
				>
					{t('component.remove')}
				</Button>
			</div>
		{/each}
		{#if rows.length === 0}
			<p class="text-meta">{t('renderer.sources.empty')}</p>
		{/if}
		<div>
			<Button variant="outline" size="sm" {disabled} onclick={() => emit([...rows, ''])}>
				{t('renderer.sources.add_url')}
			</Button>
		</div>
	</Stack>
{/if}
