<script lang="ts">
	/**
	 * A holiday belongs to the settings version whose calendar it is on, so the auto form asked for
	 * `settings_id` as an editable uuid. It is a relationship and reads as the version's name.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<CollectionForm
	{client}
	collection="company_holidays"
	defaultValues={record ?? undefined}
	submitLabel={record ? t('component.save_holiday') : t('component.create_holiday')}
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
			<Field name="name" label={t('component.holiday')} />
			<Field name="date" label={t('component.observed_on')} />
			<Field name="substitutes_date" label={t('component.substitute_for')} />
			<Field name="is_statutory" label={t('component.is_statutory')} />
			<Column span="all"><Field name="scope" label={t('component.who_observes_it')} /></Column>
		</Grid>
	{/snippet}
</CollectionForm>
