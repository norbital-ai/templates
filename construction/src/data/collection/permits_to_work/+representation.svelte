<script lang="ts">
	import { bolt } from '$bolt';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'permits_to_work'> } = $props();
	const t = bolt.t;
</script>

<RecordForm {view} subtitle={['permit_type', 'status']}>
	<Section first name="permit" title={t('section.permit')}>
		<Grid minimum="compact">
			<Field name="permit_number" />
			<Field name="permit_type" />
			<RefField name="project_id" ref="project" />
			<RefField name="site_location_id" ref="site" />
			<RefField name="job_id" ref="job" />
			<RefField name="worker_id" ref="worker" />
			<Field name="status" />
		</Grid>
	</Section>
	<Section name="validity" title={t('section.validity')}>
		<Grid minimum="compact">
			<Field name="requested_date" />
			<Field name="validity_range" />
			<Field name="approved_by" />
		</Grid>
	</Section>
</RecordForm>
