import test from 'node:test';
import assert from 'node:assert/strict';
import { get as requestGet } from 'node:http';
import { startSessionGateway } from '@norbital-ai/bolt-server';
import { bootPublicSeedGuest } from './helpers/public-seed-guest.js';

const HEADED_SYNC_TIMEOUT_MILLIS = 180_000;
const CONNECTION_ID = '01990000-0000-7000-8009-000000000001';

const isBoltDocument = (pathname: string): boolean =>
	pathname === '/__bolt' || pathname.startsWith('/app/');

const rewriteBoltBrowserPath = (pathname: string): string => {
	if (pathname.startsWith('/__bolt/sync/'))
		return `/sync/${pathname.slice('/__bolt/sync/'.length)}`;
	if (pathname.startsWith('/__bolt/command/')) {
		return `/_bolt/command/${pathname.slice('/__bolt/command/'.length)}`;
	}
	return pathname;
};

const holdGet = (
	url: string,
	headers: Record<string, string>
): Promise<import('node:http').IncomingMessage> =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`sse headers not received: ${url}`)), 8_000);
		const req = requestGet(url, { headers }, (response) => {
			clearTimeout(timer);
			resolve(response);
		});
		req.once('error', (cause) => {
			clearTimeout(timer);
			reject(cause);
		});
	});

/**
 * Host + session-gateway sync wire. No Obscura. A 410 here is the S5 register miss.
 */
test(
	'field-ops self-host gateway keeps /sync/stream open for a later /sync/connect',
	{ timeout: HEADED_SYNC_TIMEOUT_MILLIS },
	async () => {
		const session = await bootPublicSeedGuest({
			tenantId: 'field-ops-sync-wire',
			releaseId: 'field-ops-sync-wire',
			gatewaySecret: 'field-ops-sync-wire-gateway',
			founderEmail: 'field-ops-sync-wire-founder@example.test',
			founderClaimId: 'field-ops-sync-wire-founder',
			secretsKey: 'field-ops-sync-wire-secrets',
			host: '0.0.0.0'
		});
		let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
		let throughGateway: import('node:http').IncomingMessage | undefined;
		let direct: import('node:http').IncomingMessage | undefined;
		let fetched: Response | undefined;
		try {
			assert.equal((await fetch(`${session.baseUrl}/readyz`)).status, 200);
			gateway = await startSessionGateway({
				upstream: session.address,
				credential: session.credential,
				cookieName: 'norbital_headed',
				listen: { host: '0.0.0.0' },
				isDocument: isBoltDocument,
				rewritePath: rewriteBoltBrowserPath,
				document: '<html></html>'
			});
			const page = await fetch(`${gateway.baseUrl}/__bolt`);
			const cookie = page.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
			assert.match(cookie, /norbital_headed=/);

			direct = await holdGet(`${session.baseUrl}/sync/stream?connectionId=${CONNECTION_ID}-d`, {
				authorization: `Bearer ${session.credential}`
			});
			assert.equal(direct.statusCode, 200, 'direct stream');
			const directConnect = await fetch(`${session.baseUrl}/sync/connect`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${session.credential}`,
					'content-type': 'application/json',
					'x-bolt-sync-connection': `${CONNECTION_ID}-d`
				},
				body: JSON.stringify({ queries: [], detached: [], pending: [] })
			});
			assert.equal(
				directConnect.status,
				200,
				`direct connect ${directConnect.status}: ${await directConnect.text()}`
			);
			direct.destroy();
			direct = undefined;

			fetched = await fetch(
				`${gateway.baseUrl}/__bolt/sync/stream?connectionId=${CONNECTION_ID}-g`,
				{ headers: { cookie } }
			);
			assert.equal(
				fetched.status,
				200,
				`gateway fetch stream ${fetched.status}: ${fetched.headers.get('content-type')}`
			);
			assert.match(String(fetched.headers.get('content-type')), /text\/event-stream/);
			const gatewayConnect = await fetch(`${gateway.baseUrl}/__bolt/sync/connect`, {
				method: 'POST',
				headers: {
					cookie,
					'content-type': 'application/json',
					'x-bolt-sync-connection': `${CONNECTION_ID}-g`
				},
				body: JSON.stringify({ queries: [], detached: [], pending: [] })
			});
			assert.equal(
				gatewayConnect.status,
				200,
				`gateway connect ${gatewayConnect.status}: ${await gatewayConnect.text()}`
			);
		} finally {
			await fetched?.body?.cancel();
			throughGateway?.destroy();
			direct?.destroy();
			if (gateway !== undefined) await gateway.stop();
			await session.stop();
		}
	}
);
