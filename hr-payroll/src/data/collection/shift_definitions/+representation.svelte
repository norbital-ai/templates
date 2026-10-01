<script lang="ts">
	/** A roster code of one entity: a work window, a protected rest day or another planned off day. The scope names the entity, so the form does not ask; opened without a scope the field returns. */
	import { bolt } from '$bolt';
	import { Field, Form } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';

	let { view }: { view: RecordView<'shift_definitions'> } = $props();
	const scopedCompanyId = hrCreateScope()?.companyId();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(createValues(view, { company_id: scopedCompanyId }));
</script>

<RecordShell of="shift_definitions" mode={view.mode} {...record == null ? {} : { id: record.id }}>
	<Form of="shift_definitions" mode={view.mode} {record} {values}>
		<FormSection
			name="shift"
			first
			title={bolt.t('component.shift')}
			hint={bolt.t('component.shift_section_hint')}
		>
			<Field name="variant" />
			<Grid gap="sm" minimum="compact">
				{#if scopedCompanyId == null}
					<Field name="company_id" label={bolt.t('component.company')} />
				{/if}
				<Field name="code" />
				<Field name="name" />
				<Field
					name="effective_range"
					label={bolt.t('component.effective_period')}
					help={bolt.t('component.section_period_hint')}
				/>
			</Grid>
		</FormSection>
	</Form>
</RecordShell>
