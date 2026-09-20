<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import type { FactKey } from '../fact_keys/+definition.js';
	import type { RendererProps, Value } from './$types.js';
	import { client } from '../../lib/workspace-client.js';
	import { inForceSettings } from '../../lib/ui/settings-scope.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { settingsInForce } from '../../lib/jurisdiction_settings.js';

	let props: RendererProps & { declarations?: readonly FactKey[]; settingsCode?: string } =
		$props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const versionQuery = $derived(
		props.settingsCode
			? client.db.jurisdiction_settings.findMany({
					where: inForceSettings(props.settingsCode, todayKey()),
					columns: {
						id: true,
						code: true,
						sealed_at: true,
						voided_at: true,
						effective_range: true,
						facts: true
					},
					limit: 100
				})
			: null
	);
	const fields = $derived(
		props.declarations ??
			settingsInForce(versionQuery?.current ?? [], props.settingsCode ?? '', todayKey())?.facts ??
			[]
	);
	const current = $derived(props.value ?? {});
	const unused = $derived(
		Object.keys(current).filter((key) => !fields.some((field) => field.key === key))
	);

	function edit(key: string, value: Value[string] | undefined): void {
		if (props.mode !== 'edit') return;
		const next = { ...current };
		if (value === undefined) delete next[key];
		else next[key] = value;
		props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
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
								<select
									class="h-9 rounded-md border border-input bg-background px-2 text-sm"
									{disabled}
									value={current[field.key] === undefined
										? ''
										: String(field.options.indexOf(current[field.key]!))}
									onchange={(event) =>
										edit(
											field.key,
											event.currentTarget.value === ''
												? undefined
												: field.options?.[Number(event.currentTarget.value)]
										)}
								>
									<option value="">{t('entity_facts.unrecorded')}</option>
									{#each field.options as option, index (index)}<option value={String(index)}
											>{String(option)}</option
										>{/each}
								</select>
							{:else if field.type === 'boolean'}
								<select
									class="h-9 rounded-md border border-input bg-background px-2 text-sm"
									{disabled}
									value={current[field.key] === undefined ? '' : String(current[field.key])}
									onchange={(event) =>
										edit(
											field.key,
											event.currentTarget.value === ''
												? undefined
												: event.currentTarget.value === 'true'
										)}
								>
									<option value="">{t('entity_facts.unrecorded')}</option>
									<option value="true">{t('entity_facts.yes')}</option>
									<option value="false">{t('entity_facts.no')}</option>
								</select>
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
				<div class="flex items-center justify-between gap-2 text-sm">
					<span>{key}: {String(current[key])}</span>
					<Button variant="ghost" size="sm" {disabled} onclick={() => edit(key, undefined)}
						>{t('entity_facts.remove')}</Button
					>
				</div>
			{/each}
		{/if}
	</Stack>
{/if}
