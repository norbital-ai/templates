<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { attach } from '@norbital-ai/ui/effect';
	import { Badge, Button, Checkbox, Dialog, Icon, Label, open_record } from '@norbital-ai/ui';
	import { Cluster, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import SegmentedToggle from '../ui/SegmentedToggle.svelte';
	import { openCreate } from '../ui/create-values.js';
	import ReportPdfViewer from './ReportPdfViewer.svelte';
	import {
		newestReportTemplateFirst,
		ReportUnavailable,
		type ReportKind,
		type ReportLocale
	} from './report-document.js';
	import { projectReportPdf } from './report-pdf.js';

	let {
		ctx,
		projectId,
		kind,
		today,
		onClose
	}: {
		ctx: PageContext;
		projectId: Id<'projects'>;
		kind: ReportKind;
		today: string;
		onClose: () => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const canManageTemplates = $derived(ctx.catalog?.report_templates?.create !== undefined);

	let locale = $state<ReportLocale>(ctx.locale.toLowerCase().startsWith('zh') ? 'zh' : 'en');
	let includeStamp = $state(true);
	let stampAvailable = $state(false);
	let file = $state<{
		title: string;
		version: string;
		url: string;
		name: string;
	} | null>(null);
	let error = $state<string | null>(null);

	const templatesQuery = $derived(
		ctx.query({
			report_templates: {
				where: { kind: { eq: kind }, locale: { eq: locale } },
				limit: 50
			}
		})
	);
	const slot = $derived.by(() => {
		const rows = templatesQuery.current?.report_templates.rows ?? [];
		return {
			published: [...rows]
				.filter((r) => r.status === 'published')
				.sort(newestReportTemplateFirst)[0],
			draft: [...rows].filter((r) => r.status === 'draft').sort(newestReportTemplateFirst)[0]
		};
	});

	function handleEditTemplate() {
		if (slot.draft) {
			open_record('report_templates', slot.draft.id);
			return;
		}
		const from = slot.published;
		openCreate('report_templates', {
			kind,
			locale,
			...(from
				? {
						title: from.title,
						...(from.standard_ref ? { standard_ref: from.standard_ref } : {}),
						body: from.body,
						...(from.print_layout ? { print_layout: from.print_layout } : {}),
						...(from.letterhead ? { letterhead: from.letterhead } : {}),
						...(from.company_stamp ? { company_stamp: from.company_stamp } : {})
					}
				: {})
		});
	}

	const loadPdf = attach(() => {
		const activeLocale = locale;
		const stamp = includeStamp;
		const templateRevision = slot.published?.revision ?? 0;
		void templateRevision;
		return Effect.gen(function* () {
			file = null;
			error = null;
			const { document, bytes } = yield* projectReportPdf(
				ctx,
				projectId,
				kind,
				activeLocale,
				today,
				stamp
			);
			stampAvailable = document.stamp != null;
			const url = yield* Effect.acquireRelease(
				Effect.sync(() => URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))),
				(u) => Effect.sync(() => URL.revokeObjectURL(u))
			);
			file = {
				title: document.title,
				version: document.template_version,
				url,
				name: document.filename
			};
			yield* Effect.never;
		}).pipe(
			Effect.catch((cause) =>
				Effect.sync(() => {
					error =
						cause instanceof ReportUnavailable &&
						cause.message === 'errors.report_template_unpublished'
							? t('errors.report_template_unpublished')
							: t('reports.unavailable');
				})
			)
		);
	});

	const localeOptions = $derived([
		{ value: 'en' as const, label: t('models.report_templates.fields.locale.en') },
		{ value: 'zh' as const, label: t('models.report_templates.fields.locale.zh') }
	]);
</script>

<Dialog.Root
	open
	on_open_change={(open) => {
		if (!open) onClose();
	}}
>
	<Dialog.Content class="max-w-4xl">
		<Dialog.Title>
			{kind === 'sustainability_report'
				? t('reports.preview_sustainability_title')
				: t('reports.preview_compliance_title')}
		</Dialog.Title>
		<div {@attach loadPdf}>
			<Stack gap="md">
				<Cluster align="center" justify="between" gap="sm">
					<Cluster align="center" gap="sm">
						<SegmentedToggle
							options={localeOptions}
							value={locale}
							onChange={(next) => (locale = next)}
							label={t('models.report_templates.fields.locale')}
							control={{
								id: 'construction:report-preview-locale',
								label: t('models.report_templates.fields.locale')
							}}
						/>
						{#if file}
							<Badge variant="outline" class="font-mono text-tiny">
								{t('reports.template_version', { version: file.version })}
							</Badge>
						{/if}
						{#if stampAvailable}
							<Inline gap="xs" align="center">
								<Checkbox id="include-report-stamp" bind:checked={includeStamp} />
								<Label for="include-report-stamp">{t('reports.include_company_stamp')}</Label>
							</Inline>
						{/if}
					</Cluster>
					<Cluster align="center" gap="xs">
						{#if canManageTemplates}
							<Button variant="outline" onclick={handleEditTemplate}>
								<Icon name="lucide:file-pen-line" class="size-3.5" />
								{slot.draft ? t('reports.open_draft_template') : t('reports.update_template')}
							</Button>
						{/if}
						{#if file}
							<Button variant="brand" href={file.url} download={file.name}>
								<Icon name="lucide:download" class="size-3.5" />
								{t('reports.export_pdf')}
							</Button>
						{/if}
					</Cluster>
				</Cluster>

				{#if file}
					<ReportPdfViewer {ctx} url={file.url} title={file.title} />
				{:else if error}
					<p role="alert" class="text-sm text-destructive">{error}</p>
				{:else}
					<p role="status" class="text-sm text-muted-foreground">{t('reports.preparing_pdf')}</p>
				{/if}
			</Stack>
		</div>
	</Dialog.Content>
</Dialog.Root>
