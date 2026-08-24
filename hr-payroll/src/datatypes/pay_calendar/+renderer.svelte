<script lang="ts">
	import { Result, Schema } from 'effect';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Stack } from '@norbital-ai/ui/layout';
	import { newLocalId } from '../../lib/ids.js';
	import { payCalendarSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type Window = Value[number]['instalments'][number];
	type InstalmentRow = Window & { readonly id: string };

	const dayField = (name: string): CollectionField => ({
		name,
		kind: 'integer',
		nullable: false
	});
	const COLUMNS = [
		{ key: 'start_day', label: 'From day', field: dayField('start_day'), width: 140 },
		{ key: 'end_day', label: 'To day', field: dayField('end_day'), width: 140 },
		{ key: 'pay_day', label: 'Paid on day', field: dayField('pay_day'), width: 160 }
	] satisfies readonly MatrixColumn<InstalmentRow>[];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(payCalendarSchema)(props.value));
	const current = $derived<Value | null>(Result.isSuccess(parsed) ? parsed.success : null);
	const instalments = $derived<readonly Window[]>(
		current?.find((entry: Value[number]) => entry.pay_frequency === 'SEMI_MONTHLY')?.instalments ??
			[]
	);
	const rows = $derived<InstalmentRow[]>(
		instalments.map((instalment, index): InstalmentRow => ({
			id: `instalment-${index}`,
			...instalment
		}))
	);

	function day(value: number): string {
		return value >= 31 ? 'end' : String(value);
	}

	const summary = $derived(
		rows.length === 0
			? 'Monthly only'
			: rows
					.map((row) => `${row.start_day}–${day(row.end_day)} paid ${day(row.pay_day)}`)
					.join(' · ')
	);

	function emit(nextRows: InstalmentRow[]): void {
		if (props.mode !== 'edit') return;
		props.onValueChange(
			nextRows.length === 0
				? null
				: ([
						{
							pay_frequency: 'SEMI_MONTHLY',
							instalments: nextRows.map(({ id: _, ...instalment }) => instalment)
						}
					] satisfies Value)
		);
	}

	function createInstalment(): InstalmentRow {
		const previous = rows.at(-1);
		return previous == null
			? { id: newLocalId(), start_day: 1, end_day: 15, pay_day: 15 }
			: {
					id: newLocalId(),
					start_day: Math.min(previous.end_day + 1, 31),
					end_day: 31,
					pay_day: 30
				};
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">
			Add rows only for a semi-monthly payroll. Monthly payroll uses the cutoff and pay day above.
		</p>
		<MatrixRenderer
			{rows}
			columns={COLUMNS}
			{disabled}
			emptyMessage="Monthly payroll only"
			addRowLabel="Add semi-monthly instalment"
			createRow={createInstalment}
			bounded={false}
			onChange={emit}
		/>
	</Stack>
{/if}
