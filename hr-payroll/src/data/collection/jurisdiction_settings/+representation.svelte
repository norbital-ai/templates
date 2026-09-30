<script lang="ts">
	/**
	 * One jurisdiction settings version: its identity, the payroll scalars and declarations the engine reads, the work
	 * rules, obligations, change note and sources, edited as one unit while the version is a draft. A sealed version is
	 * law that has frozen: it is shown read-only (the transform refuses any edit but a void), marked sealed or voided. Its
	 * schemes are their own tab and belong to it, as does the calculation order they compute in.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { setContext } from 'svelte';
	import { Field, Form } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell, Table, type RecordView } from '@norbital-ai/ui';
	import CalculationFlow from '../../../lib/ui/calculation-flow.svelte';
	import {
		createValues,
		HR_CREATE_SCOPE,
		type HrCreateScope
	} from '../../../lib/ui/create-scope.js';
	import FormSection from '../../../lib/ui/form-section.svelte';

	let { view }: { view: RecordView<'jurisdiction_settings'> } = $props();
	const record = $derived(
		view.mode === 'update' ? (view.record as typeof view.record & { id: string }) : null
	);
	const sealed = $derived(record?.sealed_at != null);
	const voided = $derived(record?.voided_at != null);
	/**
	 * Every row under this version belongs to it: the schemes table's form files a scheme into the version on screen,
	 * never another (the version picker is not offered).
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => undefined,
		settingsCode: () => record?.code,
		settingsId: () => record?.id
	});
</script>

{#snippet version()}
	<Form
		of="jurisdiction_settings"
		mode={view.mode}
		{...record == null ? { values: createValues(view) } : { id: record.id, record }}
		submit={record ? t('component.save_settings') : t('component.create_settings')}
	>
		<Stack gap="lg">
			<FormSection
				first
				title={t('component.settings_section_identity')}
				hint={t('component.settings_section_identity_hint')}
			>
				<Grid gap="sm" minimum="panel">
					<Field name="code" label={t('component.settings_lineage')} />
					<Field name="jurisdiction_code" label={t('holiday_calendar.jurisdiction')} />
					<Field name="name" />
					<Field
						name="effective_range"
						label={t('component.effective_period')}
						help={t('component.effective_period_hint')}
					/>
				</Grid>
			</FormSection>
			<FormSection title={t('component.payroll_rules')}>
				<Grid gap="sm" minimum="panel">
					<Field name="payroll" />
					<Field
						name="facts"
						label={t('component.entity_facts')}
						help={t('component.entity_facts_hint')}
					/>
					<Field
						name="exit_facts"
						label={t('component.exit_facts')}
						help={t('component.exit_facts_hint')}
					/>
					<Field
						name="terms_facts"
						label={t('component.terms_facts')}
						help={t('component.terms_facts_declaration_hint')}
					/>
					<Field
						name="work_day_facts"
						label={t('component.work_day_facts')}
						help={t('component.work_day_facts_declaration_hint')}
					/>
					<Field
						name="payment_facts"
						label={t('component.payment_facts')}
						help={t('component.payment_facts_declaration_hint')}
					/>
					<Field
						name="settlement_facts"
						label={t('component.settlement_facts')}
						help={t('component.settlement_facts_declaration_hint')}
					/>
				</Grid>
			</FormSection>
			<FormSection title={t('component.obligations')} hint={t('component.obligations_hint')}>
				<Field name="obligations" />
			</FormSection>
			<FormSection title={t('component.work_rules')} hint={t('component.work_rules_hint')}>
				<Field name="work_rules" label={t('component.work_rules')} />
			</FormSection>
			<Stack class="border-t pt-6">
				<Field name="change_summary" help={t('component.settings_section_changes_hint')} />
			</Stack>
			<Stack class="border-t pt-6">
				<Field
					name="sources"
					label={t('component.sources')}
					help={t('component.settings_section_sources_hint')}
				/>
			</Stack>
		</Stack>
	</Form>
{/snippet}

{#snippet flow()}
	{#if record}<CalculationFlow version={record} />{/if}
{/snippet}

{#snippet contributions()}
	{#if record}
		<Stack gap="sm">
			<p class="text-meta">{t('component.statutory_contributions_description')}</p>
			<Table
				of="statutory_contributions"
				key={`statutory_contributions-${record.id}`}
				toolbar={{ title: t('component.statutory_contributions') }}
				where={{ settings_id: { eq: record.id } }}
				orderBy={{ code: 'asc' }}
				columns={['code', 'name', 'authority', 'assessment_period']}
			/>
		</Stack>
	{/if}
{/snippet}

<RecordShell
	of="jurisdiction_settings"
	mode={view.mode}
	{...record == null ? {} : { id: record.id }}
	{...voided
		? {
				icon: 'lucide:circle-slash',
				badge: t('component.settings_voided_badge'),
				hint: t('component.settings_voided_note', { reason: String(record?.void_reason ?? '') })
			}
		: sealed
			? {
					icon: 'lucide:lock-keyhole',
					badge: t('component.settings_sealed_badge'),
					hint: t('component.settings_sealed_note')
				}
			: {}}
	tabs={record == null
		? []
		: [
				{
					name: 'calculation',
					title: t('component.calculation_flow'),
					icon: 'lucide:workflow',
					body: flow
				},
				{
					name: 'contributions',
					title: t('component.statutory_contributions'),
					icon: 'lucide:landmark',
					body: contributions
				}
			]}
>
	{#if sealed}
		<!-- Sealed law is read, not edited: the generated view shows every field of the stored version. -->
		<RecordShell of="jurisdiction_settings" id={record!.id} />
	{:else}
		{@render version()}
	{/if}
</RecordShell>
