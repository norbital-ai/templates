<script lang="ts">
	import { Button } from '@norbital-ai/ui';
	import { create_radio_group } from '@norbital-ai/ui/behaviors';
	import { Cluster } from '@norbital-ai/ui/layout';
	import { untrack } from 'svelte';

	const STATUSES = ['pending', 'arrived', 'skipped'] as const;
	type StopStatus = (typeof STATUSES)[number];

	let {
		value,
		disabled = false,
		labelled_by,
		index,
		label_of,
		on_change
	}: {
		value: StopStatus;
		disabled?: boolean;
		labelled_by: string;
		index: number;
		label_of: (status: StopStatus) => string;
		on_change: (status: StopStatus) => void;
	} = $props();

	const radio = create_radio_group({
		items: () => STATUSES,
		value: () => value,
		disabled: () => disabled,
		on_change: (next) => {
			if (next === 'pending' || next === 'arrived' || next === 'skipped') on_change(next);
		},
		control: { id: `route-waypoint-status:${untrack(() => index)}` }
	});
</script>

<div {...radio.root_attrs()} aria-labelledby={labelled_by}>
	<Cluster gap="xs">
		{#each STATUSES as s (s)}
			<Button
				{...radio.item_attrs(s)}
				{@attach radio.item(s)}
				variant={value === s ? 'default' : 'outline'}
				{disabled}
			>
				{label_of(s)}
			</Button>
		{/each}
	</Cluster>
</div>
