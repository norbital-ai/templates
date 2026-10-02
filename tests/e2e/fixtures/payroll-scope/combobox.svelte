<script lang="ts">
	let {
		options,
		value,
		onChange,
		disabled = false,
		'aria-label': label
	}: {
		options: readonly { value: string; label: string }[];
		value: string | null;
		onChange: (value: string | null) => void;
		disabled?: boolean;
		'aria-label'?: string;
	} = $props();
</script>

<select
	aria-label={label}
	value={value ?? ''}
	{disabled}
	onchange={(event) => onChange(event.currentTarget.value || null)}
	><option value=""></option>{#each options as item}<option value={item.value}>{item.label}</option
		>{/each}</select
>
