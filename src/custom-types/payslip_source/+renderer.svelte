<script lang="ts">
	import type { RendererProps } from './$types.js';

	let { value }: RendererProps = $props();

	const label = $derived.by(() => {
		if (value?.kind === 'TIME_ENTRY') return 'Attendance';
		if (value?.kind === 'LEAVE_REQUEST') return 'Leave';
		return 'Payroll input';
	});
</script>

<span>{label}</span>
