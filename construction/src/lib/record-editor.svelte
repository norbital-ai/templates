<script lang="ts" module>
	export type Entry = string | number | null;
	export type Value = {
		readonly [key: string]: Entry;
	};
	export type Part = {
		key: string;
		label: string;
		type?: 'text' | 'tel' | 'date' | 'number';
		autocomplete?: 'name' | 'tel';
		/** An empty optional part is `null`; an empty required part is `''`. */
		optional?: true;
	};
	/** A required text part as a shape stores it: `''` when empty. */
	export const text = (entry: Entry | undefined): string => (entry == null ? '' : String(entry));
	/** An optional text part as a shape stores it: `null` when empty. */
	export const optionalText = (entry: Entry | undefined): string | null =>
		entry == null || entry === '' ? null : String(entry);
	/** A number part: `null` when empty. */
	export const number = (entry: Entry | undefined): number | null =>
		typeof entry === 'number' ? entry : null;
</script>

<script lang="ts">
	/**
	 * One structured value edited part by part. A value whose every part is empty is `null`, so clearing the last
	 * filled cell clears the field rather than storing a record of empty strings.
	 */
	import { Input } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import * as Predicate from 'effect/Predicate';
	let {
		value,
		parts,
		disabled,
		onChange
	}: {
		value: Value | null;
		parts: readonly Part[];
		disabled: boolean;
		onChange: (next: Value | null) => void;
	} = $props();
	function update(part: Part, raw: string): void {
		const empty = Object.fromEntries(parts.map((p) => [p.key, p.optional ? null : '']));
		const parsed =
			part.type === 'number'
				? raw === ''
					? null
					: Number.parseFloat(raw)
				: raw || (part.optional ? null : '');
		if (Predicate.isNumber(parsed) && !Number.isFinite(parsed)) return;
		const next = { ...empty, ...value, [part.key]: parsed };
		onChange(Object.values(next).some((entry) => entry != null && entry !== '') ? next : null);
	}
</script>

<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
	{#each parts as part (part.key)}
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{part.label}
				<Input
					type={part.type ?? 'text'}
					step={part.type === 'number' ? 'any' : undefined}
					autocomplete={part.autocomplete}
					value={value?.[part.key] ?? ''}
					{disabled}
					oninput={(event) => update(part, event.currentTarget.value)}
				/>
			</Stack>
		</label>
	{/each}
</Grid>
