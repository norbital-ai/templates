<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'workers'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

<RecordForm {view} subtitle={['worker_number', 'trade', 'status']}>
	<Section icon="lucide:hard-hat" first name="worker" title={ctx.t('section.worker')}>
		<Grid minimum="compact">
			<Field name="worker_name" />
			<Field name="worker_number" />
			<Field name="trade" />
			<Field name="status" />
		</Grid>
	</Section>
	<Section icon="lucide:shield-check" name="compliance" title={ctx.t('section.compliance')}>
		<Grid minimum="compact">
			<Field name="work_permit_expiry" />
			<Field name="medical_check_date" />
			<Field name="safety_induction_date" />
		</Grid>
	</Section>
	<Section
		icon="lucide:contact"
		name="contact"
		title={ctx.t('section.contact')}
		default_open={false}
		summary={record?.['phone'] || record?.['email'] || ctx.t('component.not_set')}
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
		title={ctx.t('section.personal')}
		default_open={false}
		summary={record?.['nationality'] || ctx.t('component.not_set')}
	>
		<Grid minimum="compact">
			<Field name="date_of_birth" />
			<Field name="nationality" />
		</Grid>
	</Section>
</RecordForm>
