<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, RecordForm, type RecordView, Section } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'drivers'>; ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<RecordForm {ctx} {view} subtitle={['license_class', 'status']}>
	<Section icon="lucide:user-round" first name="driver" title={t('section.driver_profile')}>
		<Grid minimum="card">
			<Field {ctx} name="employee_code" />
			<Field {ctx} name="full_name" />
			<Field {ctx} name="status" />
			<Field {ctx} name="license_number" />
			<Field {ctx} name="license_class" />
			<Field {ctx} name="license_expiry" />
			<Field {ctx} name="phone" />
			<Field {ctx} name="email" />
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
