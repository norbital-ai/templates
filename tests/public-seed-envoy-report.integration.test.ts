import test from 'node:test';
import assert from 'node:assert/strict';
import type {
	CommunicationRequest,
	CommunicationResponse,
	FacilityBinding
} from '@norbital-ai/bolt-protocol';
import {
	cassetteAi,
	mutationPush,
	mutationResolution,
	postGuestCommand,
	requireOk,
	systemHeaders
} from '@norbital-ai/test-utilities';
import { PUBLIC_ASSIGNMENT_ID, bootPublicSeedGuest } from './helpers/public-seed-guest.js';

/**
 * The three jobs around an assignment, on the public seed:
 *
 * - the WhatsApp envoy's report is one assignment update carrying the status, the photo the
 *   contractor sent and the message it came in — filed through the envoy's own policy, stamped by
 *   the assignment transform, and traceable to the WhatsApp message;
 * - any change to an assignment makes it unread for the suspicion review again;
 * - the import pipeline creates assignments from a sheet, filing a site it does not know.
 *
 * The envoy's model turn is scripted (the write it would make, then its reply); everything between
 * the inbound delivery and the database is the real pipeline.
 */
const TIMEOUT_MILLIS = 180_000;
const ENVOY = 'field_ops_whatsapp';
const SENDER_JID = '6591234567@s.whatsapp.net';
const REPORT_MESSAGE_ID = 'msg-report-1';
const SENT_AT = '2026-09-06T04:00:00.000Z';
const REPORT_TEXT = 'Amber Quay done, grab bars installed. Photo attached.';

const generated = (callId: string, content: unknown) => ({
	_tag: 'Generated',
	result: { _tag: 'Message', message: { options: {}, role: 'assistant', content } },
	observation: { provider: 'fixture', model: 'provider/model', operation: 'language', callId }
});

const reportCassette = {
	meta: {
		name: 'envoy-report',
		recordedAt: '2026-09-23T00:00:00.000Z',
		model: 'provider/model',
		purpose: 'The envoy files one report: status, photo and message in one assignment update.'
	},
	turns: [
		generated('cassette/report-0', [
			{
				options: {},
				type: 'tool-call',
				id: 'call-report',
				name: 'write_collection',
				providerExecuted: false,
				params: {
					collection: 'job_assignments',
					operation: 'update',
					id: PUBLIC_ASSIGNMENT_ID,
					values: {
						status: 'completed',
						summary: 'Grab bars installed.',
						job_assignment_photo_evidence: {
							create: [
								{
									photo: {
										storage_key: 'envoy/field_ops_whatsapp/grab-bars.jpg',
										file_name: 'grab-bars.jpg',
										file_size: 1024,
										mime_type: 'image/jpeg'
									},
									source: {
										kind: 'channel',
										provider: 'whatsapp',
										conversation_id: SENDER_JID,
										message_id: REPORT_MESSAGE_ID,
										attachment_id: 'grab-bars.jpg',
										sender_id: SENDER_JID,
										sent_at: SENT_AT
									}
								}
							]
						},
						job_assignment_communications: {
							create: [
								{
									message: REPORT_TEXT,
									sent_at: SENT_AT,
									sender: SENDER_JID,
									source_message_id: REPORT_MESSAGE_ID
								}
							]
						}
					}
				}
			}
		]),
		generated('cassette/report-1', 'Marked Amber Quay completed with your photo.')
	]
};

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): ReadonlyArray<Row> =>
	Array.isArray(value) ? (value as ReadonlyArray<Row>) : [];

const waitFor = async <T>(read: () => Promise<T | undefined>, label: string): Promise<T> => {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		const value = await read();
		if (value !== undefined) return value;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`${label} did not happen within 90 s`);
};

test(
	'the envoy files a report on its assignment, a change makes it unread, and a sheet imports',
	{ timeout: TIMEOUT_MILLIS },
	async () => {
		const communication: FacilityBinding<CommunicationRequest, CommunicationResponse> = {
			call: async () => ({ _tag: 'Success', value: { receipt: { id: 'wire' } } })
		};
		const guest = await bootPublicSeedGuest({
			tenantId: 'field-ops-envoy-report',
			releaseId: 'field-ops-envoy-report',
			gatewaySecret: 'field-ops-envoy-report-gateway',
			founderEmail: 'field-ops-envoy-report-founder@example.test',
			founderClaimId: 'field-ops-envoy-report-founder',
			secretsKey: 'field-ops-envoy-report-secrets-key',
			invocationTimeoutMillis: 120_000,
			ai: cassetteAi(reportCassette as Parameters<typeof cassetteAi>[0]),
			communication
		});
		const system = (command: string, input: unknown) =>
			postGuestCommand(
				guest.baseUrl,
				command,
				input,
				systemHeaders(command, input, guest.gatewaySecret, guest.tenantId)
			);
		const founder = (command: string, input: unknown) =>
			postGuestCommand(guest.baseUrl, command, input, {
				authorization: `Bearer ${guest.credential}`
			});
		const assignment = async (id: string) =>
			rows(
				await guest.query(
					`select status, completed_at, summary, suspicion_checked_at, row_version from job_assignments where id = $1::uuid`,
					[id]
				)
			)[0];
		try {
			// Reviewed before the report arrives.
			await guest.query(
				`update job_assignments set suspicion_checked_at = now() where id = $1::uuid`,
				[PUBLIC_ASSIGNMENT_ID]
			);
			const assigneeId = String(
				rows(
					await guest.query(`select assignee_user_id from job_assignments where id = $1::uuid`, [
						PUBLIC_ASSIGNMENT_ID
					])
				)[0]?.assignee_user_id
			);
			await guest.query(`update "user" set "channels" = $2::jsonb where "id" = $1::uuid`, [
				assigneeId,
				JSON.stringify([{ type: 'whatsapp', address: '+65 9123 4567', verified: true }])
			]);

			const received = requireOk(
				await system('envoys.receive', {
					envoy: ENVOY,
					delivery: {
						conversationId: SENDER_JID,
						conversationKind: 'dm',
						messageId: REPORT_MESSAGE_ID,
						sentAt: SENT_AT,
						invocation: 'direct',
						text: REPORT_TEXT,
						sender: { id: SENDER_JID, displayName: 'Contractor' },
						attachments: []
					}
				}),
				'envoys.receive'
			) as Row;
			assert.equal(received.status, 'buffered');
			await waitFor(async () => {
				const state = rows(
					await guest.query(
						`select status from bolt_envoy_messages where direction = 'inbound' and external_message_id = $1`,
						[REPORT_MESSAGE_ID]
					)
				)[0];
				return state?.status === 'answered' ? state : undefined;
			}, 'the envoy answering the report');

			const toolResult = rows(
				await guest.query(
					`select message::text as message from conversation_message where message::text like '%call-report%' order by sequence`
				)
			)
				.map((row) => String(row.message))
				.join('\n');
			const reported = await assignment(PUBLIC_ASSIGNMENT_ID);
			assert.equal(reported?.status, 'completed', toolResult);
			assert.ok(reported?.completed_at, 'completion is stamped');
			assert.equal(reported?.summary, 'Grab bars installed.');
			assert.equal(reported?.suspicion_checked_at, null, 'the report makes the assignment unread');

			const photos = rows(
				await guest.query(
					`select job_assignment_id, source_key, sha256, flags, source from photo_evidence where job_assignment_id = $1::uuid`,
					[PUBLIC_ASSIGNMENT_ID]
				)
			);
			assert.equal(photos.length, 1);
			assert.equal(photos[0]?.source_key, `whatsapp:${SENDER_JID}:grab-bars.jpg`);
			assert.equal(photos[0]?.sha256, '', 'born uninspected, for the review to fill in');
			assert.equal((photos[0]?.source as Row).message_id, REPORT_MESSAGE_ID);

			const messages = rows(
				await guest.query(
					`select job_assignment_id, message, sender from communication_logs where source_message_id = $1`,
					[REPORT_MESSAGE_ID]
				)
			);
			assert.deepEqual(messages, [
				{ job_assignment_id: PUBLIC_ASSIGNMENT_ID, message: REPORT_TEXT, sender: SENDER_JID }
			]);

			// Any other change makes a reviewed assignment unread again.
			const other = '01990000-0000-7000-8005-000000000002';
			await guest.query(
				`update job_assignments set suspicion_checked_at = now() where id = $1::uuid`,
				[other]
			);
			const before = await assignment(other);
			const updated = await founder(
				'collections.write',
				mutationPush(
					guest.schemaFingerprint,
					{
						collection: 'job_assignments',
						action: 'update',
						inputs: [{ id: other, summary: 'Controller note.' }]
					},
					[
						{
							row: { collection: 'job_assignments', recordId: other },
							rowVersion: Number(before?.row_version)
						}
					]
				)
			);
			assert.equal(mutationResolution(updated.value, 'collections.write'), 'accepted');
			assert.equal((await assignment(other))?.suspicion_checked_at, null);

			// A sheet of work orders: one against a known site by code, one against a new site.
			const imported = requireOk(
				await founder('collections.import', {
					records: [
						{
							collection: 'job_assignments',
							id: crypto.randomUUID(),
							values: {
								rows: [
									{
										site: 'PUB-SITE-CEDAR-WHARF',
										scheduled_for: '2026-10-01',
										title: 'Installation — Cedar Wharf',
										nature: 'Installation',
										external_ref: 'SHEET-1'
									},
									{
										site: '12 New Street, Singapore 000012',
										scheduled_for: '2026-10-02',
										title: 'Survey — 12 New Street',
										assignee_user_id: assigneeId
									}
								]
							}
						}
					]
				}),
				'collections.import'
			);
			assert.deepEqual(imported, { imported: 2 });
			const filed = rows(
				await guest.query(
					`select a.title, a.status, a.external_ref, s.name as site from job_assignments a join sites s on s.id = a.site_id where a.scheduled_for >= '2026-10-01' order by a.scheduled_for`
				)
			);
			assert.deepEqual(filed, [
				{
					title: 'Installation — Cedar Wharf',
					status: 'unassigned',
					external_ref: 'SHEET-1',
					site: 'Cedar Wharf Public Slip'
				},
				{
					title: 'Survey — 12 New Street',
					status: 'assigned',
					external_ref: null,
					site: '12 New Street, Singapore 000012'
				}
			]);

			// The whole sheet is refused when one row is wrong, and nothing is filed.
			const refused = await founder('collections.import', {
				records: [
					{
						collection: 'job_assignments',
						id: crypto.randomUUID(),
						values: {
							rows: [
								{ site: 'Another New Site', scheduled_for: '2026-10-03', title: 'Survey' },
								{ site: 'Cedar Wharf Public Slip', scheduled_for: 'soon', title: 'Survey' }
							]
						}
					}
				]
			});
			assert.ok(refused.status >= 400, JSON.stringify(refused.value));
			assert.match(JSON.stringify(refused.value), /calendar day/);
			assert.equal(
				rows(await guest.query(`select id from sites where name = 'Another New Site'`)).length,
				0
			);
		} finally {
			await guest.stop();
		}
	}
);
