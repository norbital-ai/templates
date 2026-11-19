<script lang="ts">
	/**
	 * Opens a WYSIWYG document preview sheet for one dynamic `template_documents` key and company:
	 * immediately shows the formatted A4 preview (`DocumentPaper`) and renders the PDF preview when requested,
	 * with Send, Download PDF, Upload signed copy, and View signed copy controls.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id } from '@norbital-ai/bolt';
	import { run as settle } from '@norbital-ai/ui/effect';
	import {
		Button,
		EmptyState,
		RecordShell,
		RunStatus,
		Sheet,
		Show,
		Spinner,
		use_act
	} from '@norbital-ai/ui';
	import { Cluster, Scroll, Stack } from '@norbital-ai/ui/layout';
	import DocumentPaper from './DocumentPaper.svelte';
	import { documentForPdf } from './document-layout.js';
	import { documentRead, preview, render, termsKey } from './documents.js';

	let {
		ctx,
		company,
		templateKey,
		open = $bindable(false),
		project
	}: {
		ctx: PageContext;
		company: Id<'companies'>;
		templateKey: string | null;
		open: boolean;
		project?: Id<'projects'>;
	} = $props();

	const t = ctx.t;
	const day = ctx.clock('day');
	const data = $derived(
		open && templateKey !== null
			? ctx.query(documentRead(templateKey, company, project ?? null))
			: null
	);
	const current = $derived(
		data?.current === undefined ? undefined : preview(data.current, day.today)
	);
	const name = $derived(current?.template?.title ?? '');
	const latest = $derived(
		open && templateKey !== null
			? ctx.query({
					signed_documents: {
						where: {
							company: { eq: company },
							template_version: { is: { key: { eq: templateKey } } },
							...(project ? { project: { eq: project } } : {})
						},
						fields: ['signed_on', 'signed_copy', 'terms'],
						order_by: { signed_on: 'desc' },
						limit: 1,
						signed_by: { fields: ['full_name'] },
						template_version: { fields: ['key', 'body'] }
					}
				})
			: null
	);
	const signed = $derived(latest?.current?.signed_documents.rows[0]);
	const frozen = $derived(
		signed?.template_version == null
			? undefined
			: {
					body: render(signed.template_version.body, signed.terms),
					key: termsKey(signed.template_version.id, signed.terms)
				}
	);
	let viewing = $state<'current' | 'signed'>('current');
	let uploading = $state(false);
	let run = $state<string | null>(null);
	const act = use_act(ctx);
	let problem = $state<string | null>(null);
	let pdfBusy = $state(false);
	let pdfObjectUrl = $state<string | null>(null);
	let viewMode = $state<'paper' | 'pdf'>('paper');

	const shown = $derived(viewing === 'signed' && frozen ? frozen.body : current?.body);
	const signature = $derived(
		viewing === 'signed'
			? null
			: (data?.current?.agreement_settings.rows[0]?.provider_signature ?? null)
	);
	const drifted = $derived(
		frozen !== undefined && current !== undefined && frozen.key !== current.key
	);
	const sendable = $derived(
		current?.template !== undefined && current.missing.length === 0 && !!current.contact?.email
	);

	async function buildPdfBytes(): Promise<Uint8Array | null> {
		if (shown === undefined) return null;
		problem = null;
		pdfBusy = true;
		try {
			let image: { mime: string; bytes: Uint8Array } | undefined;
			if (signature) {
				const response = await fetch(ctx.file_url(signature));
				if (!response.ok) throw new Error(t('documents.signature_unavailable'));
				image = { mime: signature.mime, bytes: new Uint8Array(await response.arrayBuffer()) };
			}
			return await settle(ctx.preview_pdf({ markdown: documentForPdf(shown, image) }));
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
			return null;
		} finally {
			pdfBusy = false;
		}
	}

	async function renderPdfPreview() {
		const bytes = await buildPdfBytes();
		if (bytes === null) return;
		if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl);
		pdfObjectUrl = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
		viewMode = 'pdf';
	}

	async function download() {
		const bytes = await buildPdfBytes();
		if (bytes === null) return;
		const link = document.createElement('a');
		link.href = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
		link.download = `${name || 'document'}.pdf`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	const send = () => {
		const contact = current?.contact;
		if (templateKey === null || contact === undefined) return;
		const handle = ctx.run('send_message', {
			contact: contact.id,
			template: templateKey,
			...(project ? { project } : {})
		});
		run = handle.id;
		act.run(handle);
	};

	$effect(() => {
		if (!open) {
			viewing = 'current';
			viewMode = 'paper';
			problem = null;
			if (pdfObjectUrl) {
				URL.revokeObjectURL(pdfObjectUrl);
				pdfObjectUrl = null;
			}
		}
	});
</script>

<Sheet
	{open}
	on_open_change={(next) => {
		open = next;
	}}
	title={name || t('customer.documents')}
>
	<Scroll name="document-preview" size="fill" inset>
		<Stack gap="md">
			<Cluster gap="sm" align="center">
				<Button disabled={!sendable} onclick={send}>
					{t('documents.send', { name: current?.contact?.full_name ?? '' })}
				</Button>
				<Button variant="outline" disabled={shown === undefined || pdfBusy} onclick={download}>
					{t('documents.download')}
				</Button>
				<Button
					variant="outline"
					disabled={shown === undefined || pdfBusy}
					onclick={() => void (viewMode === 'pdf' ? (viewMode = 'paper') : renderPdfPreview())}
				>
					{#if pdfBusy}<Spinner class="mr-1.5 size-3.5" />{/if}
					{viewMode === 'pdf' ? t('documents.view_wysiwyg') : t('documents.render_pdf')}
				</Button>
				<Button
					variant="outline"
					disabled={current?.template === undefined}
					onclick={() => (uploading = true)}
				>
					{t('documents.upload')}
				</Button>
				{#if run}<RunStatus {ctx} automation="send_message" {run} />{/if}
			</Cluster>

			{#if problem}<p role="alert" class="text-sm text-destructive">{problem}</p>{/if}
			{#if current && current.missing.length > 0}
				<p role="status" class="text-sm">
					{t('documents.missing', { names: current.missing.join(', ') })}
				</p>
			{:else if current && !current.contact?.email}
				<p role="status" class="text-sm">{t('documents.no_signer')}</p>
			{/if}

			{#if signed}
				<Stack gap="xs">
					<Cluster gap="sm" align="center">
						<span class="text-sm" role="status">
							{t('documents.signed_on')}
							<Show {ctx} kind={{ kind: 'date' }} value={signed.signed_on} />
							{#if signed.signed_by}{t('documents.signed_by', {
									name: signed.signed_by.full_name
								})}{/if}
						</span>
						<a
							href={ctx.file_url(signed.signed_copy)}
							target="_blank"
							rel="noopener noreferrer"
							class="text-sm underline">{t('documents.view_copy')}</a
						>
						<Button
							variant="ghost"
							onclick={() => {
								viewing = viewing === 'signed' ? 'current' : 'signed';
								viewMode = 'paper';
							}}
							>{t(viewing === 'signed' ? 'documents.view_current' : 'documents.view_terms')}</Button
						>
					</Cluster>
					{#if drifted}<p class="text-sm">{t('documents.drifted')}</p>{/if}
				</Stack>
			{/if}

			{#if data?.error}
				<p role="alert" class="text-sm text-destructive">{t('documents.preview_failed')}</p>
			{:else if shown === undefined}
				<EmptyState variant="inset" title={t('documents.preview_loading')} />
			{:else if viewMode === 'pdf' && pdfObjectUrl}
				<iframe
					src={pdfObjectUrl}
					title={name || 'PDF preview'}
					class="h-[72vh] w-full rounded-lg border bg-white"
				></iframe>
			{:else}
				<DocumentPaper
					body={shown}
					title={name}
					signature={signature ? ctx.file_url(signature) : undefined}
					signaturesLabel={t('component.signatures')}
				/>
			{/if}
		</Stack>
	</Scroll>
</Sheet>

<Sheet
	open={uploading}
	on_open_change={(next) => {
		if (!next) uploading = false;
	}}
	title={t('documents.upload_title', { name })}
>
	{#if uploading && current?.template}
		<RecordShell
			{ctx}
			of="signed_documents"
			mode="create"
			values={{
				template_version: current.template.id,
				company,
				...(project ? { project } : {}),
				...(current.contact ? { signed_by: current.contact.id } : {})
			}}
			fields={['signed_copy', 'signed_on', 'signed_by']}
			on_done={(outcome) => {
				if (outcome.kind === 'committed' || outcome.kind === 'pending_approval') uploading = false;
			}}
		/>
	{/if}
</Sheet>
