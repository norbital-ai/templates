<script lang="ts">
	import { bolt } from '$bolt';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'workers'>;
	} = $props();
	const t = bolt.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

<RecordForm {view} subtitle={['worker_number', 'trade', 'status']}>
	<Section icon="lucide:hard-hat" first name="worker" title={t('section.worker')}>
		<Grid minimum="compact">
			<Field name="worker_name" />
			<Field name="worker_number" />
			<Field name="trade" />
			<Field name="status" />
		</Grid>
	</Section>
	<Section icon="lucide:shield-check" name="compliance" title={t('section.compliance')}>
		<Grid minimum="compact">
			<Field name="work_permit_expiry" />
			<Field name="medical_check_date" />
			<Field name="safety_induction_date" />
		</Grid>
	</Section>
	<Section
		icon="lucide:contact"
		name="contact"
		title={t('section.contact')}
		defaultOpen={false}
		summary={record?.['phone'] || record?.['email'] || t('component.not_set')}
	>
		<Grid minimum="compact">
			<Field name="phone" />
			<Field name="email" />
			<Field name="emergency_contact" />
		</Grid>
	</Section>
	<Section
		icon="lucide:user-round"
		name="personal"
		title={t('section.personal')}
		defaultOpen={false}
		summary={record?.['nationality'] || t('component.not_set')}
	>
		<Grid minimum="compact">
			<Field name="date_of_birth" />
			<Field name="nationality" />
		</Grid>
	</Section>
</RecordForm>
