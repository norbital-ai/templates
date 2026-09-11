<script lang="ts">
	/**
	 * A named shift pattern of one jurisdiction lineage. The Settings Work catalogue hosts these,
	 * so the lineage is not a question the form asks; the dialog chrome names the record. Opened
	 * without that scope the field returns, rather than the form offering nothing.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedSettingsCode = $derived(createScope?.settingsCode());
	const defaults = $derived(
		record ?? (scopedSettingsCode == null ? undefined : { settings_code: scopedSettingsCode })
	);
</script>

<CollectionForm
	{client}
	collection="shift_patterns"
	defaultValues={defaults}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Stack gap="sm">
			<p class="text-meta">{t('component.pattern_section_hint')}</p>
			<Grid gap="md" minimum="card">
				{#if scopedSettingsCode != null}
					<Field name="settings_code" hidden />
				{:else}
					<Field name="settings_code" label={t('component.settings_lineage')} />
				{/if}
				<Field name="code" />
				<Field name="name" />
				<Column span="all"><Field name="pattern" label={t('component.work_pattern')} /></Column>
			</Grid>
			<p class="text-meta">{t('component.section_period_hint')}</p>
			<Field name="effective_range" label={t('component.effective_period')} />
		</Stack>
	{/snippet}
</CollectionForm>
