<script module lang="ts">
	export type SegmentedOption<V extends string = string> = {
		readonly value: V;
		readonly label: string;
		readonly icon?: string;
	};
</script>

<script lang="ts" generics="T extends string = string">
	/**
	 * Reusable single-select roving-focus pill toggle strip backed by `@norbital-ai/ui`'s
	 * `create_toggle_group` (accessible keyboard navigation + Norbius observability).
	 */
	import { Button, Icon } from '@norbital-ai/ui';
	import { create_toggle_group } from '@norbital-ai/ui/behaviors';

	let {
		options,
		value,
		onChange,
		iconOnly = false,
		label,
		control
	}: {
		options: readonly SegmentedOption<T>[];
		value: T;
		onChange: (next: T) => void;
		iconOnly?: boolean;
		label: string;
		control?: { readonly id: string; readonly label: string };
	} = $props();

	const group = create_toggle_group({
		items: () => options.map((o) => o.value),
		mode: 'single',
		value: () => [value],
		on_change: (values) => {
			const hit = options.find((o) => o.value === values[0]);
			if (hit) onChange(hit.value);
		},
		...(control ? { control } : {})
	});
</script>

<div
	class="inline-flex flex-wrap items-center gap-0.5 rounded-control border border-border bg-muted/40 p-0.5"
	{...group.root_attrs()}
	aria-label={label}
>
	{#each options as opt (opt.value)}
		{#if iconOnly}
			<Button
				{...group.item_attrs(opt.value)}
				{@attach group.item(opt.value)}
				size="icon"
				variant={value === opt.value ? 'secondary' : 'ghost'}
				class="size-7"
				aria-label={opt.label}
				hint={opt.label}
			>
				{#if opt.icon}
					<Icon name={opt.icon} class="size-3.5" />
				{/if}
			</Button>
		{:else}
			<Button
				{...group.item_attrs(opt.value)}
				{@attach group.item(opt.value)}
				variant={value === opt.value ? 'secondary' : 'ghost'}
				class="h-7 px-2.5 text-xs"
			>
				{#if opt.icon}
					<Icon name={opt.icon} class="size-3.5" />
				{/if}
				{opt.label}
			</Button>
		{/if}
	{/each}
</div>
