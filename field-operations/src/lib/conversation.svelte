<script lang="ts">
	/**
	 * A job's conversation as received: the retained messages and the photos filed with them, grouped by the workspace's day,
	 * a burst of photos from one sender within two minutes as one bubble. Read-only; it follows the latest message until
	 * the reader scrolls away.
	 */
	import { bolt } from '$bolt';
	import { watch } from 'runed';
	import type { Id } from '@norbital-ai/bolt';
	import { Button, EmptyState, useKinds } from '@norbital-ai/ui';
	import { Frame, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { dayIn, timeIn, weekdayIn } from './format.js';
	import { senderName } from './dispatch.js';
	type Photo = {
		id: string;
		name: string;
		url: string;
		flags: string[];
		sender: string;
		sentAt: string;
		messageId: string | null;
		system: boolean;
	};
	let {
		job,
		onOpen
	}: {
		job: Id<'job_assignments'>;
		onOpen: (photo: { name: string; url: string }) => void;
	} = $props();
	const t = bolt.t;
	const logs = $derived(
		bolt.query({
			communication_logs: {
				where: { job_assignment_id: { eq: job } },
				orderBy: 'sent_at',
				limit: 250
			}
		})
	);
	/** Who sent each message, by name; a reader without members sees none. */
	const members = bolt.query({ sys_user: { fields: ['name', 'email', 'phone'], limit: 1000 } });
	const nameOf = (sender: string) =>
		senderName(sender, members.current?.sys_user.rows ?? []) ?? '—';
	/** A contractor's grant masks a photo's provenance: select it only where it is readable. */
	const kinds = useKinds();
	const locale = kinds.locale ?? bolt.locale;
	const provenance = kinds.catalog?.['photo_evidence']?.fields['source'] !== undefined;
	const traced = $derived(
		provenance
			? bolt.query({
					photo_evidence: {
						where: { job_assignment_id: { eq: job } },
						fields: ['photo', 'created_at', 'source', 'flags'],
						orderBy: 'created_at',
						limit: 250
					}
				})
			: null
	);
	const untraced = $derived(
		provenance
			? null
			: bolt.query({
					photo_evidence: {
						where: { job_assignment_id: { eq: job } },
						fields: ['photo', 'created_at'],
						orderBy: 'created_at',
						limit: 250
					}
				})
	);
	const photos = $derived<Photo[]>(
		[
			...(traced?.current?.photo_evidence.rows ?? []).map((row) => ({
				row,
				source: row.source,
				flags: [...row.flags]
			})),
			...(untraced?.current?.photo_evidence.rows ?? []).map((row) => ({
				row,
				source: null,
				flags: []
			}))
		].flatMap(({ row, source, flags }) => {
			const file = row.photo;
			if (file == null) return [];
			const message = source?.kind === 'message' ? source : null;
			return [
				{
					id: String(row.id),
					name: file.name,
					url: bolt.fileUrl(file, { preview: 1024 }),
					flags,
					sender: message ? nameOf(message.sender_id) : t('component.workspace_upload'),
					sentAt: message?.sent_at ?? String(row.created_at ?? ''),
					messageId: message?.message_id ?? null,
					system: message == null
				}
			];
		})
	);
	type Item = {
		id: string;
		sender: string;
		text: string | null;
		sentAt: string;
		photos: Photo[];
		system: boolean;
	};
	const timeline = $derived.by(() => {
		const byMessage = Map.groupBy(
			photos.filter((p) => p.messageId != null),
			(p) => p.messageId!
		);
		const items: Item[] = [
			...(logs.current?.communication_logs.rows ?? []).map((m) => ({
				id: `message:${m.source_message_id}`,
				sender: nameOf(m.sender),
				text: m.message,
				sentAt: String(m.sent_at),
				photos: byMessage.get(m.source_message_id) ?? [],
				system: false
			})),
			...photos
				.filter(
					(p) =>
						p.messageId == null ||
						!(logs.current?.communication_logs.rows ?? []).some(
							(m) => m.source_message_id === p.messageId
						)
				)
				.map((p) => ({
					id: `photo:${p.id}`,
					sender: p.sender,
					text: null,
					sentAt: p.sentAt,
					photos: [p],
					system: p.system
				}))
		].sort((l, r) => Date.parse(l.sentAt) - Date.parse(r.sentAt));
		const grouped: Item[] = [];
		for (const item of items) {
			const last = grouped.at(-1);
			if (
				last &&
				item.text == null &&
				last.text == null &&
				!item.system &&
				!last.system &&
				last.sender === item.sender &&
				dayIn(kinds.zone, last.sentAt) === dayIn(kinds.zone, item.sentAt) &&
				Math.abs(Date.parse(item.sentAt) - Date.parse(last.sentAt)) <= 120000
			)
				last.photos.push(...item.photos);
			else grouped.push({ ...item, photos: [...item.photos] });
		}
		return Map.groupBy(grouped, (item) => dayIn(kinds.zone, item.sentAt));
	});
	let port = $state<HTMLElement | null>(null);
	let pinned = $state(true);
	// A new message, a re-pin or a mounted port scrolls a pinned view to the bottom.
	watch(
		() => [timeline, pinned, port] as const,
		() => {
			if (pinned && port) queueMicrotask(() => port?.scrollTo({ top: port.scrollHeight }));
		}
	);
</script>

<Stack gap="sm">
	<p class="text-meta">
		{t('component.conversation_description')} · {t('component.conversation_read_only')}
	</p>
	{#if logs.error}<p class="text-sm text-destructive" role="alert">
			{t('component.communication_logs_failed')}
		</p>{/if}
	{#if traced?.error ?? untraced?.error}<p class="text-sm text-destructive" role="alert">
			{t('component.evidence_load_failed')}
		</p>{/if}
	<Scroll
		bind:ref={port}
		name={t('component.conversation')}
		class="max-h-[min(70vh,40rem)] min-h-80 rounded-lg border bg-muted/25 p-3"
		onscroll={() => port && (pinned = port.scrollHeight - port.scrollTop - port.clientHeight <= 24)}
	>
		{#if timeline.size === 0}
			<EmptyState variant="inset" title={t('component.conversation_empty')} />
		{/if}
		<Stack as="ol" gap="sm">
			{#each timeline as [day, items] (day)}
				<li class="text-center text-meta">{weekdayIn(kinds.zone, locale, items[0]!.sentAt)}</li>
				{#each items as item (item.id)}
					<li class="rounded-md border bg-card p-2" data-conversation-item>
						<p class="text-meta">{item.sender} · {timeIn(kinds.zone, locale, item.sentAt)}</p>
						{#if item.text}<p class="text-sm whitespace-pre-wrap">{item.text}</p>{/if}
						{#if item.photos.length > 0}
							<Grid minimum="compact" gap="xs">
								{#each item.photos as photo (photo.id)}
									<button
										type="button"
										aria-label={t('component.open_photo', { name: photo.name })}
										onclick={() => onOpen(photo)}
									>
										<Frame ratio="square" class="rounded-md"
											><img src={photo.url} alt={photo.name} loading="lazy" /></Frame
										>
									</button>
								{/each}
							</Grid>
						{/if}
					</li>
				{/each}
			{/each}
		</Stack>
	</Scroll>
	{#if !pinned}
		<Button
			size="sm"
			variant="secondary"
			onclick={() => {
				port?.scrollTo({ top: port.scrollHeight });
				pinned = true;
			}}
		>
			{t('component.conversation_to_latest')}
		</Button>
	{/if}
</Stack>
