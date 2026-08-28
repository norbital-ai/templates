// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	LEAVE_CERTIFICATE_MISMATCH,
	certificatePolicyIssues,
	certificatePolicyMismatchMessage
} from './certificate-policy.js';

describe('leave certificate policy', () => {
	it('refuses a certificate on a non-time-off event', () => {
		for (const eventKind of ['BALANCE_ADJUSTMENT', 'ENCASHMENT']) {
			assert.deepEqual(
				certificatePolicyIssues({
					eventKind,
					certificateFile: { storage_key: 'certificates/example.pdf' }
				}),
				['A certificate can only be attached to a time-off request.']
			);
		}
	});

	it('accepts evidence on time off and an empty certificate on every event arm', () => {
		assert.deepEqual(
			certificatePolicyIssues({
				eventKind: 'TIME_OFF',
				certificateFile: { storage_key: 'certificates/example.pdf' }
			}),
			[]
		);
		for (const eventKind of ['TIME_OFF', 'BALANCE_ADJUSTMENT', 'ENCASHMENT']) {
			assert.deepEqual(certificatePolicyIssues({ eventKind, certificateFile: null }), []);
		}
	});

	it('names the server refusal', () => {
		assert.equal(LEAVE_CERTIFICATE_MISMATCH, 'LEAVE_CERTIFICATE_MISMATCH');
		assert.match(
			certificatePolicyMismatchMessage(['A certificate can only be attached to time off.']),
			/^LEAVE_CERTIFICATE_MISMATCH: /
		);
	});
});
