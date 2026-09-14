<script lang="ts">
	/**
	 * The official pages one settings version was transcribed from (RFC 0001 §4). Sources are
	 * inlined, not a collection: they evidence the version they belong to, and the statutory drift
	 * automation reads them monthly. One URL per row, as a matrix.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import type { CollectionField } from '@norbital-ai/std/collection';
	import { watch } from 'runed';
	import type { RendererProps, Value } from './$types.js';

	type UrlRow = { id: string; url: string };

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const readonly = $derived(props.mode !== 'edit');
	const urls = $derived<readonly string[]>(props.value?.urls ?? []);

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

	function commit(next: UrlRow[]): void {
		rows = next;
		if (props.mode !== 'edit') return;
		props.onValueChange({ urls: next.map((row) => row.url) } satisfies Value);
	}
</script>

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
