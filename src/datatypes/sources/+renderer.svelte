<script lang="ts">
	/**
	 * The official pages one settings version was transcribed from. Sources are
	 * inlined, not a collection: they evidence the version they belong to, and the statutory drift
	 * automation reads them monthly. One URL per row, as a matrix.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Textarea } from '@norbital-ai/ui/textarea';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { CollectionField } from '@norbital-ai/std/collection';
	import { watch } from 'runed';
	import type { RendererProps, Value } from './$types.js';

	type UrlRow = { id: string; url: string };

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const readonly = $derived(props.mode !== 'edit');
	const urls = $derived<readonly string[]>(props.value?.urls ?? []);
	const instructions = $derived(props.value?.instructions ?? '');

	let rows = $state<UrlRow[]>([]);
	watch(
		() => urls,
		(next) => {
			rows = next.map((url, index) => ({ id: String(index), url }));
		},
		{ lazy: false }
	);

	const columns: MatrixColumn<UrlRow>[] = [
		{
			key: 'url',
			label: t('renderer.sources.url'),
			field: { name: 'url', kind: 'text', nullable: true } satisfies CollectionField,
			placeholder: 'https://'
		}
	];

	function emit(next: Value): void {
		if (props.mode !== 'edit') return;
		props.onValueChange(next);
	}

	function commit(next: UrlRow[]): void {
		rows = next;
		emit({ urls: next.map((row) => row.url), ...(instructions ? { instructions } : {}) });
	}

	function commitInstructions(next: string): void {
		const text = next.trim();
		emit({ urls: rows.map((row) => row.url), ...(text ? { instructions: text } : {}) });
	}
</script>

<Stack gap="sm" class="w-full">
	<MatrixRenderer
		class="w-full"
		bind:rows
		{columns}
		{disabled}
		{readonly}
		allowAddRows={!disabled}
		bounded={false}
		emptyMessage={t('renderer.sources.empty')}
		getRowId={(row) => row.id}
		addRowLabel={t('renderer.sources.add_url')}
		createRow={() => ({ id: String(rows.length), url: '' })}
		onChange={commit}
	/>
	{#if readonly}
		{#if instructions}
			<p class="text-muted-foreground text-xs whitespace-pre-wrap">{instructions}</p>
		{/if}
	{:else}
		<label class="text-xs">
			<Stack gap="xs">
				<span class="text-muted-foreground">{t('renderer.sources.instructions')}</span>
				<Textarea
					value={instructions}
					{disabled}
					rows={6}
					placeholder={t('renderer.sources.instructions_hint')}
					oninput={(event) => commitInstructions(event.currentTarget.value)}
				/>
			</Stack>
		</label>
	{/if}
</Stack>
