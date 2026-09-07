<script lang="ts">
	/**
	 * One row of a settings version's leave catalogue. `settings_id` is a relationship and reads as
	 * the version's name; a statutory row cites its authority and its eligibility is one CEL
	 * expression over the person, which the write hook compiles. Sealed with its version.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<CollectionForm
	{client}
	collection="leave_types"
	defaultValues={record ?? undefined}
	submitLabel={record ? t('component.save_leave_type') : t('component.create_leave_type')}
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
			<Field name="name" label={t('component.name')} />
			<Field name="is_statutory" label={t('component.is_statutory')} />
			<Field name="authority" label={t('component.authority')} />
			<Column span="all">
				<Stack gap="xs">
					<Field name="eligibility" label={t('component.who_may_take_it')} />
					<p class="text-meta">{t('component.eligibility_placeholder')}</p>
				</Stack>
			</Column>
			<Column span="all"
				><Field name="entitlement" label={t('component.entitlement_matrix')} /></Column
			>
			<Column span="all"><Field name="accrual" label={t('component.accrual_and_carry')} /></Column>
			<Column span="all"
				><Field name="exit_settlement" label={t('component.exit_settlement')} /></Column
			>
			<Column span="all"
				><Field name="payroll_effect" label={t('component.effect_on_pay')} /></Column
			>
			<Field
				name="requires_certificate_after_days"
				label={t('component.certificate_required_after_days')}
			/>
		</Grid>
	{/snippet}
</CollectionForm>
