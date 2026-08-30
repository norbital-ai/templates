<script lang="ts">
	/**
	 * The event of a component entry — which arm it is, and that arm's own payload.
	 *
	 * The kind selector re-emits a whole default arm on change, so switching from a claim to an
	 * arrears settlement can never leave arrears' periods carrying a claim's incurred date. The
	 * per-arm fields below are exactly the ones `componentEntryEventValueSchema` declares; nothing
	 * here decides whether the entry as a whole is valid — `componentEntryEventIssues` in
	 * `src/lib/component_entry_refusals.ts` is that rule, shared with the write hook.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import {
		calendarDayAsPickerInstant,
		calendarDayFromPickerInstant
	} from '../../lib/ui/calendar.js';
	import { componentEntryEventValueSchema } from './+definition.js';

	type Value = Schema.Schema.Type<typeof componentEntryEventValueSchema>;
	type EventKind = Value['kind'];
	type RendererProps =
		| { readonly mode: 'display'; readonly value: Value | null }
		| {
				readonly mode: 'edit';
				readonly value: Value | null;
				readonly disabled: boolean;
				onValueChange(value: Value | null): void;
		  };

	const { t } = useI18n<TenantI18nKeys>();
	const PICKER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const KIND_OPTIONS: { value: EventKind; label: string }[] = [
		{ value: 'CLAIM', label: t('component.event_claim') },
		{ value: 'ALLOWANCE', label: t('component.event_allowance') },
		{ value: 'BONUS', label: t('component.event_bonus') },
		{ value: 'ARREARS', label: t('component.event_arrears') },
		{ value: 'MANUAL_ADJUSTMENT', label: t('component.event_manual_adjustment') }
	];

	const OPERATION_OPTIONS = [
		{ value: 'CORRECTION' as const, label: t('component.operation_correction') },
		{ value: 'REVERSAL' as const, label: t('component.operation_reversal') }
	];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(componentEntryEventValueSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);

	const summary = $derived.by(() => {
		if (current === null) return '—';
		switch (current.kind) {
			case 'CLAIM':
				return `${t('component.event_claim')} · ${current.incurred_on}`;
			case 'ALLOWANCE':
				return t('component.event_allowance');
			case 'BONUS':
				return current.note == null || current.note === ''
					? t('component.event_bonus')
					: `${t('component.event_bonus')} · ${current.note}`;
			case 'ARREARS':
				return `${t('component.event_arrears')} · ${current.covers_periods.join(', ')}`;
			case 'MANUAL_ADJUSTMENT':
				return `${
					current.operation === 'REVERSAL'
						? t('component.operation_reversal')
						: t('component.operation_correction')
				} · ${current.reason}`;
		}
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function defaultFor(kind: EventKind): Value {
		switch (kind) {
			case 'CLAIM':
				return { kind: 'CLAIM', incurred_on: '', description: null };
			case 'ALLOWANCE':
				return { kind: 'ALLOWANCE' };
			case 'BONUS':
				return { kind: 'BONUS', note: null };
			case 'ARREARS':
				return { kind: 'ARREARS', covers_periods: [], reason: '' };
			case 'MANUAL_ADJUSTMENT':
				return { kind: 'MANUAL_ADJUSTMENT', operation: 'CORRECTION', reason: '' };
		}
	}

	// See statutory_fact_status/+renderer.svelte for why this stays inlined rather than shared.
	function selectKind(kind: EventKind | null): void {
		if (kind === null) {
			emit(null);
			return;
		}
		if (current !== null && current.kind === kind) return;
		emit(defaultFor(kind));
	}

	function emitIncurredOn(raw: string): void {
		if (current === null || current.kind !== 'CLAIM') return;
		const day = Result.getOrElse(
			Result.try(() => calendarDayFromPickerInstant(raw, PICKER_TIME_ZONE)),
			() => current.incurred_on
		);
		emit({ ...current, incurred_on: day });
	}

	function emitCoversPeriods(raw: string): void {
		if (current === null || current.kind !== 'ARREARS') return;
		emit({
			...current,
			covers_periods: raw
				.split(',')
				.map((period) => period.trim())
				.filter((period) => /^\d{4}-\d{2}$/.test(period))
		});
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{t('component.event_kind')}
				<Combobox
					options={KIND_OPTIONS}
					value={current?.kind ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('component.event_select_kind')}
					onValueChange={selectKind}
				/>
			</Stack>
		</label>
		{#if current?.kind === 'CLAIM'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('component.incurred_on')}
					<Input
						type="date"
						value={Result.getOrElse(
							Result.try(() => calendarDayAsPickerInstant(current.incurred_on, PICKER_TIME_ZONE)),
							() => ''
						)}
						{disabled}
						oninput={(event) => emitIncurredOn(event.currentTarget.value)}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('component.claim_description')}
					<Input
						value={current.description ?? ''}
						{disabled}
						oninput={(event) => emit({ ...current, description: event.currentTarget.value })}
					/>
				</Stack>
			</label>
		{:else if current?.kind === 'ALLOWANCE'}
			<p class="self-end text-sm text-muted-foreground">
				{t('component.event_allowance_hint')}
			</p>
		{:else if current?.kind === 'BONUS'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('component.bonus_note')}
					<Input
						value={current.note ?? ''}
						{disabled}
						oninput={(event) => emit({ ...current, note: event.currentTarget.value })}
					/>
				</Stack>
			</label>
		{:else if current?.kind === 'ARREARS'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('component.covers_periods')}
					<Input
						value={current.covers_periods.join(', ')}
						{disabled}
						placeholder="2026-01, 2026-02"
						oninput={(event) => emitCoversPeriods(event.currentTarget.value)}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('component.arrears_reason')}
					<Input
						value={current.reason}
						{disabled}
						oninput={(event) => emit({ ...current, reason: event.currentTarget.value })}
					/>
				</Stack>
			</label>
		{:else if current?.kind === 'MANUAL_ADJUSTMENT'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('component.adjustment_operation')}
					<Combobox
						options={OPERATION_OPTIONS}
						value={current.operation}
						{disabled}
						searchable={false}
						emptyPlaceholder={t('component.adjustment_operation')}
						onValueChange={(operation) => {
							if (operation !== 'CORRECTION' && operation !== 'REVERSAL') return;
							if (current.kind !== 'MANUAL_ADJUSTMENT') return;
							emit({ ...current, operation });
						}}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('component.adjustment_reason')}
					<Input
						value={current.reason}
						{disabled}
						oninput={(event) => emit({ ...current, reason: event.currentTarget.value })}
					/>
				</Stack>
			</label>
		{/if}
	</Grid>
{/if}
