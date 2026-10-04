<script lang="ts">
	/**
	 * A subject's declared facts, edited against one `FactKey[]`: a schema of the lineage's version in force on a day
	 * (a company's `facts`, terms' `terms_facts`, a day's `work_day_facts`, a payment's `payment_facts`, a settlement's
	 * `settlement_facts`, a worksite's `worksite_facts`, a person's `person_facts`), or `declarations` the caller holds
	 * (a leave row's `event_facts`, a history kind's `facts`). A `code` input picks from its table's rows in force on the
	 * day, under its parent's code (another input, or the subject's own column in `parents`). Each input shows the run's own verdict live (`factValuesFault`): missing, invalid,
	 * outside its table, conditionally required (`when`), or unevidenced on `subject`. Only the declared schemas are
	 * read: whole version rows run to megabytes.
	 */
	import { bolt } from '$bolt';
	import { t } from '../i18n/t.js';
	import { Button, Combobox, Input, type CustomFieldView } from '@norbital-ai/ui';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { factScalar, parentOf, type FactKey } from '../../payroll_engine/datatypes/fact-keys.js';
	import { factValuesFault } from '../declared-facts.js';
	import { referenceCodes } from '../expressions/functions/tables.js';
	import { todayKey } from '../format/calendar.js';
	import { codeRows, versionInForce } from './code-rows.svelte.js';
	import { liveRows } from '../state/live.svelte.js';

	type Schema =
		| 'facts'
		| 'terms_facts'
		| 'work_day_facts'
		| 'payment_facts'
		| 'settlement_facts'
		| 'worksite_facts'
		| 'person_facts';
	type Scalar = string | number | boolean;
	let {
		view,
		settingsCode,
		schema,
		declarations: given,
		day,
		subject,
		when,
		parents
	}: {
		view: CustomFieldView<{ readonly [key: string]: Scalar }>;
		settingsCode: string | null | undefined;
		/** The version's schema to edit against; ignored where `declarations` is given. */
		schema?: Schema;
		/** The caller's own declarations; code tables still come from the version in force. */
		declarations?: readonly FactKey[];
		/** The day whose version governs; today where the subject names none yet. */
		day?: string | null | undefined;
		/** The saved row the values sit on: its `fact_evidence` answers an evidence demand. */
		subject?: { readonly collection: string; readonly id: string } | null | undefined;
		/** The subject's site, for a live `required_when` / `valid_when` / `evidence.when`. */
		when?: ((expression: string) => boolean) | undefined;
		/** The subject record's own columns a `parent_fact` may name (a worksite's `region`). */
		parents?: Readonly<Record<string, unknown>> | undefined;
	} = $props();
	const on = $derived(String(day || todayKey()).slice(0, 10));
	const version = versionInForce<{ readonly [S in Schema]?: readonly FactKey[] }>(
		() => settingsCode,
		() => on,
		() => ({
			facts: true,
			terms_facts: true,
			work_day_facts: true,
			payment_facts: true,
			settlement_facts: true,
			worksite_facts: true,
			person_facts: true
		})
	);
	const fields = $derived(given ?? (schema == null ? [] : (version.current?.[schema] ?? [])));
	const tables = $derived([
		...new Set(
			fields.flatMap((field) => (field.type === 'code' && field.table ? [field.table] : []))
		)
	]);
	const rows = codeRows(
		() => version.current,
		() => tables,
		() => on
	);
	const codes = $derived(rows.current == null ? undefined : referenceCodes(rows.current, on));
	const evidence = liveRows<{ fact_key: string }>(() =>
		subject == null || subject.id === ''
			? null
			: bolt.read('fact_evidence', {
					where: { subject: { [subject.collection]: { in: [subject.id] } } } as never,
					select: { fact_key: true },
					all: true
				})
	);
	const evidenced = $derived(new Set((evidence.current ?? []).map((row) => row.fact_key)));
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const current = $derived(view.value ?? {});
	const unused = $derived(
		Object.keys(current).filter((key) => !fields.some((field) => field.key === key))
	);
	/** The run's verdict on one input; evidence is judged only where a saved subject can carry it. */
	const fault = (field: FactKey): string | null =>
		factValuesFault(
			[field],
			current,
			true,
			when,
			subject == null ? () => true : (key) => evidenced.has(key),
			codes,
			parents
		);
	const choices = (field: FactKey) =>
		rows.inForce
			.filter((row) => {
				const parent = parentOf(field, current, parents);
				return row.table === field.table && (parent === undefined || row.parent_code === parent);
			})
			.map((row) => ({
				value: row.code,
				label: row.label ? `${row.code} · ${row.label}` : row.code
			}));

	function edit(key: string, value: Scalar | undefined): void {
		if (view.mode !== 'edit') return;
		const next = { ...current };
		if (value === undefined) delete next[key];
		else next[key] = value;
		// a child code no longer under its parent is cleared with the parent's change
		for (const child of fields)
			if (child.parent_fact === key && next[child.key] !== undefined) delete next[child.key];
		view.onChange(next);
	}
</script>

{#if view.mode === 'show'}
	<span
		>{Object.entries(current)
			.map(
				([key, value]) =>
					`${fields.find((field) => field.key === key)?.label || key}: ${String(value)}`
			)
			.join(', ') || '—'}</span
	>
{:else}
	<Stack gap="sm">
		<Grid gap="sm" minimum="compact">
			{#each fields as field (field.key)}
				{@const verdict = fault(field)}
				<Stack gap="xs">
					<label class="text-sm"
						><Stack gap="xs">
							{field.label || field.key.replaceAll('_', ' ')}
							{#if field.type === 'code'}
								<Combobox
									clearable
									placeholder={t('entity_facts.unrecorded')}
									{disabled}
									options={choices(field)}
									value={current[field.key] === undefined ? null : String(current[field.key])}
									onChange={(next) => edit(field.key, next == null ? undefined : next)}
								/>
							{:else if field.options != null}
								<Combobox
									clearable
									placeholder={t('entity_facts.unrecorded')}
									{disabled}
									options={field.options.map((option, index) => ({
										value: String(index),
										label: String(option)
									}))}
									value={current[field.key] === undefined
										? null
										: String(field.options.indexOf(current[field.key]!))}
									onChange={(next) =>
										edit(
											field.key,
											next == null ? undefined : factScalar(field.options?.[Number(next)])
										)}
								/>
							{:else if field.type === 'boolean'}
								<Combobox
									clearable
									placeholder={t('entity_facts.unrecorded')}
									{disabled}
									options={[
										{ value: 'true', label: t('entity_facts.yes') },
										{ value: 'false', label: t('entity_facts.no') }
									]}
									value={current[field.key] === undefined ? null : String(current[field.key])}
									onChange={(next) => edit(field.key, next == null ? undefined : next === 'true')}
								/>
							{:else if field.type === 'number'}
								<Input
									type="number"
									min={field.minimum}
									max={field.maximum}
									step={field.integer ? 1 : 'any'}
									{disabled}
									value={current[field.key] === undefined ? '' : Number(current[field.key])}
									oninput={(event) =>
										edit(
											field.key,
											event.currentTarget.value === ''
												? undefined
												: Number(event.currentTarget.value)
										)}
								/>
							{:else if field.type === 'date'}
								<Input
									type="date"
									{disabled}
									value={String(current[field.key] ?? '')}
									oninput={(event) =>
										edit(
											field.key,
											event.currentTarget.value === '' ? undefined : event.currentTarget.value
										)}
								/>
							{:else}
								<Input
									{disabled}
									placeholder={field.type === 'instant' ? 'YYYY-MM-DDTHH:mm:ss.sssZ' : undefined}
									value={String(current[field.key] ?? '')}
									oninput={(event) =>
										edit(
											field.key,
											event.currentTarget.value === '' ? undefined : event.currentTarget.value
										)}
								/>
							{/if}
						</Stack></label
					>
					{#if field.description}<p class="text-xs text-muted-foreground">
							{field.description}
						</p>{/if}
					{#if verdict != null}<p class="text-xs text-destructive" role="status">{verdict}</p>
					{:else}
						{#if field.required}<p class="text-xs text-muted-foreground">
								{t('entity_facts.required')}
							</p>{/if}
						{#if field.required_when && when == null}<p class="text-xs text-muted-foreground">
								{t('entity_facts.required_when')}
							</p>{/if}
						{#if field.evidence != null && subject == null}<p class="text-xs text-muted-foreground">
								{t('entity_facts.evidence')}
							</p>{/if}
					{/if}
					{#if field.default_value !== undefined}<p class="text-xs text-muted-foreground">
							{t('entity_facts.default', { value: String(field.default_value) })}
						</p>{/if}
				</Stack>
			{/each}
		</Grid>
		{#if fields.length === 0}<p class="text-meta">{t('entity_facts.no_declarations')}</p>{/if}
		{#if unused.length > 0}
			<p class="text-meta">{t('entity_facts.other_values')}</p>
			{#each unused as key (key)}
				<Inline justify="between" gap="sm" class="text-sm">
					<span>{key}: {String(current[key])}</span>
					<Button variant="ghost" size="sm" {disabled} onclick={() => edit(key, undefined)}
						>{t('entity_facts.remove')}</Button
					>
				</Inline>
			{/each}
		{/if}
	</Stack>
{/if}
