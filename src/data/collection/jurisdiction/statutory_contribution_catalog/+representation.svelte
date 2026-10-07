<script lang="ts">
	/**
	 * One statutory contribution class: its identity, its authority text and its configuration as
	 * assessment, assessable parts, person facts, guards, ordered rules and limitation instead of one stacked list.
	 */
	import { bolt } from '$bolt';
	import {
		Field,
		Form,
		Input,
		openRecord,
		RecordShell,
		SchemaEditor,
		Section,
		type Json,
		type RecordView
	} from '@norbital-ai/ui';
	import type { ComponentProps } from 'svelte';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { asObject, textOf } from '../../../../lib/ui/records/json_object.js';

	let { view }: { view: RecordView<'statutory_contribution_catalog'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;

	const RULES_KIND = {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				when: { kind: 'text', optional: true },
				employee: { kind: 'text', optional: true },
				employer: { kind: 'text', optional: true },
				contribution: { kind: 'text', optional: true }
			}
		}
	} as const satisfies ComponentProps<typeof SchemaEditor>['kind'];
	const REFUSE_KIND = {
		kind: 'list',
		of: { kind: 'object', fields: { when: { kind: 'text' }, message: { kind: 'text' } } }
	} as const satisfies ComponentProps<typeof SchemaEditor>['kind'];
	const EXPRESSIONS_KIND = {
		kind: 'record',
		of: { kind: 'text' }
	} as const satisfies ComponentProps<typeof SchemaEditor>['kind'];
</script>

<RecordShell
	of="statutory_contribution_catalog"
	mode={view.mode}
	{...record == null
		? { values: view.mode === 'create' ? view.values : {} }
		: { id: record.id, subtitle: ['name'] }}
>
	{#key record?.revision}
		<Form
			of="statutory_contribution_catalog"
			mode={view.mode}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find(
					(row) => row.collection === 'statutory_contribution_catalog'
				);
				if (created) openRecord('statutory_contribution_catalog', created.id);
			}}
		>
			{#snippet children()}
				<Section first name="identity" title={t('section.identity')}>
					<Grid minimum="card">
						<Field name="code" />
						<Field name="name" />
					</Grid>
				</Section>
				<Section name="authority" title={t('section.authority')}>
					<Field name="authority" />
				</Section>
				<Section name="configuration" title={t('section.configuration')}>
					<Field name="configuration">
						{#snippet editor(field)}
							{@const cfg = asObject(field.value) ?? {}}
							{@const set = (patch: Record<string, Json>) => field.onChange({ ...cfg, ...patch })}
							<Grid minimum="card">
								<Stack gap="xs">
									<span class="text-xs font-medium text-muted-foreground"
										>{t('statutory.configuration.assessment')}</span
									>
									<Input
										aria-label={t('statutory.configuration.assessment')}
										value={textOf(cfg, 'assessment')}
										disabled={field.disabled}
										onchange={(event) => set({ assessment: event.currentTarget.value })}
									/>
								</Stack>
								<Stack gap="xs">
									<span class="text-xs font-medium text-muted-foreground"
										>{t('statutory.configuration.limitation')}</span
									>
									<Input
										aria-label={t('statutory.configuration.limitation')}
										value={textOf(cfg, 'limitation')}
										disabled={field.disabled}
										onchange={(event) => set({ limitation: event.currentTarget.value })}
									/>
								</Stack>
							</Grid>
							<span class="text-xs font-medium text-muted-foreground"
								>{t('statutory.configuration.assessable')}</span
							>
							<SchemaEditor
								kind={EXPRESSIONS_KIND}
								value={asObject(cfg['assessable']) ?? {}}
								onChange={(assessable) => set({ assessable })}
								disabled={field.disabled}
							/>
							<span class="text-xs font-medium text-muted-foreground"
								>{t('statutory.configuration.person')}</span
							>
							<SchemaEditor
								kind={EXPRESSIONS_KIND}
								value={asObject(cfg['person']) ?? {}}
								onChange={(person) => set({ person })}
								disabled={field.disabled}
							/>
							<span class="text-xs font-medium text-muted-foreground"
								>{t('statutory.configuration.refuse_when')}</span
							>
							<SchemaEditor
								kind={REFUSE_KIND}
								value={Array.isArray(cfg['refuse_when']) ? cfg['refuse_when'] : []}
								onChange={(refuse_when) => set({ refuse_when })}
								disabled={field.disabled}
							/>
							<SchemaEditor
								kind={RULES_KIND}
								value={Array.isArray(cfg['rules']) ? cfg['rules'] : []}
								onChange={(rules) => set({ rules })}
								disabled={field.disabled}
							/>
						{/snippet}
					</Field>
				</Section>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
