<script lang="ts">
	/**
	 * One dated change to a company: its date and only the values it changes. Here it is edited, moved to another date
	 * or deleted. The statutory parameters are those the company's law declares on the change's date.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		confirm_action,
		Field,
		Form,
		notify_outcome,
		RecordShell,
		toast,
		type FieldEditor,
		type RecordView
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import { COMPANY_FIELDS } from '../../../../lib/company.js';
	import { pageLaws } from '../../../../lib/ui/law.svelte.js';
	import VersionFacts from '../../../../lib/ui/person/version_facts.svelte';

	let { view, ctx }: { view: RecordView<'entity_change'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const today = ctx.clock('day').today;
	const entities = ctx.query({ entity: { fields: ['settings_code'], limit: 1000 } });
	const laws = pageLaws(ctx, () => [
		...new Set((entities.current?.entity.rows ?? []).map((row) => row.settings_code))
	]);
	/** The law a change answers to: its company's, in force on the change's date. */
	const formLaw = (values: FieldEditor['form']['values']) =>
		laws.on(
			(entities.current?.entity.rows ?? []).find((row) => row.id === values['entity_id'])
				?.settings_code,
			typeof values['effective_from'] === 'string' ? values['effective_from'] : today
		);
	let deleting = $state(false);
	function remove() {
		if (record === null || deleting) return;
		const target = { id: record.id, revision: record.revision };
		deleting = true;
		fork(
			Effect.gen(function* () {
				const proceed = yield* confirm_action({
					title: ctx.t('entity_change.delete_title'),
					body: ctx.t('entity_change.delete_body'),
					confirm_label: ctx.t('entity_change.delete'),
					destructive: true
				});
				if (!proceed) return;
				const outcome = yield* ctx.act({ 'entity_change.delete': [{ target }] });
				notify_outcome(ctx, outcome);
				if (outcome.kind === 'committed') history.back();
			}).pipe(
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : ctx.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (deleting = false)))
			)
		);
	}
</script>

{#snippet parameters(field: FieldEditor)}<VersionFacts
		{ctx}
		{field}
		law={formLaw(field.form.values)}
		subject="EMPLOYER"
	/>{/snippet}

{#snippet actions()}{#if record !== null}<Button
			variant="destructive"
			disabled={deleting}
			onclick={remove}>{ctx.t('entity_change.delete')}</Button
		>{/if}{/snippet}

<RecordShell
	{ctx}
	of="entity_change"
	mode={view.mode}
	footer_actions={actions}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="entity_change"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}<Stack gap="md"
				>{#each ['entity_id', 'effective_from', ...COMPANY_FIELDS, 'clears'] as name (name)}<Field
						{ctx}
						{name}
						{...name === 'statutory_parameters' ? { editor: parameters } : {}}
					/>{/each}</Stack
			>{/snippet}
	</Form>
</RecordShell>
