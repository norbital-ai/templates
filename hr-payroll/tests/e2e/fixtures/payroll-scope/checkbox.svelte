<script lang="ts">
	let {
		checked,
		onCheckedChange,
		'aria-label': label
	}: {
		checked: boolean;
		onCheckedChange: (value: boolean) => void;
		'aria-label'?: string;
	} = $props();
</script>

<input
	type="checkbox"
	aria-label={label}
	{checked}
	onchange={(event) => onCheckedChange(event.currentTarget.checked)}
/>
