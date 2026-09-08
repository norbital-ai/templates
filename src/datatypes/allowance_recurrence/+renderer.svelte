<script lang="ts">
	/**
	 * Whether a standing allowance is paid once or across a window, and when.
	 *
	 * The one payload that survived the split of `component_entry_event` into five collections, and
	 * the only control on the allowance form that is not an ordinary column. Everything the old
	 * five-armed picker drew for the other four families is now a real field on that family's own
	 * form; what is left here is the genuine two-armed fact this one family carries.
	 *
	 * Selecting an arm re-emits a whole default for it, so switching a window to a one-off can never
	 * leave a `from` beside a `period` — the same rule every variant renderer in this directory
	 * keeps, for the same reason. Nothing here decides whether the allowance as a whole is
	 * admissible: the catalogue rules live in `lib/pay_request_hooks.ts` and the form's component
	 * picker reads `allowance_catalogue`, which holds nothing an allowance may not name.
	 *
	 * The bounds are edited as plain calendar days and months, by `<input type="date">` and
	 * `<input type="month">`. That is deliberate and is not the platform day-picker adapter in
	 * `lib/ui/calendar.ts`: these are `YYYY-MM-DD` and `YYYY-MM` strings inside a JSON value, not
	 * `instant` columns, and a native picker edits exactly that text with no timezone in the loop.
	 * Its predecessor pushed the same strings through `calendarDayAsPickerInstant` and handed a
	 * native date input an ISO instant, which the input cannot parse and silently blanks.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { allowanceRecurrenceSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	type RecurrenceKind = Value['kind'];

	const KIND_OPTIONS: { value: RecurrenceKind; label: string; description: string }[] = [
		{
			value: 'ONE_OFF',
			label: t('component.entry_one_off'),
			description: t('component.entry_one_off_hint')
		},
		{
			value: 'RECURRING',
			label: t('component.entry_recurring'),
			description: t('component.entry_recurring_hint')
		}
	];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(allowanceRecurrenceSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);

	const summary = $derived.by(() => {
		if (current === null) return '—';
		if (current.kind === 'ONE_OFF') return `${t('component.entry_one_off')} · ${current.period}`;
		return `${t('component.entry_recurring')} · ${current.from} – ${current.to ?? '…'}`;
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	/**
	 * A one-off in the current month is the harmless default: it pays once, and the operator widens
	 * it to a window rather than discovering later that an unbounded range meant "for ever". The
	 * recurring arm opens today and stays open-ended, which is what a standing allowance is.
	 */
	function defaultFor(kind: RecurrenceKind): Value {
		const today = new Date().toISOString();
		switch (kind) {
			case 'ONE_OFF':
				return { kind: 'ONE_OFF', period: today.slice(0, 7) };
			case 'RECURRING':
				return { kind: 'RECURRING', from: today.slice(0, 10), to: null };
		}
	}

	// See statutory_fact_status/+renderer.svelte for why this stays inlined rather than shared.
	// repository-health:allow D1 -- closes over this file's current/emit/defaultFor; see the note there.
	function selectKind(kind: RecurrenceKind | null): void {
		if (kind === null) {
			emit(null);
			return;
		}
		if (current !== null && current.kind === kind) return;
		emit(defaultFor(kind));
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{t('component.entry_cadence')}
				<Combobox
					options={KIND_OPTIONS}
					value={current?.kind ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('renderer.allowance_recurrence.select_cadence')}
					onValueChange={selectKind}
				/>
			</Stack>
		</label>
		{#if current?.kind === 'ONE_OFF'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.allowance_recurrence.period')}
					<Input
						type="month"
						value={current.period}
						{disabled}
						oninput={(event) => emit({ ...current, period: event.currentTarget.value })}
					/>
				</Stack>
			</label>
		{:else if current?.kind === 'RECURRING'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.allowance_recurrence.from')}
					<Input
						type="date"
						value={current.from}
						{disabled}
						oninput={(event) => emit({ ...current, from: event.currentTarget.value })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.allowance_recurrence.to')}
					<!--
						Blank is the open-ended window rather than a missing answer, so an empty field
						emits `null` instead of an unparseable day. It is the ordinary state of a standing
						allowance and must survive a round trip through this control.
					-->
					<Input
						type="date"
						value={current.to ?? ''}
						{disabled}
						placeholder={t('renderer.allowance_recurrence.to_open_ended')}
						oninput={(event) =>
							emit({
								...current,
								to: event.currentTarget.value === '' ? null : event.currentTarget.value
							})}
					/>
				</Stack>
			</label>
		{/if}
	</Grid>
{/if}
