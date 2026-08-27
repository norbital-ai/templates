<script lang="ts">
	/**
	 * The instalment schedule of a SCHEDULED obligation, as one editable matrix.
	 *
	 * ## What this renderer no longer shows, and why
	 *
	 * Its predecessor carried two further columns — "Consumed by" and "Consumed at" — driven by
	 * `payslip_lines.repayment_sequence`, a generated projection naming which instalment a payslip
	 * line had paid. That column does not exist any more: a `payslip_adjustments` row names the
	 * obligation, not an instalment of it, and what is still owed is the obligation's amount less
	 * everything paid runs took from it. So per-instalment consumption is no longer a fact anybody
	 * stores, and a column that could only be guessed at has been removed rather than approximated.
	 * The recovered-to-date total belongs to the obligation and is shown on its own screen.
	 *
	 * ## The array
	 *
	 * `instalments` is `custom('obligation_instalment', { multiple: true })`, so the column value is
	 * an array while the generated `Value` names one element — the runtime hands a custom renderer
	 * the whole column either way, and `field.array` is how it says so. The two casts below are that
	 * gap, and they are the only ones.
	 *
	 * `sequence` is not stored: an instalment's number is its position in this array, which is why
	 * the matrix's row order is the schedule's order and nothing else records it.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Stack } from '@norbital-ai/ui/layout';
	import {
		calendarDayAsPickerInstant,
		calendarDayFromPickerInstant,
		todayKey
	} from '../../lib/ui/calendar.js';
	import { monthlyDueDates } from '../../collections/obligations/lib/repayment-schedule.js';
	import { obligationInstalmentValueSchema, type ObligationInstalment } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type InstalmentRow = {
		readonly id: string;
		readonly due_date: string;
		readonly amount: number;
	};

	const { t } = useI18n<TenantI18nKeys>();
	const PICKER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const scheduleSchema = Schema.Array(obligationInstalmentValueSchema);

	const columns = $derived([
		{
			key: 'due_date',
			label: t('renderer.obligation_instalment.due_date'),
			field: {
				name: 'due_date',
				kind: 'instant',
				precision: 'day',
				nullable: false
			} satisfies CollectionField,
			width: 200
		},
		{
			key: 'amount',
			label: t('renderer.obligation_instalment.amount'),
			field: { name: 'amount', kind: 'numeric', nullable: false } satisfies CollectionField,
			width: 180
		}
	] satisfies readonly MatrixColumn<InstalmentRow>[]);

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);

	/** The stored column, which is the array. See the note at the head of this file. */
	const draft = $derived.by((): readonly unknown[] => {
		const stored: unknown = props.value;
		return Array.isArray(stored) ? stored : [];
	});
	const parsed = $derived(Schema.decodeUnknownResult(scheduleSchema)(draft));
	const total = $derived(
		Result.isSuccess(parsed) ? parsed.success.reduce((sum, entry) => sum + entry.amount, 0) : 0
	);
	const summary = $derived(
		Result.isSuccess(parsed)
			? t('renderer.obligation_instalment.summary', {
					count: parsed.success.length,
					total: total.toFixed(2)
				})
			: t('renderer.obligation_instalment.invalid')
	);

	function coerceRow(entry: unknown): ObligationInstalment {
		const raw = entry != null && typeof entry === 'object' ? entry : {};
		return {
			due_date: String(Reflect.get(raw, 'due_date') ?? '').slice(0, 10),
			amount: Number(Reflect.get(raw, 'amount'))
		};
	}

	function dueDatePickerValue(day: string): string {
		return Result.getOrElse(
			Result.try(() => calendarDayAsPickerInstant(day, PICKER_TIME_ZONE)),
			() => ''
		);
	}

	function dueDateFromPicker(value: string): string {
		return Result.getOrElse(
			Result.try(() => calendarDayFromPickerInstant(value, PICKER_TIME_ZONE)),
			() => value
		);
	}

	const rows = $derived(
		draft.map((entry, index): InstalmentRow => {
			const coerced = coerceRow(entry);
			return {
				id: `instalment-${index}`,
				due_date: dueDatePickerValue(coerced.due_date),
				amount: coerced.amount
			};
		})
	);

	/** The month after the last instalment, so adding a row continues the plan rather than today. */
	function nextDueDate(): string {
		const last = coerceRow(draft.at(-1)).due_date || todayKey();
		return Result.getOrElse(
			Result.try(() => monthlyDueDates(last, 2)[1] ?? last),
			() => last
		);
	}

	function emit(nextRows: readonly InstalmentRow[]): void {
		if (props.mode !== 'edit') return;
		const next: ObligationInstalment[] = nextRows.map((row) => ({
			due_date: dueDateFromPicker(row.due_date),
			amount: row.amount
		}));
		props.onValueChange(next as unknown as Value);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">{t('renderer.obligation_instalment.identity')}</p>
		<MatrixRenderer
			{rows}
			{columns}
			{disabled}
			emptyMessage={t('renderer.obligation_instalment.empty')}
			addRowLabel={t('renderer.obligation_instalment.add')}
			createRow={(): InstalmentRow => ({
				id: crypto.randomUUID(),
				due_date: dueDatePickerValue(nextDueDate()),
				amount: 0.01
			})}
			allowRemoveRows={true}
			bounded={false}
			onChange={emit}
		/>
	</Stack>
{/if}
