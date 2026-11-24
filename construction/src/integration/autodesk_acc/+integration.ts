import { integration } from '@norbital-ai/bolt';

/**
 * Autodesk Platform Services / Construction Cloud (ACC) OAuth 2.0 connection.
 * Syncs large-scale project schedules into `tasks` (`tasks.syncs.autodesk_schedule`) and
 * BIM models/sheets into `project_files` (`project_files.syncs.autodesk_files`).
 */
export default integration('autodesk_acc', {
	description:
		'Autodesk Platform Services / Construction Cloud (ACC) connection for large-scale project schedules and BIM files.',
	driver: 'http',
	oauth: {
		client: 'AUTODESK_CLIENT_ID',
		secret: 'AUTODESK_CLIENT_SECRET',
		authorize: 'https://developer.api.autodesk.com/authentication/v2/authorize',
		token: 'https://developer.api.autodesk.com/authentication/v2/token',
		scopes: ['data:read', 'data:write', 'account:read']
	},
	http: {
		base_url: 'https://developer.api.autodesk.com',
		allow: {
			methods: ['GET', 'POST', 'PATCH'],
			paths: [
				'/project/v1/**',
				'/data/v1/**',
				'/construction/schedule/v1/**',
				'/construction/sheets/v1/**',
				'/modelderivative/v2/**'
			]
		}
	},
	configuration: {
		hub_id: { kind: 'text', optional: true },
		account_id: { kind: 'text', optional: true },
		default_project_id: { kind: 'text', optional: true }
	},
	rate: '10/s',
	test: function* (ctx) {
		yield* ctx.request({ method: 'GET', path: '/project/v1/hubs', output: { kind: 'json' } });
	}
});
