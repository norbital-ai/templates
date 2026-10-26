<script lang="ts">
	import OrderCreateFields from '../../../lib/ui/order-create-fields.svelte';
	import {
		type FormState,
		type RowIn,
		type ColumnsIn,
		Dialog,
		useKinds,
		useBolt,
		Combobox,
		Button,
		Show
	} from '@norbital-ai/ui';
	import CreateTable from '../../../lib/ui/create-table.svelte';
	import { bolt, fork, run } from '$bolt';
	import { Effect } from 'effect';
	import { isMasked, type Id } from '@norbital-ai/bolt';
	import { currentContractVersion } from '../../../lib/agreements.js';
	const kinds = useKinds();
	const translate = useBolt().t;
	let previewOpen = $state(false);
	let filing = $state('active');
	let selectedOrder = $state<Id<'orders'> | null>(null);
	let selectedVersion = $state<number | null>(null);
	let exporting = $state(false);
	let converting = $state(false);
	let exported = $state<{ url: string; name: string } | null>(null);
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
		exported = null;
		feedback = '';
		versions = contractVersions(order);
		preview = previewOrder(order);
		previewOpen = true;
	}
	/** The PDF of exactly the document the viewer previews: converted on the host, a short-lived file they own. */
	function exportPdf(document: { html: string; reference: string }) {
		if (converting || exported) return;
		const name = `${document.reference}.pdf`;
		converting = true;
		fork(
			bolt.convert({ html: document.html }, { to: 'pdf', page: 'A4', name }).pipe(
				Effect.tap((file) =>
					Effect.sync(() => {
						exported = { url: bolt.fileUrl(file), name };
					})
				),
				Effect.catch((failure) =>
					Effect.sync(() => {
						feedback =
							failure._tag === 'ActRefused'
								? translate(failure.message)
								: bolt.t('component.document_unavailable');
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						converting = false;
					})
				)
			)
		);
	}
	import { AppShell, Bound, Stack } from '@norbital-ai/ui/layout';
</script>

{#snippet orderFields(form: FormState)}<OrderCreateFields {form} />{/snippet}
{#snippet orderTotal({
	row,
	value
}: {
	row: RowIn<'orders'>;
	value: ColumnsIn<'orders'>['contract_versions'] | undefined;
})}
	{@const accepted =
		(row.status !== 'draft' || row.draft_setup) && value && !isMasked(value)
			? currentContractVersion(value)
			: undefined}
	{#if accepted}
		<Show
			kind={{ kind: 'money', currency: accepted.snapshot.currency }}
			value={accepted.snapshot.total}
		/>
	{:else}
		<Show kind={{ kind: 'money', currency: 'currency' }} value={row.total} {row} />
	{/if}
{/snippet}

{#snippet filingFilter()}<Combobox
		size="sm"
		value={filing}
		aria-label={bolt.t('models.orders.fields.archived')}
		options={[
			{ value: 'active', label: bolt.t('component.order_active') },
			{ value: 'archived', label: bolt.t('component.order_archived') }
		]}
		onChange={(value) => {
			if (value) filing = value;
		}}
	/>{/snippet}
<AppShell
	description={bolt.t('app.trade.description')}
	icon="lucide:clipboard-list"
	title={bolt.t('component.orders')}
	variant="full"
>
	<CreateTable
		of="orders"
		where={{ direction: { eq: 'sales' }, archived: { eq: filing === 'archived' } }}
		createValues={{ direction: 'sales' }}
		allowCreate={filing === 'active'}
		createForm={orderFields}
		columns={[
			'number',
			'title',
			'party',
			'status',
			{
				field: 'contract_versions',
				label: bolt.t('models.orders.fields.total'),
				align: 'end',
				cell: orderTotal
			},
			'owner'
		]}
		toolbar={{
			controls: filingFilter,
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
								exported = null;
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
					{#if exporting}<Button
							disabled={converting || exported !== null}
							onclick={() => exportPdf(document)}>{bolt.t('component.export_pdf')}</Button
						>{/if}
					{#if exported}<a href={exported.url} download={exported.name}>{exported.name}</a>{/if}
					{#if feedback}<p role="alert">{feedback}</p>{/if}
				</Stack>
			{:catch}<p role="alert">{bolt.t('component.document_unavailable')}</p>{/await}{/if}
	</Dialog.Content></Dialog.Root
>
