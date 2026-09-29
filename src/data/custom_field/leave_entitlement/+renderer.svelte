<script lang="ts">
	import Labelled from '../../../lib/ui/Labelled.svelte';
	import { t } from '../../../lib/ui/t.js';

	import type { CollectionField } from '../../../lib/ui/grid.svelte';
	import MatrixRenderer, { type MatrixColumn } from '../../../lib/ui/grid.svelte';
	import { Checkbox, Combobox } from '@norbital-ai/ui';
	import { Input } from '@norbital-ai/ui';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { numberFrom } from '../../../lib/ui/renderer-input.js';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { LeaveEntitlement as Value } from '../../../lib/datatypes/leave_entitlement.js';
	import type { LeaveEntitlement } from '../../../lib/datatypes/leave_entitlement.js';
	import { decodeNumber } from '../../../lib/wire.js';

	type Band = { readonly id: string; readonly eligibility: string; readonly days: number | string };

	let { view }: { view: CustomFieldView<Value> } = $props();
	/** Read top-down: the most specific tier first, the everyone row last. */
	const BAND_COLUMNS = [
		{
			key: 'eligibility',
			label: t('component.who_receives'),
			field: { name: 'eligibility', kind: 'text', nullable: false } satisfies CollectionField,
			placeholder: 'employment.service_months >= 24',
			width: 340
		},
		{
			key: 'days',
			label: t('component.days'),
			// A figure, or a number over the person (`12.0 + floor_unit(employment.service_months / 60.0)`).
			field: { name: 'days', kind: 'text', nullable: false } satisfies CollectionField,
			width: 220
		}
	] satisfies readonly MatrixColumn<Band>[];
	const disabled = $derived(view.mode !== 'edit' || view.disabled);
	const readonly = $derived(view.mode !== 'edit');
	const current = $derived<LeaveEntitlement>(
		view.value ?? {
			availability: 'UPFRONT',
			year_start_month: 1,
			proration: 'CALENDAR_MONTHS',
			bands: []
		}
	);
	const availabilityOptions = $derived(
		(['UPFRONT', 'MONTHLY', 'UNLIMITED', 'PER_EVENT', 'CREDITED'] as const).map((value) => ({
			value,
			label: t(`leave.availability.${value}`)
		}))
	);
	const yearAnchorOptions = $derived(
		(['CALENDAR', 'SERVICE_ANNIVERSARY'] as const).map((value) => ({
			value,
			label: t(`leave.year_anchor.${value}`)
		}))
	);
	const roundingOptions = $derived(
		(['HALF_DAY', 'WHOLE_DAY', 'WHOLE_DAY_DOWN', 'EXACT'] as const).map((value) => ({
			value,
			label: t(`leave.rounding.${value}`)
		}))
	);
	/** A blank count clears the field; anything else is the integer typed. */
	const countFrom = (text: string): number | null =>
		text.trim() === '' ? null : Math.max(1, Math.trunc(numberFrom(text, 1)));
	const prorationOptions = $derived(
		(['NONE', 'CALENDAR_MONTHS', 'COMPLETED_MONTHS', 'HALF_MONTHS', 'CALENDAR_DAYS'] as const).map(
			(value) => ({
				value,
				label: t(`leave.proration.${value}`)
			})
		)
	);
	const rows = $derived<Band[]>(
		current.bands.map((band, index) => ({ id: `band-${index}`, ...band }))
	);
	const childRows = $derived<Band[]>(
		(current.child_lifetime ?? []).map((cap, index) => ({ id: `child-${index}`, ...cap }))
	);
	/** A matrix edit as rows of predicate and days: a figure where the text is one, else the expression. */
	const bandsFrom = (next: readonly Band[]) =>
		next.map(({ eligibility, days }) => ({
			eligibility,
			days:
				String(days).trim() === ''
					? 0
					: Number.isFinite(decodeNumber(days))
						? decodeNumber(days)
						: String(days)
		}));
	function emit(next: LeaveEntitlement): void {
		if (view.mode === 'edit') view.onChange(next);
	}
</script>

<Stack gap="sm" class="w-full">
	<Grid gap="sm" minimum="compact">
		<Labelled label={t('leave.availability')} class="text-sm font-medium">
			<Combobox
				class="w-64 max-w-full"
				size="sm"
				options={availabilityOptions}
				value={current.availability}
				{disabled}
				onChange={(availability) => {
					if (availability) emit({ ...current, availability });
				}}
			/>
		</Labelled>
		<Labelled label={t('leave.year_anchor')} class="text-sm font-medium">
			<Combobox
				class="w-64 max-w-full"
				size="sm"
				options={yearAnchorOptions}
				value={current.year_anchor ?? 'CALENDAR'}
				{disabled}
				onChange={(year_anchor) => {
					if (year_anchor) emit({ ...current, year_anchor });
				}}
			/>
		</Labelled>
		{#if current.year_anchor !== 'SERVICE_ANNIVERSARY'}
			<Labelled label={t('leave.year_start_month')} class="text-sm font-medium">
				<Input
					type="number"
					min="1"
					max="12"
					step="1"
					value={current.year_start_month}
					{disabled}
					oninput={(event) =>
						emit({ ...current, year_start_month: numberFrom(event.currentTarget.value, 1) })}
				/>
			</Labelled>
		{/if}
		<Labelled label={t('leave.auto_carry_one_year')} class="text-sm font-medium">
			<Checkbox
				checked={current.auto_carry_one_year === true}
				{disabled}
				onCheckedChange={(auto_carry_one_year) =>
					emit({ ...current, auto_carry_one_year: auto_carry_one_year === true })}
			/>
		</Labelled>
		{#if current.availability !== 'UNLIMITED'}
			<Labelled label={t('leave.proration')} class="text-sm font-medium">
				<Combobox
					class="w-64 max-w-full"
					size="sm"
					options={prorationOptions}
					value={current.proration}
					{disabled}
					onChange={(proration) => {
						if (proration) emit({ ...current, proration });
					}}
				/>
			</Labelled>
			<Labelled label={t('leave.rounding')} class="text-sm font-medium">
				<Combobox
					class="w-64 max-w-full"
					size="sm"
					options={roundingOptions}
					value={current.rounding ?? 'HALF_DAY'}
					{disabled}
					onChange={(rounding) => {
						if (rounding) emit({ ...current, rounding });
					}}
				/>
			</Labelled>
			<Labelled label={t('leave.rolling_months')} class="text-sm font-medium">
				<Input
					type="number"
					min="1"
					step="1"
					value={current.rolling_months ?? ''}
					{disabled}
					oninput={(event) =>
						emit({ ...current, rolling_months: countFrom(event.currentTarget.value) })}
				/>
			</Labelled>
		{/if}
		<Labelled label={t('leave.lifetime_days')} class="text-sm font-medium">
			<Input
				value={current.lifetime_days == null ? '' : String(current.lifetime_days)}
				{disabled}
				oninput={(event) => {
					const text = event.currentTarget.value.trim();
					emit({
						...current,
						lifetime_days:
							text === ''
								? null
								: Number.isFinite(Number(text)) && Number(text) > 0
									? Number(text)
									: text
					});
				}}
			/>
		</Labelled>
		<Labelled label={t('leave.weekly_days')} class="text-sm font-medium">
			<Input
				type="number"
				min="0.5"
				step="0.5"
				value={current.weekly_days ?? ''}
				{disabled}
				oninput={(event) =>
					emit({
						...current,
						weekly_days:
							event.currentTarget.value.trim() === ''
								? null
								: Math.max(0.5, numberFrom(event.currentTarget.value, 0.5))
					})}
			/>
		</Labelled>
		<Labelled label={t('leave.minimum_days')} class="text-sm font-medium">
			<Input
				type="number"
				min="0"
				step="0.5"
				value={current.minimum_days ?? ''}
				{disabled}
				oninput={(event) =>
					emit({
						...current,
						minimum_days:
							event.currentTarget.value.trim() === ''
								? null
								: Math.max(0, Number(event.currentTarget.value) || 0)
					})}
			/>
		</Labelled>
		<label class="text-sm font-medium"
			><Inline as="span" gap="sm"
				><Checkbox
					checked={current.qualifies_window === true}
					{disabled}
					onCheckedChange={(checked) => emit({ ...current, qualifies_window: checked === true })}
				/>{t('leave.qualifies_window')}</Inline
			></label
		>
		<label class="text-sm font-medium"
			><Inline as="span" gap="sm"
				><Checkbox
					checked={current.child_years === true}
					{disabled}
					onCheckedChange={(checked) => emit({ ...current, child_years: checked === true })}
				/>{t('leave.child_years')}</Inline
			></label
		>
		<Labelled label={t('leave.consumes_after_days')} class="text-sm font-medium">
			<Input
				type="number"
				min="0"
				step="0.5"
				value={current.consumes_after_days ?? ''}
				{disabled}
				oninput={(event) =>
					emit({
						...current,
						consumes_after_days:
							event.currentTarget.value.trim() === ''
								? null
								: Math.max(0, Number(event.currentTarget.value) || 0)
					})}
			/>
		</Labelled>
		{#if current.availability === 'PER_EVENT'}
			<Labelled label={t('leave.lifetime_events')} class="text-sm font-medium">
				<Input
					type="number"
					min="1"
					step="1"
					value={current.lifetime_events ?? ''}
					{disabled}
					oninput={(event) =>
						emit({ ...current, lifetime_events: countFrom(event.currentTarget.value) })}
				/>
			</Labelled>
		{/if}
	</Grid>
	{#if current.availability !== 'UNLIMITED'}
		<p class="text-meta">{t('renderer.leave_entitlement.identity')}</p>
		<MatrixRenderer
			class="w-full"
			{rows}
			columns={BAND_COLUMNS}
			{disabled}
			{readonly}
			allowAddRows={!disabled}
			emptyMessage={t('renderer.leave_entitlement.empty')}
			addRowLabel={t('leave.add_band')}
			createRow={(): Band => ({ id: crypto.randomUUID(), eligibility: '', days: 0 })}
			bounded={false}
			onChange={(next) =>
				emit({
					...current,
					bands: bandsFrom(next)
				})}
		/>
		<p class="text-meta">{t('leave.child_lifetime')}</p>
		<MatrixRenderer
			class="w-full"
			rows={childRows}
			columns={BAND_COLUMNS}
			{disabled}
			{readonly}
			allowAddRows={!disabled}
			emptyMessage={t('renderer.leave_entitlement.empty')}
			addRowLabel={t('leave.add_band')}
			createRow={(): Band => ({ id: crypto.randomUUID(), eligibility: '', days: 0 })}
			bounded={false}
			onChange={(next) =>
				emit({ ...current, child_lifetime: next.length === 0 ? null : bandsFrom(next) })}
		/>
	{/if}
</Stack>
