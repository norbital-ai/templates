<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'contacts'>; ctx: PageContext } = $props();
</script>

<RecordForm {ctx} {view} subtitle={['role', 'trade_specialty', 'status']}>
	<Section icon="lucide:contact-round" first name="contact" title={ctx.t('section.contact')}>
		<Grid minimum="card">
			<Field {ctx} name="full_name" />
			<Field {ctx} name="company_name" />
			<Field {ctx} name="role" />
			<Field {ctx} name="trade_specialty" />
			<Field {ctx} name="project_id" />
			<Field {ctx} name="status" />
			<Field {ctx} name="registration_no" />
			<Field {ctx} name="payment_terms_days" />
		</Grid>
	</Section>
	<Section icon="lucide:message-circle" name="channels" title={ctx.t('section.messaging_handles')}>
		<Grid minimum="card">
			<Field {ctx} name="phone" />
			<Field {ctx} name="email" />
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
