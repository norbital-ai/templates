<script lang="ts">
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	/**
	 * One statutory scheme, and the rate bands that price it.
	 *
	 * `contribution_rates.statutory_contribution_id` points at a scheme — not at a jurisdiction — so a
	 * band is not a sibling of the scheme and cannot be read beside one. A row like "5.5% from RM0 to
	 * RM5,000" is meaningless without the EPF/SOCSO/EIS scheme whose wage ladder it is a rung of, and
	 * the database says so: `contribution_rates_no_overlap` excludes overlaps *within one
	 * contribution*, so the set of bands that must not collide is exactly the set shown below.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import { formatRateAward, formatRateSelector } from '../../lib/ui/display-formatters.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	const payerLabel = $derived(
		record?.payer === 'BOTH' ? 'employee and employer' : (record?.payer?.toLowerCase() ?? 'nobody')
	);
	const keyedByLabel = $derived(
		record?.keyed_by?.toLowerCase().replaceAll('_', ' ') ?? 'nothing yet'
	);
	const subtitle = $derived(
		record == null
			? undefined
			: t('component.scheme_subtitle', {
					payer: payerLabel,
					step: record.sequence,
					keyed_by: keyedByLabel
				})
	);
</script>

{#snippet scheme()}
	<CollectionForm
		{client}
		collection="statutory_contributions"
		defaultValues={record ?? undefined}
		submitLabel={record ? t('component.save_scheme') : t('component.create_scheme')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<!--
					Three sections in the order the question is actually asked: what this scheme is, how
					much it takes and from whom, and the exceptions the statute names. No rules between
					them — the heading and its sentence are the separation, as on the settings form.
				-->
				<Stack as="section" gap="sm">
					<Stack gap="xs">
						<h3 class="text-sm font-semibold">{t('component.scheme_section_identity')}</h3>
						<p class="text-meta">{t('component.scheme_section_identity_hint')}</p>
					</Stack>
					<Grid gap="sm" minimum="compact">
						<Field
							name="settings_id"
							label={t('component.settings_version')}
							relationOptions={{
								label: (version) =>
									[version.code, version.name, version.sealed_at ? 'sealed' : 'draft']
										.filter((part) => part != null && part !== '')
										.join(' · ') || '—',
								orderBy: { code: 'asc' },
								limit: 200
							}}
						/>
						<Field name="code" />
						<Field name="name" />
						<Field name="is_statutory" label={t('component.is_statutory')} />
						<Field name="authority" />
					</Grid>
				</Stack>

				<Stack as="section" gap="sm">
					<Stack gap="xs">
						<h3 class="text-sm font-semibold">{t('component.scheme_section_calculation')}</h3>
						<p class="text-meta">{t('component.scheme_section_calculation_hint')}</p>
					</Stack>
					<Grid gap="sm" minimum="compact">
						<Field name="payer" label={t('component.paid_by')} />
						<Field name="keyed_by" label={t('component.bands_keyed_by')} />
						<Field name="rounding" />
						<Field name="sequence" label={t('component.applied_at')} />
					</Grid>
				</Stack>

				<Stack as="section" gap="sm">
					<Stack gap="xs">
						<h3 class="text-sm font-semibold">{t('component.scheme_section_exceptions')}</h3>
						<p class="text-meta">{t('component.scheme_section_exceptions_hint')}</p>
					</Stack>
					<Field
						name="relief_for"
						label={t('component.gives_relief_for')}
						relationOptions={{
							label: (contribution) =>
								[contribution.code, contribution.name]
									.filter((part) => part != null && part !== '')
									.join(' · ') || '—',
							orderBy: { sequence: 'asc' },
							limit: 500
						}}
					/>
					<Field name="special_rules" label={t('component.named_special_rules')} />
				</Stack>
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet rates()}
	{#if record}
		<CollectionTable
			{client}
			collection="contribution_rates"
			view="statutory_contributions:rates"
			title={t('component.rate_bands')}
			description={t('component.rate_bands_description')}
			query={{
				where: { statutory_contribution_id: { eq: record.id } },
				orderBy: { created_at: 'desc' }
			}}
		>
			{#snippet columns({ Column: TableColumn })}
				<TableColumn
					name="selector"
					label={t('component.applies_to')}
					card="title"
					renderer={FormattedValueRenderer}
					rendererProps={{ format: ({ value }) => formatRateSelector(value, t) }}
				/>
				<TableColumn
					name="award"
					label={t('component.award')}
					card="subtitle"
					renderer={FormattedValueRenderer}
					rendererProps={{ format: ({ value }) => formatRateAward(value, t) }}
				/>
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

<!-- Tab content must be snippets (TabConfig.content); the shell always renders tabs so no snippet is ever render-called elsewhere. -->
<RecordShell
	title={record ? `${record.code} · ${record.name}` : t('component.create_scheme')}
	{subtitle}
	tabs={[
		{
			name: 'scheme',
			label: t('component.scheme_section_identity'),
			icon: 'lucide:landmark',
			content: scheme
		},
		...(record
			? [
					{
						name: 'rates',
						label: t('component.rate_bands'),
						icon: 'lucide:percent',
						content: rates
					}
				]
			: [])
	] satisfies TabConfig[]}
/>
