<script lang="ts">
	import OrderCreateFields from '../../../lib/ui/order-create-fields.svelte';
	import {
		type FormState,
		Dialog,
		useKinds,
		useBolt,
		Combobox,
		Button,
		RunStatus
	} from '@norbital-ai/ui';
	import CreateTable from '../../../lib/ui/create-table.svelte';
	import { bolt, fork, run } from '$bolt';
	import { Effect } from 'effect';
	import type { Id } from '@norbital-ai/bolt';
	const kinds = useKinds();
	const translate = useBolt().t;
	let previewOpen = $state(false);
	let selectedOrder = $state<Id<'orders'> | null>(null);
	let selectedVersion = $state<number | null>(null);
	let exporting = $state(false);
	let exportRun = $state<string | null>(null);
	let feedback = $state('');
	let versions = $state<ReturnType<typeof contractVersions> | null>(null);
	function contractVersions(order: Id<'orders'>) {
		return run(bolt.query('orders.document_versions', { order }));
	}
	let preview = $state<ReturnType<typeof previewOrder> | null>(null);
	function previewOrder(order: Id<'orders'>, version = selectedVersion) {
		return run(
			bolt.query('orders.document_preview', {
				order,
				...(version == null ? {} : { version }),
				locale: bolt.locale.startsWith('zh') ? 'zh' : 'en'
			})
		);
	}
	function openDocument(order: Id<'orders'>, download: boolean) {
		selectedOrder = order;
		selectedVersion = null;
		exporting = download;
		exportRun = null;
		feedback = '';
		versions = contractVersions(order);
		preview = previewOrder(order);
		previewOpen = true;
	}
	function exportPdf() {
		if (!selectedOrder || exportRun) return;
		const started = bolt.start('export_order', {
			order: selectedOrder,
			locale: bolt.locale.startsWith('zh') ? 'zh' : 'en',
			...(selectedVersion == null ? {} : { version: selectedVersion })
		});
		exportRun = started.id;
		fork(
			started.pipe(
				Effect.tap((result) =>
					Effect.sync(() => {
						if (result.kind === 'refused' && exportRun === started.id) {
							feedback = translate(result.message);
							exportRun = null;
						}
					})
				)
			)
		);
	}
	import { AppShell, Bound, Stack } from '@norbital-ai/ui/layout';
</script>

{#snippet orderFields(form: FormState)}<OrderCreateFields {form} />{/snippet}
<AppShell
	description=""
	icon="lucide:clipboard-list"
	title={bolt.t('component.orders')}
	variant="full"
>
	<CreateTable
		of="orders"
		where={{ direction: { eq: 'sales' } }}
		createValues={{ direction: 'sales' }}
		createForm={orderFields}
		columns={['number', 'title', 'party', 'status', 'total', 'owner']}
		toolbar={{
			actions: [
				...(kinds.catalog?.orders?.queries?.document_preview
					? [
							{
								icon: 'lucide:eye',
								name: bolt.t('component.preview_document'),
								requiresSelection: true as const,
								disabled: (ids: Id<'orders'>[]) =>
									ids.length === 1 ? null : bolt.t('component.select_one_order'),
								run: (ids: Id<'orders'>[]) => {
									if (ids[0]) {
										openDocument(ids[0], false);
									}
								}
							}
						]
					: []),
				...(kinds.catalog?.orders?.queries?.document_preview
					? [
							{
								icon: 'lucide:file-down',
								name: bolt.t('component.export_pdf'),
								requiresSelection: true as const,
								disabled: (ids: Id<'orders'>[]) =>
									ids.length === 1 ? null : bolt.t('component.select_one_order'),
								run: (ids: Id<'orders'>[]) => {
									if (ids[0]) openDocument(ids[0], true);
								}
							}
						]
					: [])
			]
		}}
	/>
</AppShell>

<Dialog.Root bind:open={previewOpen}
	><Dialog.Content class="sm:max-w-4xl">
		<Dialog.Title
			>{bolt.t(exporting ? 'component.export_pdf' : 'component.preview_document')}</Dialog.Title
		>
		{#if versions}{#await versions then options}
				<label
					>{bolt.t('models.orders.fields.contract_version')}<Combobox
						value={selectedVersion == null ? 'current' : String(selectedVersion)}
						options={[
							{ value: 'current', label: bolt.t('component.current_terms') },
							...options.map((v) => ({
								value: String(v.version),
								label: `${bolt.t('models.orders.fields.contract_version')} ${v.version}`
							}))
						]}
						onChange={(v) => {
							if (v && selectedOrder) {
								selectedVersion =
									options.find((option) => String(option.version) === v)?.version ?? null;
								exportRun = null;
								feedback = '';
								preview = previewOrder(selectedOrder, selectedVersion);
							}
						}}
					/></label
				>
			{:catch}<p role="alert">{bolt.t('component.document_unavailable')}</p>{/await}{/if}
		{#if preview}{#await preview}<p role="status">{bolt.t('component.check_loading')}</p>
			{:then document}<Stack gap="md"
					><Bound size="fit"
						><iframe
							title={document.title}
							srcdoc={document.html}
							sandbox=""
							class="h-full w-full bg-white"
						></iframe></Bound
					>
					{#if exporting}<Button disabled={exportRun !== null} onclick={exportPdf}
							>{bolt.t('component.export_pdf')}</Button
						>{/if}
					{#if exportRun}<RunStatus
							automation="export_order"
							run={exportRun}
							title={bolt.t('component.export_pdf')}
						/>{/if}
					{#if feedback}<p role="alert">{feedback}</p>{/if}
				</Stack>
			{:catch}<p role="alert">{bolt.t('component.document_unavailable')}</p>{/await}{/if}
	</Dialog.Content></Dialog.Root
>
