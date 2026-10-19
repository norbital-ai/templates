<script lang="ts">
	import { bolt } from '$bolt';
	import { isMasked } from '@norbital-ai/bolt';
	import { Editor, Section, useBolt, useForm, type Json } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { STATUTORY_FIELDS } from '../../payroll_engine/statutory_fields.js';
	import { asObject } from '../records/json_object.js';
	import { entitlementHasError, entitlementWindowFields, setEntitlement } from './entitlement.js';

	let {
		value,
		onChange,
		id,
		disabled = false
	}: {
		value: unknown;
		onChange: (next: Json) => void;
		id: string;
		disabled?: boolean;
	} = $props();
	const t = bolt.t;
	const form = useForm();
	const uiBolt = useBolt();
	const errors = $derived(
		new Map([...(form?.errors ?? [])].map(([path, message]) => [path, uiBolt.t(message)]))
	);
	const fields = STATUTORY_FIELDS.leave_catalog.entitlement.shape.fields;
	type Name = keyof typeof fields;
	const labels = {
		days: 'entitlement.days',
		window: 'entitlement.window',
		window_months: 'entitlement.window_months',
		service_year_offset_months: 'entitlement.service_year_offset_months',
		window_key: 'entitlement.window_key',
		carry_forward: 'entitlement.carry_forward',
		carry_depth: 'entitlement.carry_depth',
		consumes_after_days: 'entitlement.consumes_after_days',
		hours_per_day: 'entitlement.hours_per_day',
		bands: 'entitlement.bands',
		unit: 'entitlement.unit'
	} as const satisfies Record<Name, string>;
	const entitlement = $derived(asObject(value) ?? {});
	const windowFields = $derived(entitlementWindowFields(entitlement['window'], errors));
	const carries = $derived(
		entitlement['window'] === 'CALENDAR_YEAR' ||
			entitlement['window'] === 'SERVICE_YEAR' ||
			entitlement['carry_forward'] != null ||
			entitlement['carry_depth'] != null ||
			entitlementHasError(errors, ['carry_forward', 'carry_depth'])
	);
</script>

{#snippet input(name: Name)}
	<Stack gap="xs">
		<label for="{id}-{name}" class="text-xs font-medium text-muted-foreground"
			>{t(labels[name])}</label
		>
		<Editor
			kind={fields[name]}
			name="entitlement.{name}"
			id="{id}-{name}"
			value={entitlement[name] ?? null}
			onChange={(next) => onChange(setEntitlement(value, name, next))}
			{disabled}
			{errors}
		/>
		{#if errors.get(`entitlement.${name}`)}
			<p class="text-xs text-destructive" role="alert">{errors.get(`entitlement.${name}`)}</p>
		{/if}
	</Stack>
{/snippet}

{#if isMasked(value)}
	<p class="text-meta">{t('component.error')}</p>
{:else}
	<Stack gap="md">
		{@render input('days')}
		<p class="text-meta">{t('entitlement.days_help')}</p>
		<Grid minimum="compact">
			{@render input('window')}
			{#each windowFields as name (name)}
				{@render input(name)}
			{/each}
		</Grid>
		<Section
			first
			name="entitlement-bands"
			title={t('entitlement.bands')}
			defaultOpen={false}
			collapsible={!entitlementHasError(errors, ['bands'])}
		>
			{@render input('bands')}
		</Section>
		{#if carries}
			<Section
				first
				name="entitlement-carry"
				title={t('entitlement.carry_forward')}
				defaultOpen={false}
				collapsible={!entitlementHasError(errors, ['carry_forward', 'carry_depth'])}
			>
				<Stack gap="md">
					{@render input('carry_forward')}
					{@render input('carry_depth')}
				</Stack>
			</Section>
		{/if}
		<Section
			first
			name="entitlement-pool"
			title={t('entitlement.pool')}
			defaultOpen={false}
			collapsible={!entitlementHasError(errors, ['consumes_after_days', 'hours_per_day', 'unit'])}
		>
			<Stack gap="md">
				{@render input('consumes_after_days')}
				{@render input('hours_per_day')}
				{@render input('unit')}
			</Stack>
		</Section>
	</Stack>
{/if}
