<script lang="ts">
	/** One disbursement hold: placed with its directive, released with the directive and amount that close it. */
	import EmploymentField from '../../../lib/ui/EmploymentField.svelte';
	import { t } from '../../../lib/ui/t.js';
	import { Field, Form } from '@norbital-ai/ui';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import FormSection from '../../../lib/ui/form-section.svelte';

	let { view }: { view: RecordView<'payment_holds'> } = $props();
	const scope = hrCreateScope();
	const scopedEmploymentId = $derived(scope?.employmentId?.());
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(createValues(view, { employment_id: scopedEmploymentId }));
</script>

<RecordShell of="payment_holds" {...record == null ? {} : { id: record.id }} mode={view.mode}>
	<Form
		of="payment_holds"
		mode={view.mode}
		{...record == null ? {} : { id: record.id }}
		{record}
		{values}
		submit={record ? t('component.save_payment_hold') : t('component.record_payment_hold')}
		onOutcome={openCreated(view)}
	>
		<FormSection
			name="payment_hold"
			first
			title={t('component.payment_hold')}
			hint={t('component.payment_hold_hint')}
		>
			<Grid gap="sm" minimum="compact">
				{#if scopedEmploymentId == null}
					<EmploymentField label={t('component.person')} companyId={scope?.companyId?.()} />
				{/if}
				<Field name="category" label={t('component.hold_category')} />
				<Column span="all">
					<Field name="directive_reference" label={t('component.directive_reference')} />
				</Column>
				<Field name="amount" label={t('component.hold_amount')} />
				<Field name="held_on" label={t('component.hold_placed_on')} />
				<Field name="released_on" label={t('component.hold_released_on')} />
				<Field name="released_amount" label={t('component.released_amount')} />
				<Column span="all">
					<Field name="reconciliation_reference" label={t('component.reconciliation_reference')} />
				</Column>
				<Column span="all">
					<Field name="evidence_file" label={t('component.evidence_file')} />
				</Column>
			</Grid>
		</FormSection>
	</Form>
</RecordShell>
