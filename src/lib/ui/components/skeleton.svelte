<script lang="ts">
	/** A loading placeholder block (the kit's `Spinner` is for a busy control, not a cell). */
	let { class: className = '' }: { class?: string } = $props();
</script>

<span class="block animate-pulse rounded-md bg-muted {className}" aria-hidden="true"></span>
