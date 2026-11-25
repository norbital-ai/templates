<script lang="ts">
	import {
		Field,
		open_record,
		RecordForm,
		Section,
		type InsertOf,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { createValues } from '../../../../lib/ui/create-values.js';
	let { view, ctx }: { view: RecordView<'order_files'>; ctx: PageContext } = $props();
	// a new file is opened from its order (`openCreate`)
	const preset = createValues<'order_files'>();
	const values: Partial<InsertOf<'order_files'>> = $derived(
		view.mode === 'create' ? { ...preset, ...view.values } : {}
	);
	let added = $state(0);
</script>

{#key added}
	<RecordForm
		{ctx}
		on_done={(o) => {
			if (view.mode !== 'create' || o.kind !== 'committed' || !o.records[0]) return;
			// a create its opener scopes stays open for the next one
			if (Object.keys(values).length > 0) added++;
			else open_record(view.model, o.records[0].id);
		}}
		view={view.mode === 'create' ? { ...view, values } : view}
		lock={ctx.t('component.readonly')}
	>
		<Section first name="file">
			<Grid gap="md" minimum="compact">
				<Field {ctx} name="title" />
				<Field {ctx} name="file" wide />
			</Grid>
		</Section>
	</RecordForm>{/key}
