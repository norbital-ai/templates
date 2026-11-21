<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'contacts'>; ctx: PageContext } = $props();
</script>

<RecordForm {ctx} {view} subtitle={['company_name', 'role', 'trade']}>
	<Section icon="lucide:contact-round" first name="contact" title={ctx.t('section.contact')}>
		<Grid minimum="compact">
			<Field {ctx} name="full_name" />
			<Field {ctx} name="company_name" />
			<Field {ctx} name="role" />
			<Field {ctx} name="trade" />
			<Field {ctx} name="project_id" />
		</Grid>
	</Section>
	<Section icon="lucide:message-circle" name="channels" title={ctx.t('section.messaging_handles')}>
		<Grid minimum="compact">
			<Field {ctx} name="phone" />
			<Field {ctx} name="telegram" />
			<Field {ctx} name="email" />
			<Field {ctx} name="slack" />
			<Field {ctx} name="discord" />
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
