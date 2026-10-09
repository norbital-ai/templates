<script lang="ts">
	/**
	 * One statutory contribution class: its identity, its authority text and its configuration as
	 * assessment, assessable parts, person facts, guards, ordered rules and limitation instead of one stacked list.
	 */
	import { bolt } from '$bolt';
	import {
		Editor,
		Field,
		Form,
		openRecord,
		RecordShell,
		Section,
		Textarea,
		type Json,
		type Kind,
		type RecordView
	} from '@norbital-ai/ui';
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
				when: { kind: 'text', format: 'cel', optional: true },
				employee: { kind: 'text', format: 'cel', optional: true },
				employer: { kind: 'text', format: 'cel', optional: true },
				contribution: { kind: 'text', format: 'cel', optional: true }
			}
		}
	} as const satisfies Kind;
	const REFUSE_KIND = {
		kind: 'list',
		of: {
			kind: 'object',
			fields: { when: { kind: 'text', format: 'cel' }, message: { kind: 'text' } }
		}
	} as const satisfies Kind;
	const EXPRESSIONS_KIND = {
		kind: 'record',
		of: { kind: 'text', format: 'cel' }
	} as const satisfies Kind;
	const ASSESSMENT_KIND = { kind: 'text', format: 'cel', optional: true } as const satisfies Kind;
</script>

<RecordShell
	of="statutory_contribution_catalog"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
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
							<Stack gap="md">
								<Stack gap="xs">
									<span class="text-xs font-medium text-muted-foreground"
										>{t('statutory.configuration.assessment')}</span
									>
									<Editor
										kind={ASSESSMENT_KIND}
										name="configuration.assessment"
										value={textOf(cfg, 'assessment')}
										disabled={field.disabled}
										onChange={(assessment) => set({ assessment })}
									/>
								</Stack>
								<Stack gap="xs">
									<span class="text-xs font-medium text-muted-foreground"
										>{t('statutory.configuration.limitation')}</span
									>
									<Textarea
										aria-label={t('statutory.configuration.limitation')}
										rows={2}
										value={textOf(cfg, 'limitation')}
										disabled={field.disabled}
										onchange={(event) => set({ limitation: event.currentTarget.value })}
									/>
								</Stack>
								{#each [['assessable', 'statutory.configuration.assessable', EXPRESSIONS_KIND], ['person', 'statutory.configuration.person', EXPRESSIONS_KIND], ['refuse_when', 'statutory.configuration.refuse_when', REFUSE_KIND], ['rules', 'statutory.configuration.rules', RULES_KIND]] as const as [key, label, kind] (key)}
									<Stack gap="xs">
										<span class="text-xs font-medium text-muted-foreground">{t(label)}</span>
										<Editor
											{kind}
											name="configuration.{key}"
											value={cfg[key] ?? (kind.kind === 'list' ? [] : {})}
											onChange={(next) => set({ [key]: next })}
											disabled={field.disabled}
										/>
									</Stack>
								{/each}
							</Stack>
						{/snippet}
					</Field>
				</Section>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
