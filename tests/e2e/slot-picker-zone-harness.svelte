<script lang="ts">
	import { provideKinds } from '@norbital-ai/ui';
	import SlotPicker from '../../src/lib/SlotPicker.svelte';
	provideKinds({ zone: 'Asia/Singapore' });
</script>

<SlotPicker
	days={[{ day: '2026-10-13', starts: ['2026-10-13T04:00:00.000Z'] }]}
	minutes={180}
	value="2026-10-13T04:00:00.000Z"
	locale="en-SG"
	onPick={() => {}}
	t={(key) => key}
/>
