<script lang="ts">
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	import { Grid } from '@norbital-ai/ui/layout';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { createValues } from '../../../lib/ui/create-scope.js';

	let { view }: { view: RecordView<'benefit_case_plans'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

{#if record == null}
	<RecordShell of="benefit_case_plans" mode="create">
		<Form
			of="benefit_case_plans"
			mode="create"
			values={createValues(view)}
			submit={bolt.t('component.benefit_plan_freeze')}
			onOutcome={openCreated(view)}
		>
			<FormSection
				first
				title={bolt.t('component.benefit_plan')}
				hint={bolt.t('component.benefit_plan_hint')}
			>
				<Grid gap="sm" minimum="compact">
					<Field name="benefit_case_id" />
					<Field name="basis_method" />
					<Field name="monthly_full_pay_basis" />
					<Field name="qualifying_allowances_assessed" />
					<Field name="basis_reference" />
					<Field name="basis_file" />
				</Grid>
			</FormSection>
		</Form>
	</RecordShell>
{:else}
	<!-- a frozen candidate, read as stored -->
	<RecordShell
		of="benefit_case_plans"
		id={record.id}
		hint={bolt.t('component.benefit_plan_note')}
	/>
{/if}
