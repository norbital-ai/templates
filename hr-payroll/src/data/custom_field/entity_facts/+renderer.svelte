<script lang="ts">
	import { t } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';

	import { Button, Combobox, Input } from '@norbital-ai/ui';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { factScalar, type FactKey } from '../../../lib/datatypes/fact_keys.js';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { ValueOf } from '@norbital-ai/bolt';
	import type f from './+definition.ts';

	type Value = ValueOf<typeof f.spec.shape>;
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { inForceSettings } from '../../../lib/ui/settings-scope.js';
	import { todayKey } from '../../../lib/ui/calendar.js';
	import { settingsInForce } from '../../../lib/jurisdiction_settings.js';

	let {
		view,
		...props
	}: { view: CustomFieldView<Value> } & {
		declarations?: readonly FactKey[];
		settingsCode?: string;
	} = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const versions = liveRows<
		Parameters<typeof settingsInForce>[0][number] & { facts: readonly FactKey[] }
	>(() =>
		props.settingsCode
			? bolt.read('jurisdiction_settings', {
					where: inForceSettings(props.settingsCode, todayKey()),
					select: {
						id: true,
						code: true,
						sealed_at: true,
						voided_at: true,
						effective_range: true,
						facts: true
					},
					all: true
				})
			: null
	);
	const fields = $derived(
		props.declarations ??
			settingsInForce(versions.current ?? [], props.settingsCode ?? '', todayKey())?.facts ??
			[]
	);
	const current = $derived(view.value ?? {});
	const unused = $derived(
		Object.keys(current).filter((key) => !fields.some((field) => field.key === key))
	);

	function edit(key: string, value: Value[string] | undefined): void {
		if (view.mode !== 'edit') return;
		const next = { ...current };
		if (value === undefined) delete next[key];
		else next[key] = value;
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
				<Stack gap="xs">
					<label class="text-sm"
						><Stack gap="xs">
							{field.label || field.key.replaceAll('_', ' ')}
							{#if field.options != null}
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
							{:else}
								<Input
									{disabled}
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
					{#if field.required}<p class="text-xs text-muted-foreground">
							{t('entity_facts.required')}
						</p>{/if}
					{#if field.required_when}<p class="text-xs text-muted-foreground">
							{t('entity_facts.required_when')}
						</p>{/if}
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
