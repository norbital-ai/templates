<script lang="ts">
	/**
	 * One claim component: a pay line a person raises an expense against — a taxi fare, a medical
	 * bill, a client meal.
	 *
	 * The same eight fields as every catalogue, and one narrower type. `definition` is
	 * `entry_component_definition` — the ENTRY arm alone — so a row here cannot declare itself fed by
	 * the contract, a formula, the overtime regime or the leave ledger. That was `entry_kind`'s job on
	 * the one merged catalogue, and the table now does it without a column, which is why there is no
	 * entry-kind field on this form and no refusal behind it.
	 *
	 * `settings_id` is a relationship and reads as the version's name; the auto form asked for it as
	 * an editable uuid. `nature` is a read-only projection of `policy` and is not offered as a field.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/pay_components-banner.svg"
	/>
</svelte:head>

<RecordShell title={record?.code ?? t('component.create_catalogue_component')}>
	<CollectionForm
		{client}
		collection="claim_catalogue"
		defaultValues={record ?? undefined}
		submitLabel={record
			? t('component.save_catalogue_component')
			: t('component.create_catalogue_component')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Grid gap="md" minimum="panel">
				<Field
					name="settings_id"
					label={t('component.settings_version')}
					relationOptions={{
						label: (version) =>
							[version.code, version.name, version.sealed_at ? 'sealed' : 'draft']
								.filter((part) => part != null && part !== '')
								.join(' · ') || '—',
						orderBy: { code: 'asc' },
						limit: 500
					}}
				/>
				<Field name="code" label={t('component.code')} />
				<Field name="is_statutory" label={t('component.is_statutory')} />
				<Field name="sequence" label={t('component.applied_at')} />
				<Column span="all"><Field name="policy" label={t('component.economic_type')} /></Column>
				<Column span="all"><Field name="definition" label={t('component.how_calculated')} /></Column
				>
				<Column span="all"><Field name="eligibility" label={t('component.who_receives')} /></Column>
				<Column span="all">
					<Field name="contribution_treatments" label={t('component.contribution_treatments')} />
				</Column>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
