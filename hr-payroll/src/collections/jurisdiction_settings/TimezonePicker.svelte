<script lang="ts">
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { timezoneNames } from '../../lib/timezone.js';

	/**
	 * The jurisdiction's wall clock, chosen by name. A free integer cannot express a zone that
	 * observes daylight saving; the engine derives the offset from the name for the date it prices.
	 */
	type Props = {
		value: unknown;
		onValueChange: (value: unknown) => void;
	};

	let { value, onValueChange }: Props = $props();

	const options = timezoneNames().map((zone) => ({ value: zone, label: zone }));
	const selected = $derived(typeof value === 'string' && value.length > 0 ? value : null);
</script>

<div data-timezone-picker>
	<Combobox
		{options}
		value={selected}
		onValueChange={(next) => onValueChange(next)}
		allowClear={false}
		ariaLabel="Time zone"
		searchPlaceholder="Search a time zone"
		emptyPlaceholder="Choose a time zone"
	/>
</div>
