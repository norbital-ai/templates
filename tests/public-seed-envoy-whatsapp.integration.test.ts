import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type {
	CommunicationRequest,
	CommunicationResponse,
	FacilityBinding
} from '@norbital-ai/bolt-protocol';
import { cassetteAi, readCassetteFile } from '@norbital-ai/test-utilities';
import {
	bearerHeaders,
	pageOf,
	postGuestCommand,
	requireOk,
	systemHeaders
} from '@norbital-ai/test-utilities';
import { PUBLIC_ASSIGNMENT_ID, bootPublicSeedGuest } from './helpers/public-seed-guest.js';

/**
 * The WhatsApp envoy pipeline on the public seed, with WhatsApp itself stubbed at the two seams
 * the host owns: the inbound delivery (`envoys.receive`, what Colony posts after verifying a
 * webhook) and the outbound transport (the communication facility, recorded instead of sent).
 *
 * The agent turns replay from `tests/assets/envoy-completion.cassette.json` — recorded model
 * outputs, no key, no network. Everything between those seams is real: sender resolution
 * against verified channels, the registration notice for an unknown sender, invite → code →
 * redeem linking, the inbound queue and its drain task, the envoy's agent turn under the
 * `field_ops_whatsapp` policy, the `write_collection` mutation through the assignment hooks,
 * and the reply on the contractor's conversation.
 */
const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 180_000;
const ENVOY = 'field_ops_whatsapp';
const SENDER_JID = '6591234567@s.whatsapp.net';
const STRANGER_JID = '6598765432@s.whatsapp.net';
const CONTRACTOR_EMAIL = 'contractor@example.test';
const envoyCassette = readCassetteFile(
	fileURLToPath(new URL('./assets/envoy-completion.cassette.json', import.meta.url))
);
/**
 * The envoy's turns replay the recorded completion cassette. The agent loop verifies each
 * observation against its own provider call id, which `cassetteAi` stamps live per request.
 */

const delivery = (messageId: string, sender: string, text: string) => ({
	conversationId: sender,
	conversationKind: 'dm',
	messageId,
	sentAt: '2026-09-06T04:00:00.000Z',
	invocation: 'direct',
	text,
	sender: { id: sender, displayName: 'Contractor' },
	attachments: []
});

const rows = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
	Array.isArray(value) ? (value as ReadonlyArray<Record<string, unknown>>) : [];

const waitFor = async <T>(
	read: () => Promise<T | undefined>,
	label: string,
	timeoutMillis = 90_000
): Promise<T> => {
	const deadline = Date.now() + timeoutMillis;
	while (Date.now() < deadline) {
		const value = await read();
		if (value !== undefined) return value;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`${label} did not happen within ${timeoutMillis} ms`);
};

test(
	'a linked contractor completes an assignment over WhatsApp; a stranger is asked to register',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const sends: Array<Extract<CommunicationRequest, { readonly _tag: 'Send' }>> = [];
		const communication: FacilityBinding<CommunicationRequest, CommunicationResponse> = {
			call: async (_metadata, request) => {
				if (request._tag === 'Send') sends.push(request);
				return { _tag: 'Success', value: { receipt: { id: `wire-${sends.length}` } } };
			}
		};
		const guest = await bootPublicSeedGuest({
			tenantId: 'field-ops-public-seed-envoy',
			releaseId: 'field-ops-public-seed-envoy',
			gatewaySecret: 'field-ops-public-seed-envoy-gateway',
			founderEmail: 'field-ops-envoy-founder@example.test',
			founderClaimId: 'field-ops-public-seed-envoy-founder',
			secretsKey: 'field-ops-public-seed-envoy-secrets-key',
			invocationTimeoutMillis: 120_000,
			ai: cassetteAi(envoyCassette),
			communication
		});
		const system = (command: string, input: unknown) =>
			postGuestCommand(
				guest.baseUrl,
				command,
				input,
				systemHeaders(command, input, guest.gatewaySecret, guest.tenantId)
			);
		try {
			const listed = pageOf(
				requireOk(
					await postGuestCommand(
						guest.baseUrl,
						'collections.findMany',
						{
							collection: 'job_assignments',
							where: { id: { eq: PUBLIC_ASSIGNMENT_ID } },
							limit: 1,
							columns: { id: true, status: true, assignee_user_id: true }
						},
						{ authorization: `Bearer ${guest.credential}` }
					),
					'collections.findMany'
				),
				'public assignment'
			);
			const assignment = listed.rows[0];
			assert.ok(assignment !== undefined);
			assert.equal(assignment.status, 'assigned');
			const assigneeId = String(assignment.assignee_user_id);

			// A stranger writes first: no account holds this number, so the pipeline answers with a
			// registration claim on the same transport and executes nothing.
			const stranger = requireOk(
				await system('envoys.receive', {
					envoy: ENVOY,
					delivery: delivery('msg-stranger', STRANGER_JID, 'Job done.')
				}),
				'envoys.receive'
			) as Record<string, unknown>;
			assert.equal(stranger.status, 'registration_required');
			assert.equal(sends.length, 1);
			const notice = sends[0];
			assert.ok(notice !== undefined);
			assert.equal(notice.channel, 'whatsapp');
			assert.equal(notice.recipient, STRANGER_JID);
			const registration = (notice.payload as { registration?: { claimId?: string } }).registration;
			assert.ok(registration?.claimId, 'the registration notice carries a claim');
			const inspected = requireOk(
				await system('envoys.registration.inspect', { claimId: registration.claimId }),
				'envoys.registration.inspect'
			) as Record<string, unknown>;
			assert.equal(inspected.envoy, ENVOY);
			assert.equal(inspected.transport, 'whatsapp');

			// The assignee holds a verified WhatsApp identity: the same digits as the sender JID.
			await guest.query(`update "user" set "channels" = $2::jsonb where "id" = $1::uuid`, [
				assigneeId,
				JSON.stringify([{ type: 'whatsapp', address: '+65 9123 4567', verified: true }])
			]);
			const received = requireOk(
				await system('envoys.receive', {
					envoy: ENVOY,
					delivery: delivery(
						'msg-1',
						SENDER_JID,
						`Assignment ${PUBLIC_ASSIGNMENT_ID} is finished, please mark it completed.`
					)
				}),
				'envoys.receive'
			) as Record<string, unknown>;
			assert.equal(received.status, 'buffered');

			const conversationId = `${ENVOY}:dm:${SENDER_JID}`;
			const dump = async (): Promise<string> => {
				const tables = [
					'bolt_envoy_inbound',
					'bolt_task',
					'agent_task',
					'agent_run',
					'agent_message'
				];
				const parts: string[] = [];
				for (const table of tables) {
					const listed = rows(
						await guest.query(`select row_to_json(t) as row from ${table} t limit 20`)
					);
					parts.push(`${table}: ${JSON.stringify(listed.map((r) => r.row)).slice(0, 4000)}`);
				}
				return parts.join('\n');
			};
			const inbound = await waitFor(async () => {
				const state = rows(
					await guest.query(
						`select status from bolt_envoy_inbound where conversation_id = $1 and external_message_id = 'msg-1'`,
						[conversationId]
					)
				)[0];
				return state?.status === 'answered' ? state : undefined;
			}, 'the envoy drain answering the inbound message').catch(async (error: unknown) => {
				throw new Error(`${String(error)}\n${await dump()}`);
			});
			assert.equal(inbound.status, 'answered');

			const task = rows(await guest.query(`select status, agent_id, audience from agent_task`))[0];
			assert.deepEqual(task, { status: 'done', agent_id: ENVOY, audience: 'workbench' });

			const after = rows(
				await guest.query(`select status, completed_at from job_assignments where id = $1::uuid`, [
					PUBLIC_ASSIGNMENT_ID
				])
			)[0];
			assert.equal(after?.status, 'completed');
			assert.ok(after?.completed_at, 'the update hook stamped completion');

			const reply = sends.find((send) => send.recipient === SENDER_JID);
			assert.ok(reply !== undefined, `reply sent: ${JSON.stringify(sends)}`);
			assert.equal(reply.channel, 'whatsapp');
			assert.match(String((reply.payload as { text?: string }).text), /completed/i);
		} finally {
			await guest.stop();
		}
	}
);

test(
	'a stranger registers over WhatsApp and, once linked, completes an assignment',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const sends: Array<Extract<CommunicationRequest, { readonly _tag: 'Send' }>> = [];
		const communication: FacilityBinding<CommunicationRequest, CommunicationResponse> = {
			call: async (_metadata, request) => {
				if (request._tag === 'Send') sends.push(request);
				return { _tag: 'Success', value: { receipt: { id: `wire-${sends.length}` } } };
			}
		};
		const guest = await bootPublicSeedGuest({
			tenantId: 'field-ops-public-seed-envoy-register',
			releaseId: 'field-ops-public-seed-envoy-register',
			gatewaySecret: 'field-ops-public-seed-envoy-register-gateway',
			founderEmail: 'field-ops-envoy-register-founder@example.test',
			founderClaimId: 'field-ops-public-seed-envoy-register-founder',
			secretsKey: 'field-ops-public-seed-envoy-register-secrets-key',
			invocationTimeoutMillis: 120_000,
			ai: cassetteAi(envoyCassette),
			communication
		});
		const system = (command: string, input: unknown) =>
			postGuestCommand(
				guest.baseUrl,
				command,
				input,
				systemHeaders(command, input, guest.gatewaySecret, guest.tenantId)
			);
		const asContractor = (command: string, input: unknown, credential: string) =>
			postGuestCommand(guest.baseUrl, command, input, bearerHeaders(credential));
		try {
			// An unknown number writes: registration claim, nothing executed.
			const stranger = requireOk(
				await system('envoys.receive', {
					envoy: ENVOY,
					delivery: delivery(
						'msg-reg-1',
						STRANGER_JID,
						'Hi, I am a contractor, please register me.'
					)
				}),
				'envoys.receive'
			) as Record<string, unknown>;
			assert.equal(stranger.status, 'registration_required');
			const notice = sends.find((send) => send.recipient === STRANGER_JID);
			assert.ok(notice !== undefined);
			const claimId = (notice.payload as { registration?: { claimId?: string } }).registration
				?.claimId;
			assert.ok(claimId, 'the registration notice carries a claim');

			// The workspace invites the contractor, who signs in through the real code flow —
			// the code itself travels the swappable communication seam, on the email channel.
			const invited = requireOk(
				await asContractor('identity.invite', { email: CONTRACTOR_EMAIL }, guest.credential),
				'identity.invite'
			) as Record<string, unknown>;
			assert.ok(typeof invited.invitationId === 'string');
			requireOk(
				await postGuestCommand(guest.baseUrl, 'identity.sendCode', { email: CONTRACTOR_EMAIL }, {}),
				'identity.sendCode'
			);
			const codeSend = sends.find(
				(send) => send.channel === 'email' && send.recipient === CONTRACTOR_EMAIL
			);
			assert.ok(codeSend !== undefined, 'the sign-in code went out on the email channel');
			const code = (codeSend.payload as { code?: unknown }).code;
			assert.ok(typeof code === 'string' && code.length > 0);
			const verified = requireOk(
				await postGuestCommand(
					guest.baseUrl,
					'identity.verifyCode',
					{ email: CONTRACTOR_EMAIL, code },
					{}
				),
				'identity.verifyCode'
			) as Record<string, unknown>;
			assert.ok(typeof verified.credential === 'string' && verified.credential.length > 0);
			const contractorCredential = String(verified.credential);
			const accepted = requireOk(
				await asContractor(
					'identity.invitation.accept',
					{ invitationId: invited.invitationId },
					contractorCredential
				),
				'identity.invitation.accept'
			) as Record<string, unknown>;
			assert.equal(accepted.state, 'accepted');

			// The contractor redeems the WhatsApp claim: the JID links to their account, verified.
			const redeemed = requireOk(
				await asContractor('envoys.registration.redeem', { claimId }, contractorCredential),
				'envoys.registration.redeem'
			) as Record<string, unknown>;
			assert.equal(redeemed.state, 'registered');
			const contractor = rows(
				await guest.query(`select id, channels from "user" where email = $1`, [CONTRACTOR_EMAIL])
			)[0];
			assert.ok(contractor !== undefined);
			const channels = Array.isArray(contractor.channels) ? contractor.channels : [];
			assert.ok(
				channels.some(
					(channel) =>
						typeof channel === 'object' &&
						channel !== null &&
						(channel as Record<string, unknown>).type === 'whatsapp' &&
						(channel as Record<string, unknown>).verified === true
				),
				`the JID is a verified channel: ${JSON.stringify(channels)}`
			);
			const reinspected = requireOk(
				await system('envoys.registration.inspect', { claimId }),
				'envoys.registration.inspect'
			) as Record<string, unknown>;
			assert.equal(reinspected.state, 'registered');

			// The linked contractor owns the public assignment from here on.
			await guest.query(
				`update job_assignments set assignee_user_id = $2::uuid where id = $1::uuid`,
				[PUBLIC_ASSIGNMENT_ID, String(contractor.id)]
			);
			const sendsBeforeReply = sends.length;
			const received = requireOk(
				await system('envoys.receive', {
					envoy: ENVOY,
					delivery: delivery(
						'msg-reg-2',
						STRANGER_JID,
						`Assignment ${PUBLIC_ASSIGNMENT_ID} is finished, please mark it completed.`
					)
				}),
				'envoys.receive'
			) as Record<string, unknown>;
			assert.equal(received.status, 'buffered');

			const conversationId = `${ENVOY}:dm:${STRANGER_JID}`;
			const inbound = await waitFor(async () => {
				const state = rows(
					await guest.query(
						`select status from bolt_envoy_inbound where conversation_id = $1 and external_message_id = 'msg-reg-2'`,
						[conversationId]
					)
				)[0];
				return state?.status === 'answered' ? state : undefined;
			}, 'the envoy drain answering the registered contractor');
			assert.equal(inbound.status, 'answered');

			const after = rows(
				await guest.query(`select status, completed_at from job_assignments where id = $1::uuid`, [
					PUBLIC_ASSIGNMENT_ID
				])
			)[0];
			assert.equal(after?.status, 'completed');
			assert.ok(after?.completed_at, 'the update hook stamped completion');

			const reply = sends.slice(sendsBeforeReply).find((send) => send.recipient === STRANGER_JID);
			assert.ok(reply !== undefined, `reply sent: ${JSON.stringify(sends)}`);
			assert.equal(reply.channel, 'whatsapp');
			assert.match(String((reply.payload as { text?: string }).text), /completed/i);
		} finally {
			await guest.stop();
		}
	}
);
