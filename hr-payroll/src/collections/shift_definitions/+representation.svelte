<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	// The scheduling page is scoped to one legal entity, so the entity is not a question the form
	// asks. Opened without a scope the picker returns, rather than the form offering nothing.
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	const defaults = $derived(
		record ?? (scopedCompanyId == null ? undefined : { company_id: scopedCompanyId })
	);
</script>

<RecordShell title={record ? `${record.code} · ${record.name}` : t('component.create_shift')}>
	<CollectionForm
		{client}
		collection="shift_definitions"
		defaultValues={defaults}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.shift_section')}
					hint={t('component.shift_section_hint')}
				>
					<Grid gap="md" minimum="compact">
						{#if scopedCompanyId != null}
							<Field name="company_id" hidden />
						{:else}
							<Field
								name="company_id"
								label={t('component.company')}
								relationOptions={{
									label: (row) => (row.name != null && row.name !== '' ? String(row.name) : '—'),
									orderBy: { name: 'asc' },
									limit: 500
								}}
							/>
						{/if}
						<Field name="code" />
						<Field name="name" />
						<Column span="all"><Field name="variant" /></Column>
					</Grid>
				</FormSection>
				<FormSection
					title={t('component.section_period')}
					hint={t('component.section_period_hint')}
				>
					<Grid gap="md" minimum="compact">
						<Column span="all"
							><Field name="effective_range" label={t('component.effective_period')} /></Column
						>
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
