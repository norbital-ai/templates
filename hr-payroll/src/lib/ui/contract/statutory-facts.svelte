<script lang="ts">
	/**
	 * One person's statutory standing, a form per scheme the jurisdiction declares.
	 *
	 * This was a table of rows with a "New Employment Statutory Fact" dialog behind it: to record a
	 * standing you had to know the collection existed, and the page never showed which schemes the
	 * version expects. The version in force on the page's lineage names them — code, authority and
	 * the keys each scheme reads — so the tab renders one section per scheme, holding that scheme's
	 * form. The controls inside a scheme are the same the record sheet uses: the status renderer
	 * reads the scheme's declared `elections` and draws one control per declared key, so a
	 * jurisdiction that needs `voluntary_rate` or `non_resident` gets it without new code here.
	 *
	 * A scheme with a standing in force is an edit of that row; one without is a new dated fact,
	 * which is how a successor closes its predecessor. Where the page carries no lineage, the
	 * person's recorded facts are shown instead of nothing.
	 */
	import { client } from '../../workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { getCollectionRecordScope } from '@norbital-ai/ui/collection-runtime';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { hrCreateScope, employmentRelationOptions } from '../create-scope.js';
	import { inForceSettings } from '../settings-scope.js';
	import { todayKey } from '../calendar.js';
	import { coversDate } from '../../../collections/payroll_runs/lib/effective.js';
	import StatutoryFactStatusRenderer from '../../../datatypes/statutory_fact_status/+renderer.svelte';
	import EffectiveRangeRenderer from '../effective-range-renderer.svelte';
	import FormSection from '../form-section.svelte';

	type Scheme = WorkspaceRow<'statutory_contributions'>;
	type Fact = WorkspaceRow<'employment_statutory_facts'>;

	// The record the surface was mounted for is framework knowledge: a representation may not hand a
	// system column to a child, so the scope supplies the person instead of a prop.
	const recordScope = getCollectionRecordScope();
	const employeeId = $derived(recordScope?.() ?? null);
	const { t } = useI18n<TenantI18nKeys>();
	const scope = hrCreateScope();
	const today = todayKey();
	const settingsCode = $derived(scope?.settingsCode());
	const versionQuery = $derived(
		settingsCode == null
			? null
			: client.db.jurisdiction_settings.findFirst({
					where: inForceSettings(settingsCode, today),
					columns: { id: true }
				})
	);
	const versionId = $derived(versionQuery?.current?.id ?? null);
	const schemesQuery = $derived(
		versionId == null
			? null
			: client.db.statutory_contributions.findMany({
					where: { settings_id: { eq: versionId }, approval_id: { isNull: true } },
					columns: {
						id: true,
						code: true,
						name: true,
						short_name: true,
						authority: true,
						listing_order: true,
						listing_group: true
					},
					limit: 200
				})
	);
	const factsQuery = $derived(
		employeeId == null
			? null
			: client.db.employment_statutory_facts.findMany({
					where: { employee_id: { eq: employeeId } },
					limit: 200
				})
	);
	const facts = $derived(factsQuery?.current ?? []);
	const schemes = $derived(
		(schemesQuery?.current ?? []).toSorted(
			(left, right) =>
				(left.listing_order ?? Number.POSITIVE_INFINITY) -
					(right.listing_order ?? Number.POSITIVE_INFINITY) ||
				String(left.code).localeCompare(String(right.code))
		)
	);
	/** The standing in force today, or none: a new fact is a new period, not a second line. */
	const standingFor = (schemeId: string): Fact | null =>
		facts.find(
			(fact) =>
				fact.statutory_contribution_id === schemeId && coversDate(fact.effective_range, today)
		) ?? null;
	const schemeLabelOf = (scheme: Scheme): string => scheme.short_name ?? scheme.name ?? scheme.code;
	const factSections = $derived(
		schemes.length > 0 ? schemes.map((scheme) => ({ scheme, fact: standingFor(scheme.id) })) : []
	);
	const orphanFacts = $derived(schemes.length === 0 ? facts : []);
</script>

<Stack gap="lg">
	<p class="text-meta">{t('component.statutory_registrations_description')}</p>
	{#if schemesQuery?.loading || factsQuery?.loading}
		<p class="text-meta">{t('component.loading')}</p>
	{:else if factSections.length > 0}
		{#each factSections as { scheme, fact } (scheme.id)}
			<FormSection
				title={schemeLabelOf(scheme)}
				hint={scheme.authority ?? t('component.fact_section_registration_hint')}
			>
				<CollectionForm
					{client}
					collection="employment_statutory_facts"
					defaultValues={fact ?? {
						employee_id: employeeId ?? '',
						statutory_contribution_id: scheme.id,
						effective_range: { start: today, end: null },
						status: { kind: 'REGISTERED', reference_number: '', rate_override: null }
					}}
					submitLabel={fact == null
						? t('component.record_registration')
						: t('component.save_registration')}
				>
					{#snippet children({ Field, form })}
						<Grid gap="sm" minimum="compact">
							<Field name="employee_id" hidden />
							<Field
								name="employment_id"
								label={t('component.fact_employment')}
								relationOptions={{
									...employmentRelationOptions(scope?.companyId()),
									where: {
										...(scope?.companyId() ? { company_id: { eq: scope.companyId()! } } : {}),
										...(employeeId == null ? {} : { employee_id: { eq: employeeId } })
									}
								}}
							/>
							<Field name="statutory_contribution_id" hidden />
							<Field
								name="status"
								label={t('component.status')}
								renderer={StatutoryFactStatusRenderer}
								rendererProps={{ schemeId: scheme.id }}
							/>
							<Field
								name="effective_range"
								renderer={EffectiveRangeRenderer}
								label={t('component.effective_period')}
							/>
							{#if form.values().employment_id == null || form.values().employment_id === ''}
								<p class="text-xs text-muted-foreground">
									{t('component.fact_employment_hint')}
								</p>
							{/if}
						</Grid>
					{/snippet}
				</CollectionForm>
			</FormSection>
		{/each}
	{:else if orphanFacts.length > 0}
		<!-- No lineage in context: show what the person has, so a fact never disappears from view. -->
		{#each orphanFacts as fact (fact.id)}
			<FormSection title={String(fact.summary ?? t('component.statutory_facts'))}>
				<CollectionForm
					{client}
					collection="employment_statutory_facts"
					defaultValues={fact}
					submitLabel={t('component.save_registration')}
				>
					{#snippet children({ Field })}
						<Grid gap="sm" minimum="compact">
							<Field name="employee_id" hidden />
							<Field name="employment_id" hidden />
							<Field name="statutory_contribution_id" hidden />
							<Field
								name="status"
								label={t('component.status')}
								renderer={StatutoryFactStatusRenderer}
								rendererProps={{ schemeId: fact.statutory_contribution_id }}
							/>
							<Field
								name="effective_range"
								renderer={EffectiveRangeRenderer}
								label={t('component.effective_period')}
							/>
						</Grid>
					{/snippet}
				</CollectionForm>
			</FormSection>
		{/each}
	{:else}
		<p class="text-sm text-muted-foreground">{t('component.statutory_registrations_none')}</p>
	{/if}
</Stack>
