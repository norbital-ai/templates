<script lang="ts">
	import { bolt } from '$bolt';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	let { view }: { view: RecordView<'workers'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordForm {view} subtitle={['worker_number', 'trade', 'status']}>
	<Section first name="worker" title={t('section.worker')}>
		<Grid minimum="compact">
			<Field name="worker_name" />
			<Field name="worker_number" />
			<Field name="trade" />
			<Field name="status" />
		</Grid>
	</Section>
	<Section name="compliance" title={t('section.compliance')}>
		<Grid minimum="compact">
			<Field name="work_permit_expiry" />
			<Field name="medical_check_date" />
			<Field name="safety_induction_date" />
		</Grid>
	</Section>
	<Section
		name="contact"
		title={t('section.contact')}
		defaultOpen={false}
		summary={record?.['phone'] || record?.['email'] || t('component.not_set')}
	>
		<Grid minimum="compact">
			<Field name="phone" />
			<Field name="email" />
		</Grid>
	</Section>
	<Section
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
