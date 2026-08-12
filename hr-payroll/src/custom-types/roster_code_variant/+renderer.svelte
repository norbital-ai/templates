<script lang="ts">
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { rosterCodeVariantSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(rosterCodeVariantSchema.safeParse(props.value));
	const current = $derived(parsed.success ? parsed.data : null);
	const kindOptions: Array<{
		value: 'WORK' | 'REST' | 'OFF';
		label: string;
		description: string;
	}> = [
		{ value: 'WORK', label: 'Work shift', description: 'A scheduled clock window' },
		{ value: 'REST', label: 'Rest day', description: 'Protected weekly rest' },
		{ value: 'OFF', label: 'Off day', description: 'Another planned non-working day' }
	];

	const summary = $derived.by(() => {
		if (current == null) return '—';
		if (current.kind !== 'WORK') return current.kind === 'REST' ? 'Rest day' : 'Off day';
		const overnight = current.end_time <= current.start_time ? ' (+1 day)' : '';
		return `${current.start_time} → ${current.end_time}${overnight} · ${current.break_minutes}m break`;
	});

	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}

	function selectKind(value: 'WORK' | 'REST' | 'OFF' | null): void {
		if (value === 'WORK') {
			emit({ kind: 'WORK', start_time: '09:00', end_time: '17:00', break_minutes: 60 });
			return;
		}
		if (value === 'REST' || value === 'OFF') emit({ kind: value });
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm" class="rounded-md border bg-muted/20 p-3">
		<label class="grid gap-1.5 text-sm font-medium">
			Kind
			<Combobox
				ariaLabel="Roster code kind"
				options={kindOptions}
				value={current?.kind ?? null}
				{disabled}
				searchable={false}
				onValueChange={selectKind}
			/>
		</label>
		{#if current?.kind === 'WORK'}
			<Grid gap="sm" minimum="compact">
				<label class="grid gap-1.5 text-sm font-medium">
					Start
					<Input
						type="time"
						value={current.start_time}
						{disabled}
						oninput={(event) => emit({ ...current, start_time: event.currentTarget.value })}
					/>
				</label>
				<label class="grid gap-1.5 text-sm font-medium">
					End
					<Input
						type="time"
						value={current.end_time}
						{disabled}
						oninput={(event) => emit({ ...current, end_time: event.currentTarget.value })}
					/>
				</label>
				<label class="grid gap-1.5 text-sm font-medium">
					Unpaid break (minutes)
					<Input
						type="number"
						min="0"
						step="1"
						value={current.break_minutes}
						{disabled}
						oninput={(event) =>
							emit({ ...current, break_minutes: numberFrom(event.currentTarget.value, 0) })}
					/>
				</label>
			</Grid>
			<p class="text-xs text-muted-foreground">{summary}</p>
		{/if}
	</Stack>
{/if}
