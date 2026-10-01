<script lang="ts">
	import { bolt } from '$bolt';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'job_assignments'> } = $props();
	const t = bolt.t;
</script>

<RecordForm {view} subtitle={['role', 'status']}>
	<Section first name="assignment" title={t('section.assignment')}>
		<Grid minimum="compact">
			<Field name="assignment_code" />
			<Field name="status" />
			<RefField name="job_id" ref="job" />
			<RefField name="worker_id" ref="worker" />
			<RefField name="site_location_id" ref="site" />
			<Field name="role" />
		</Grid>
	</Section>
	<Section name="schedule" title={t('section.schedule')}>
		<Grid minimum="compact">
			<Field name="assignment_range" />
			<Field name="hours_per_day" />
		</Grid>
	</Section>
</RecordForm>
