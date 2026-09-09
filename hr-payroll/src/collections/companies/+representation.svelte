<script lang="ts">
	/**
	 * A company is its identity, the jurisdiction settings lineage it operates under, and three
	 * payroll facts: the attendance cutoff, how often it pays, and the risk class its regime rates it
	 * in. The risk class is shown only where the lineage levies a risk-keyed scheme; everywhere else
	 * it is empty and not a question.
	 *
	 * `settings_code` is a lineage, not a row: `MY`, `SG`, or `SG-norbital` where this entity forked
	 * the shared law. The picker offers every lineage the workspace holds and the version in force
	 * is picked per date from it, so a change of law never touches the company row.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { onLineage } from '../../lib/ui/settings-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	/**
	 * Whether the entity's lineage prices any scheme by risk class: only then is the field asked.
	 * A scheme's key is what its band selectors say, so the lineage's schemes are read with their
	 * bands and the question is answered here.
	 */
	const schemesQuery = $derived(
		record?.settings_code == null
			? null
			: client.db.statutory_contributions.findMany({
					where: { contribution_settings: { some: onLineage(record.settings_code) } },
					columns: { bands: true },
					limit: 200
				})
	);
	const riskKeyed = $derived(
		(schemesQuery?.current ?? []).some((scheme) =>
			scheme.bands.some((band) => band.selector?.by === 'RISK_CLASS')
		)
	);
	/** The lineages the workspace holds, so the code is chosen rather than typed. */
	const lineagesQuery = $derived(
		client.db.jurisdiction_settings.findMany({
			where: { approval_id: { isNull: true } },
			columns: { code: true, name: true },
			orderBy: { code: 'asc' },
			limit: 500
		})
	);
	const lineageCodes = $derived([
		...new Set((lineagesQuery.current ?? []).map((version) => version.code))
	]);
</script>

<RecordShell title={record?.name ?? t('component.create_company')}>
	<CollectionForm
		{client}
		collection="companies"
		defaultValues={record ?? undefined}
		submitLabel={record ? t('component.save_company') : t('component.create_company')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack as="section" gap="sm">
				<Stack gap="xs">
					<h3 class="text-sm font-semibold">{t('component.legal_entity')}</h3>
					<p class="text-meta">{t('component.legal_entity_description')}</p>
				</Stack>
				<Grid gap="md" minimum="panel">
					<Field name="name" label={t('component.legal_name')} />
					<Field name="registration_number" label={t('component.registration_number')} />
					<Stack gap="xs">
						<Field
							name="settings_code"
							label={t('component.settings_lineage')}
							placeholder={lineageCodes.join(', ')}
						/>
						<p class="text-meta">{t('component.settings_lineage_hint')}</p>
					</Stack>
					<Stack gap="xs">
						<Field name="region" label={t('component.region')} />
						<p class="text-meta">{t('component.region_hint')}</p>
					</Stack>
					<Field name="pay_cutoff_day" label={t('component.attendance_cutoff_day')} />
					<Field name="pay_frequency" label={t('component.pay_frequency')} />
					<Field
						name="risk_class"
						label={t('component.statutory_risk_class')}
						hidden={!riskKeyed}
						placeholder={t('component.risk_class_hint', { class_iv: 'IV', class_i: 'I' })}
					/>
					<Column span="all">
						<Field name="effective_range" label={t('component.effective_period')} />
					</Column>
				</Grid>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
