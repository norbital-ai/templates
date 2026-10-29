<script lang="ts">
	import {
		type RowIn,
		type ColumnsIn,
		Dialog,
		Table,
		useKinds,
		useBolt,
		Combobox,
		Button,
		Show
	} from '@norbital-ai/ui';
	import { bolt, fork, run } from '$bolt';
	import { Effect } from 'effect';
	import type { Id } from '@norbital-ai/bolt';
	import { openCreate } from '../../../lib/ui/create-values.js';
	import {
		agreementRead,
		documentRead,
		documentVersions,
		orderDocument
	} from '../../../lib/order-document.js';
	const kinds = useKinds();
	const translate = useBolt().t;
	let previewOpen = $state(false);
	let selectedOrder = $state<Id<'orders'> | null>(null);
	let selectedVersion = $state<number | null>(null);
	let exporting = $state(false);
	let converting = $state(false);
	let exported = $state<{ url: string; name: string } | null>(null);
	let feedback = $state('');
	let versions = $state<ReturnType<typeof contractVersions> | null>(null);
	function contractVersions(order: Id<'orders'>) {
		return run(
			bolt
				.query(agreementRead(order))
				.pipe(Effect.flatMap((answer) => Effect.fromResult(documentVersions(answer))))
		);
	}
	let preview = $state<ReturnType<typeof previewOrder> | null>(null);
	function previewOrder(order: Id<'orders'>, version = selectedVersion) {
		const locale = bolt.locale.startsWith('zh') ? 'zh' : 'en';
		return run(
			bolt
				.query(documentRead(order, locale))
				.pipe(Effect.flatMap((answer) => orderDocument(answer, { version, locale })))
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

<!-- a draft shows its lines' total; an agreed order its current contract's -->
{#snippet orderTotal({
	row,
	value
}: {
	row: RowIn<'orders'>;
	value: ColumnsIn<'orders'>['agreed_total'] | undefined;
})}<Show
		kind={{ kind: 'money', currency: 'currency' }}
		value={(row.status !== 'draft' || row.draft_setup) && value != null ? value : row.total}
		{row}
	/>{/snippet}
<AppShell
	description={bolt.t('app.trade.description')}
	icon="lucide:clipboard-list"
	title={bolt.t('component.orders')}
	variant="full"
>
	<Table
		of="orders"
		where={{ direction: { eq: 'sales' } }}
		initialFilter={{ archived: { eq: false } }}
		columns={[
			'number',
			'title',
			'party',
			'status',
			{
				field: 'agreed_total',
				label: bolt.t('models.orders.fields.total'),
				align: 'end',
				cell: orderTotal
			},
			'owner'
		]}
		toolbar={{
			new: kinds.catalog?.orders?.create
				? () => openCreate('orders', { direction: 'sales' })
				: false,
			actions: [
				...(kinds.catalog?.document_templates
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
				...(kinds.catalog?.document_templates
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
					><Bound size="viewport"
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
