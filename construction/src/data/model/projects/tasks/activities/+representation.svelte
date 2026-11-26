<script lang="ts">
	/** One activity of a task, showing the fields its kind uses: an issue's type, severity and status, a meeting's attendees. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		RecordForm,
		type RecordView,
		Section,
		use_record_controller
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'activities'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const controller = use_record_controller();
	const kind = $derived(controller?.current?.get('kind') ?? record?.kind ?? 'comment');
	const fixedTask = $derived(
		record !== null || (view.mode === 'create' && view.values.task_id != null)
	);
	const icon = $derived(
		kind === 'issue'
			? 'lucide:triangle-alert'
			: kind === 'meeting'
				? 'lucide:users'
				: 'lucide:message-square'
	);
</script>

<RecordForm {ctx} {view} subtitle={['kind', 'author', 'occurred_at']}>
	<Section {icon} first name="activity" title={ctx.t('section.activity')}>
		<Grid minimum="card">
			{#if !fixedTask}
				<Field {ctx} name="task_id" />
			{/if}
			{#if view.mode === 'create' && view.values.kind == null}
				<Field {ctx} name="kind" />
			{/if}
			{#if kind !== 'comment'}
				<Column span="all"><Field {ctx} name="title" /></Column>
			{/if}
			{#if kind === 'issue'}
				<Field {ctx} name="issue_type" />
				<Field {ctx} name="severity" />
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="occurred_at" />
			{#if kind === 'meeting'}
				<Column span="all"><Field {ctx} name="attendees" /></Column>
			{/if}
			<Column span="all"><Field {ctx} name="body" /></Column>
			<Column span="all"><Field {ctx} name="attachments" /></Column>
			{#if record?.source_message_id != null}
				<Field {ctx} name="source_message_id" readonly />
			{/if}
		</Grid>
	</Section>
</RecordForm>
