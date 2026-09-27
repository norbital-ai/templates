<script lang="ts">
	import { t } from '../t.js';
	import { everyField } from '../../every-field.js';
	/**
	 * One person's statutory standing, a form per scheme the jurisdiction declares. The version in force on the page's
	 * lineage names the schemes — code, authority and the keys each reads — so the tab renders one section per scheme;
	 * the status renderer draws one control per declared election. A scheme with a standing in force is an edit of that
	 * row; one without is a new dated fact, which is how a successor closes its predecessor. Where the page carries no
	 * lineage, the person's recorded facts are shown instead of nothing.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Field, Form, Picker } from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { coversDate } from '../../../lib/payroll/run/effective.js';
	import StatutoryFactStatusRenderer from '../../../data/custom_field/statutory_fact_status/+renderer.svelte';
	import { todayKey } from '../calendar.js';
	import { hrCreateScope } from '../create-scope.js';
	import FormSection from '../form-section.svelte';
	import { liveRows } from '../live.svelte.js';
	import { inForceSettings } from '../settings-scope.js';
	import * as Predicate from 'effect/Predicate';

	const scope = hrCreateScope();
	const employeeId = $derived(scope?.employeeId?.() ?? null);
	const companyId = $derived(scope?.companyId());
	const today = todayKey();
	const settingsCode = $derived(scope?.settingsCode());
	// Schemes reach their version through `settings_id`: the version in force today on the page's lineage.
	const schemesRows = liveRows(() =>
		settingsCode == null
			? null
			: bolt.read('statutory_contributions', {
					where: {
						settings_id: { is: inForceSettings(settingsCode, today) },
						approval_id: { isNull: true }
					},
					select: {
						code: true,
						name: true,
						short_name: true,
						authority: true,
						listing_order: true
					},
					all: true
				})
	);
	const factRows = liveRows(() =>
		employeeId == null
			? null
			: bolt.read('employment_statutory_facts', {
					select: everyField('employment_statutory_facts'),
					where: { employee_id: { eq: employeeId } },
					all: true
				})
	);
	const facts = $derived(factRows.current ?? []);
	const schemes = $derived(
		(schemesRows.current ?? []).toSorted(
			(left, right) =>
				(left.listing_order ?? Number.POSITIVE_INFINITY) -
					(right.listing_order ?? Number.POSITIVE_INFINITY) || left.code.localeCompare(right.code)
		)
	);
	/** The standing in force today, or none: a new fact is a new period, not a second line. */
	const standingFor = (schemeId: Id<'statutory_contributions'>) =>
		facts.find(
			(fact) =>
				fact.statutory_contribution_id === schemeId && coversDate(fact.effective_range, today)
		) ?? null;
	const factSections = $derived(
		schemes.map((scheme) => ({ scheme, fact: standingFor(scheme.id) }))
	);
	const orphanFacts = $derived(schemes.length === 0 ? facts : []);
	const text = (value: unknown) => (Predicate.isString(value) ? value : null);
	const statusView = (field: {
		name: string;
		value: unknown;
		disabled: boolean;
		onChange(next: never): void;
	}) => ({
		mode: 'edit' as const,
		name: field.name,
		value: field.value as never,
		disabled: field.disabled,
		onChange: field.onChange
	});
</script>

<Stack gap="lg">
	<p class="text-meta">{t('component.statutory_registrations_description')}</p>
	{#if schemesRows.loading || factRows.loading}
		<p class="text-meta">{t('component.loading')}</p>
	{:else if factSections.length > 0}
		{#each factSections as { scheme, fact } (scheme.id)}
			<FormSection
				title={scheme.short_name ?? scheme.name ?? scheme.code}
				hint={scheme.authority ?? t('component.fact_section_registration_hint')}
			>
				<Form
					of="employment_statutory_facts"
					mode={fact == null ? 'create' : 'update'}
					{...fact == null ? {} : { id: fact.id, record: fact }}
					values={fact == null
						? {
								...(employeeId == null ? {} : { employee_id: employeeId }),
								statutory_contribution_id: scheme.id,
								effective_range: { from: today, to: null },
								status: { kind: 'REGISTERED', reference_number: '', rate_override: null }
							}
						: {}}
					submit={fact == null
						? t('component.record_registration')
						: t('component.save_registration')}
				>
					{#snippet children(form)}
						<Grid gap="md" minimum="panel">
							<Field name="employment_id" label={t('component.fact_employment')}>
								{#snippet editor(field)}
									<Picker
										of="employments"
										label={['employee_number']}
										where={{
											...(companyId ? { company_id: { eq: companyId } } : {}),
											...(employeeId == null ? {} : { employee_id: { eq: employeeId } })
										}}
										value={text(field.value)}
										onChange={field.onChange}
										disabled={field.disabled}
									/>
								{/snippet}
							</Field>
							<Field name="effective_range" label={t('component.effective_period')} />
							<!-- The scheme's own declarations are the tall half: full width, so they lay out in a row. -->
							<Column span="all">
								<Field name="status" label={t('component.status')}>
									{#snippet editor(field)}
										<StatutoryFactStatusRenderer view={statusView(field)} schemeId={scheme.id} />
									{/snippet}
								</Field>
							</Column>
							{#if form.get('employment_id') == null || form.get('employment_id') === ''}
								<Column span="all">
									<p class="text-xs text-muted-foreground">{t('component.fact_employment_hint')}</p>
								</Column>
							{/if}
						</Grid>
					{/snippet}
				</Form>
			</FormSection>
		{/each}
	{:else if orphanFacts.length > 0}
		<!-- No lineage in context: show what the person has, so a fact never disappears from view. -->
		{#each orphanFacts as fact (fact.id)}
			<FormSection title={fact.summary || t('component.statutory_facts')}>
				<Form
					of="employment_statutory_facts"
					mode="update"
					id={fact.id}
					record={fact}
					submit={t('component.save_registration')}
				>
					<Grid gap="md" minimum="panel">
						<Column span="all">
							<Field name="status" label={t('component.status')}>
								{#snippet editor(field)}
									<StatutoryFactStatusRenderer
										view={statusView(field)}
										schemeId={fact.statutory_contribution_id}
									/>
								{/snippet}
							</Field>
						</Column>
						<Field name="effective_range" label={t('component.effective_period')} />
					</Grid>
				</Form>
			</FormSection>
		{/each}
	{:else}
		<p class="text-sm text-muted-foreground">{t('component.statutory_registrations_none')}</p>
	{/if}
</Stack>
