<script lang="ts">
	import type { Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, Table, open_record } from '@norbital-ai/ui';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { newestReportTemplateFirst } from '../../services/reports/report-document.js';
	import { openCreate } from '../../services/ui/create-values.js';

	let { ctx }: { ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);

	type Template = Row<'report_templates'>;
	const kinds = ['sustainability_report', 'compliance_report'] as const;
	const locales = ['en', 'zh'] as const;
	type Kind = (typeof kinds)[number];
	type Locale = (typeof locales)[number];

	const read = ctx.query({ report_templates: { limit: 500 } });
	const newest = (rows: readonly Template[]) => [...rows].sort(newestReportTemplateFirst)[0];

	const slot = (kind: Kind, locale: Locale) => {
		const rows = (read.current?.report_templates.rows ?? []).filter(
			(row) => row.kind === kind && row.locale === locale
		);
		return {
			current: newest(rows.filter((row) => row.status === 'published')),
			draft: newest(rows.filter((row) => row.status === 'draft'))
		};
	};

	const cases = $derived(
		kinds.flatMap((kind) =>
			locales.map((locale) => {
				const { current, draft } = slot(kind, locale);
				return {
					id: `${kind}:${locale}`,
					kind,
					locale,
					current: current?.title ?? '',
					draft: draft?.version ?? null
				};
			})
		)
	);
	type Case = (typeof cases)[number];

	const revise = (kind: Kind, locale: Locale, from: Template | undefined) =>
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
</script>

{#snippet caseName({ row }: { row: Case })}
	<Stack as="span" gap="none">
		<span class="font-medium">{t(`models.report_templates.fields.kind.${row.kind}`)}</span>
		<span class="text-meta">{t(`reports.when.${row.kind}`)}</span>
	</Stack>
{/snippet}

{#snippet localeCell({ row }: { row: Case })}
	{t(`models.report_templates.fields.locale.${row.locale}`)}
{/snippet}

{#snippet publishedCell({ row }: { row: Case })}
	{@const { current } = slot(row.kind, row.locale)}
	{#if current}
		{`${current.title} · ${t('reports.template_version', { version: current.version })}`}
	{:else}
		<Badge variant="warning">{t('reports.missing')}</Badge>
	{/if}
{/snippet}

{#snippet draftCell({ row }: { row: Case })}
	{@const { draft } = slot(row.kind, row.locale)}
	{#if draft}
		<Badge variant="outline">{t('reports.draft_badge', { version: draft.version })}</Badge>
	{:else}
		{t('component.no_value')}
	{/if}
{/snippet}

<AppShell
	description={t('reports.nav_description')}
	title={t('reports.nav_title')}
	icon="lucide:file-spreadsheet"
>
	<Table
		{ctx}
		of={cases}
		key="construction:report_templates"
		columns={[
			{ field: 'kind', label: t('models.report_templates.fields.kind'), cell: caseName },
			{ field: 'locale', label: t('models.report_templates.fields.locale'), cell: localeCell },
			{
				field: 'current',
				label: t('models.report_templates.fields.status.published'),
				cell: publishedCell
			},
			{
				field: 'draft',
				label: t('models.report_templates.fields.status.draft'),
				cell: draftCell
			}
		]}
		on_open={(row) => {
			const { current, draft } = slot(row.kind, row.locale);
			if (current) open_record('report_templates', current.id);
			else if (draft) open_record('report_templates', draft.id);
			else revise(row.kind, row.locale, undefined);
		}}
		actions={[
			{
				label: t('reports.revise'),
				run: (row) => {
					const { current, draft } = slot(row.kind, row.locale);
					if (draft) open_record('report_templates', draft.id);
					else revise(row.kind, row.locale, current);
				}
			}
		]}
		toolbar={{ title: false, description: t('reports.page_help'), new: false }}
	/>
</AppShell>
