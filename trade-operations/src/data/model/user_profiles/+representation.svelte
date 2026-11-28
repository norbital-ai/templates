<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, RecordForm, Section, type RecordView } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';

	let {
		view,
		ctx
	}: {
		view: RecordView<'user_profiles'>;
		ctx: PageContext;
	} = $props();
</script>

<RecordForm {ctx} {view}>
	<Section first name="profile" icon="lucide:id-card" title={ctx.t('section.profile')}>
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="user_id" readonly={view.mode !== 'create'} />
			<Field {ctx} name="name" />
			<Field {ctx} name="phone" />
			<Field {ctx} name="notes" wide />
		</Grid>
	</Section>
	<Section name="kingdee_bindings" icon="lucide:link" title={ctx.t('section.kingdee_profile')}>
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="kingdee_employee_id" />
			<Field {ctx} name="kingdee_department_id" />
			<Field {ctx} name="kingdee_biller_id" />
			<Field {ctx} name="kingdee_customer_id" />
		</Grid>
	</Section>
</RecordForm>
