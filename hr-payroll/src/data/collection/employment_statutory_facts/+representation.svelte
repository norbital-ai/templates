<script lang="ts">
	/**
	 * Where one person stands with one statutory scheme: registered with a reference, or not registered with a reason,
	 * across a window. The scheme picker offers the schemes of the version in force today on the page's lineage; a
	 * successor closes its predecessor by an explicit edit of the predecessor's range.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import { t } from '../../../lib/ui/t.js';
	import { Field, Form } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import StatutoryFactStatusRenderer from '../../custom_field/statutory_fact_status/+renderer.svelte';
	import { todayKey } from '../../../lib/ui/calendar.js';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { inForceSettings } from '../../../lib/ui/settings-scope.js';
	import * as Predicate from 'effect/Predicate';

	let { view }: { view: RecordView<'employment_statutory_facts'> } = $props();
	const scope = hrCreateScope();
	const scopedEmployeeId = $derived(scope?.employeeId?.());
	const scopedEmploymentId = $derived(scope?.employmentId?.());
	const scopedCompanyId = $derived(scope?.companyId());
	const scopedSettingsCode = $derived(scope?.settingsCode());
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(
		createValues(view, { employee_id: scopedEmployeeId, employment_id: scopedEmploymentId })
	);
	// Schemes reach their version through `settings_id`; unscoped, the picker offers every scheme of every version.
	const inForceSchemes = $derived(
		scopedSettingsCode == null
			? {}
			: { where: { settings_id: { is: inForceSettings(scopedSettingsCode, todayKey()) } } }
	);
	const text = (value: unknown) => (Predicate.isString(value) ? value : null);
</script>

<RecordShell
	of="employment_statutory_facts"
	{...record == null ? {} : { id: record.id }}
	mode={view.mode}
>
	<Form
		of="employment_statutory_facts"
		mode={view.mode}
		{record}
		{values}
		submit={record ? t('component.save_registration') : t('component.record_registration')}
	>
		{#snippet children(form)}
			<Stack gap="lg">
				<FormSection
					name="fact_section_scheme"
					first
					title={t('component.fact_section_scheme')}
					hint={t('component.fact_section_scheme_hint')}
				>
					<Grid gap="sm" minimum="compact">
						{#if record == null && scopedEmployeeId == null}
							<Field name="employee_id" label={t('component.person')}>
								{#snippet editor(field)}
									<Picker
										of="employees"
										label={['name']}
										orderBy={{ name: 'asc' }}
										value={text(field.value)}
										onChange={field.onChange}
										disabled={field.disabled}
									/>
								{/snippet}
							</Field>
						{/if}
						{#if scopedEmploymentId == null}
							<Field name="employment_id" label={t('component.fact_employment')}>
								{#snippet editor(field)}
									{@const employee = text(form.get('employee_id')) ?? record?.employee_id}
									<Picker
										of="employments"
										label={['employee_number']}
										where={{
											...(scopedCompanyId ? { company_id: { eq: scopedCompanyId } } : {}),
											...(employee == null
												? {}
												: { employee_id: { eq: employee as Id<'employees'> } })
										}}
										orderBy={{ employee_number: 'asc' }}
										value={text(field.value)}
										onChange={field.onChange}
										disabled={field.disabled}
									/>
								{/snippet}
							</Field>
							<Column span="all">
								<p class="text-xs text-muted-foreground">{t('component.fact_employment_hint')}</p>
							</Column>
						{/if}
						<Field name="statutory_contribution_id" label={t('component.statutory_scheme')}>
							{#snippet editor(field)}
								<Picker
									of="statutory_contributions"
									label={['code', 'name']}
									{...inForceSchemes}
									orderBy={{ code: 'asc' }}
									value={text(field.value)}
									onChange={field.onChange}
									disabled={field.disabled}
								/>
							{/snippet}
						</Field>
					</Grid>
				</FormSection>

				<FormSection
					name="registration"
					title={t('component.registration')}
					hint={t('component.fact_section_registration_hint')}
				>
					<Field name="status" label={t('component.status')}>
						{#snippet editor(field)}
							<StatutoryFactStatusRenderer
								view={{
									mode: 'edit',
									name: field.name,
									value: field.value as never,
									disabled: field.disabled,
									onChange: field.onChange as never
								}}
								schemeId={(text(form.get('statutory_contribution_id')) ??
									record?.statutory_contribution_id ??
									null) as Id<'statutory_contributions'> | null}
							/>
						{/snippet}
					</Field>
				</FormSection>

				<FormSection
					name="section_period"
					title={t('component.section_period')}
					hint={t('component.section_period_hint')}
				>
					<Field name="effective_range" label={t('component.effective_period')} />
				</FormSection>
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
