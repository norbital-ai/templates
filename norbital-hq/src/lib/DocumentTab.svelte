<script lang="ts">
	/**
	 * A company's (or, with `project`, a job's) documents from the template catalogue as live previews: the latest
	 * version filled with the current values, never stored, with the values it still needs. Download renders the shown
	 * text to PDF for the viewer; Send renders it to PDF on the host and mails it to its signer; uploading the signed copy
	 * freezes the values it was signed on. The latest signed copy shows
	 * above the preview, with the terms it was signed on one click away.
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
		use_act
	} from '@norbital-ai/ui';
	import { Cluster, Scroll, Stack } from '@norbital-ai/ui/layout';
	import DocumentPaper from './DocumentPaper.svelte';
	import { documentForPdf } from './document-layout.js';
	import { documentRead, latestByKey, preview, render, termsKey } from './documents.js';

	let {
		ctx,
		company,
		project
	}: { ctx: PageContext; company: Id<'companies'>; project?: Id<'projects'> } = $props();
	const t = ctx.t;
	const catalogue = $derived(
		ctx.query({
			template_documents: {
				where: { kind: { eq: 'document' }, scope: { eq: project ? 'project' : 'company' } },
				fields: ['title', 'key', 'version']
			}
		})
	);
	const templates = $derived(latestByKey(catalogue.current?.template_documents.rows ?? []));
	let chosen = $state<string | null>(null);
	const key = $derived(chosen ?? templates[0]?.key ?? null);
	// the preview is dated today and rolls over at midnight
	const day = ctx.clock('day');
	const data = $derived(
		key === null ? null : ctx.query(documentRead(key, company, project ?? null))
	);
	const current = $derived(
		data?.current === undefined ? undefined : preview(data.current, day.today)
	);
	const name = $derived(current?.template?.title ?? '');
	const latest = $derived(
		key === null
			? null
			: ctx.query({
					signed_documents: {
						where: {
							company: { eq: company },
							template_version: { is: { key: { eq: key } } },
							...(project ? { project: { eq: project } } : {})
						},
						fields: ['signed_on', 'signed_copy', 'terms'],
						order_by: { signed_on: 'desc' },
						limit: 1,
						signed_by: { fields: ['full_name'] },
						template_version: { fields: ['key', 'body'] }
					}
				})
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

	let run = $state<string | null>(null);
	const act = use_act(ctx);
	let problem = $state<string | null>(null);
	/** The shown text as a PDF, rendered for this viewer and saved by the browser; nothing is stored. */
	async function download() {
		if (shown === undefined) return;
		problem = null;
		const bytes = await (async () => {
			let image;
			if (signature) {
				const response = await fetch(ctx.file_url(signature));
				if (!response.ok) throw new Error(t('documents.signature_unavailable'));
				image = { mime: signature.mime, bytes: new Uint8Array(await response.arrayBuffer()) };
			}
			return settle(ctx.preview_pdf({ markdown: documentForPdf(shown, image) }));
		})().catch((error: { message: string }) => {
			problem = error.message;
			return null;
		});
		if (bytes === null) return;
		const link = document.createElement('a');
		link.href = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
		link.download = `${name || 'document'}.pdf`;
		link.click();
		URL.revokeObjectURL(link.href);
	}
	/** Renders the document to PDF on the host and mails it to its signer; the sender gets the PDF too. */
	const send = () => {
		const contact = current?.contact;
		if (key === null || contact === undefined) return;
		const handle = ctx.run('send_message', {
			contact: contact.id,
			template: key,
			...(project ? { project } : {})
		});
		run = handle.id;
		act.run(handle);
	};
</script>

<Scroll name="documents" size="fill" inset>
	<Stack gap="md">
		{#if templates.length === 0}
			<EmptyState variant="inset" title={t('documents.none')} />
		{:else}
			<Cluster gap="sm" align="center">
				{#each templates as template (template.key)}
					<Button
						variant={template.key === key ? 'default' : 'outline'}
						onclick={() => {
							chosen = template.key;
							viewing = 'current';
						}}>{template.title}</Button
					>
				{/each}
			</Cluster>
			<Cluster gap="sm" align="center">
				<Button disabled={!sendable} onclick={send}
					>{t('documents.send', { name: current?.contact?.full_name ?? '' })}</Button
				>
				<Button variant="outline" disabled={shown === undefined} onclick={download}
					>{t('documents.download')}</Button
				>
				<Button
					variant="outline"
					disabled={current?.template === undefined}
					onclick={() => (uploading = true)}>{t('documents.upload')}</Button
				>
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
						<span class="text-sm" role="status"
							>{t('documents.signed_on')}
							<Show {ctx} kind={{ kind: 'date' }} value={signed.signed_on} />
							{#if signed.signed_by}{t('documents.signed_by', {
									name: signed.signed_by.full_name
								})}{/if}</span
						>
						<a
							href={ctx.file_url(signed.signed_copy)}
							target="_blank"
							rel="noopener noreferrer"
							class="text-sm underline">{t('documents.view_copy')}</a
						>
						<Button
							variant="ghost"
							onclick={() => (viewing = viewing === 'signed' ? 'current' : 'signed')}
							>{t(viewing === 'signed' ? 'documents.view_current' : 'documents.view_terms')}</Button
						>
					</Cluster>
					{#if drifted}<p class="text-sm">{t('documents.drifted')}</p>{/if}
				</Stack>
			{/if}
			{#if data?.error}
				<p role="alert" class="text-sm text-destructive">{t('documents.preview_failed')}</p>
			{:else if shown === undefined}
				<p role="status" class="text-meta">{t('documents.preview_loading')}</p>
			{:else}
				<DocumentPaper
					body={shown}
					title={name}
					signature={signature ? ctx.file_url(signature) : undefined}
				/>
			{/if}
		{/if}
	</Stack>
</Scroll>

<Sheet
	open={uploading}
	on_open_change={(open) => {
		if (!open) uploading = false;
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
