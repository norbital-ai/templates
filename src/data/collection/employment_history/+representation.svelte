<script lang="ts">
	/**
	 * One period of a person's prior history: its kind is a `history_kinds` code of the person's
	 * lineage (their first contract's), its facts that kind's declared facts. The write checks both.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import * as Predicate from 'effect/Predicate';
	import CodeSelect from '../../../lib/ui/code-select.svelte';
	import DeclaredFactsField from '../../../lib/ui/declared-facts-field.svelte';
	import { versionInForce } from '../../../lib/ui/code-rows.svelte.js';
	import { createValues } from '../../../lib/ui/create-scope.js';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { todayKey } from '../../../lib/ui/calendar.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import type { HistoryKind } from '../../../lib/person-facts.js';

	let { view }: { view: RecordView<'employment_history'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(createValues(view));
	const text = (value: unknown) => (Predicate.isString(value) && value !== '' ? value : null);
	const personId = $derived(text(record?.employee_id ?? values.employee_id));
	const companies = liveRows<{ id: string; settings_code: string }>(() =>
		personId == null
			? null
			: bolt.read('companies', {
					where: { employments: { some: { employee_id: { eq: personId } } } } as never,
					select: { settings_code: true },
					all: true
				})
	);
	const version = versionInForce<{ readonly history_kinds?: readonly HistoryKind[] | null }>(
		() => companies.current?.[0]?.settings_code,
		() => todayKey(),
		() => ({ history_kinds: true })
	);
	const kinds = $derived(version.current?.history_kinds ?? []);
</script>

<RecordShell of="employment_history" mode={view.mode} {...record == null ? {} : { id: record.id }}>
	<Form of="employment_history" mode={view.mode} {record} {values}>
		{#snippet children(form)}
			{@const kind = text(form.get('kind') ?? record?.kind)}
			<FormSection name="employment_history" first title={t('component.employment_history')}>
				<Grid gap="sm" minimum="compact">
					{#if record == null}
						<Field name="employee_id" label={t('component.person')} />
						<Field name="kind" label={t('component.history_kind')}>
							{#snippet editor(field)}
								<CodeSelect
									codes={kinds.map((row) => row.code)}
									value={text(field.value)}
									disabled={field.disabled}
									onChange={(next) => field.onChange(next as never)}
								/>
							{/snippet}
						</Field>
					{/if}
					<Column span="all">
						<Field name="effective_range" label={t('component.effective_period')} />
					</Column>
					<Column span="all">
						<Field name="facts" label={t('component.history_facts')}>
							{#snippet editor(field)}
								<DeclaredFactsField
									view={{
										mode: 'edit',
										name: field.name,
										value: field.value as never,
										disabled: field.disabled,
										onChange: field.onChange as never
									}}
									settingsCode={companies.current?.[0]?.settings_code}
									declarations={kinds.find((row) => row.code === kind)?.facts ?? []}
								/>
							{/snippet}
						</Field>
					</Column>
				</Grid>
			</FormSection>
		{/snippet}
	</Form>
</RecordShell>
