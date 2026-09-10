<script lang="ts">
	/**
	 * One snapshot picker for the Changes tab: the options are a lineage's versions, each already
	 * labelled with its `<code>_<index>` id and described by its effective range. The value comes
	 * in as a prop — the page derives it from the selected row — so the framework-component rule
	 * that a markup attribute never reads a record's own `id` is respected.
	 */
	import { Combobox } from '@norbital-ai/ui/combobox';

	type Props = {
		options: ReadonlyArray<{
			readonly value: string;
			readonly label: string;
			readonly description: string;
			readonly type: string;
		}>;
		value: string | null;
		label: string;
		onValueChange: (versionId: string | null) => void;
	};

	let { options, value, label, onValueChange }: Props = $props();
</script>

<Combobox
	options={[...options]}
	value={value ?? undefined}
	onValueChange={(next) => onValueChange(next ?? null)}
	allowClear={false}
	preserveOptionOrder
	ariaLabel={label}
	class="w-56 min-w-[14rem]"
/>
