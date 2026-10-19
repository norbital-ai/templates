import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { decodeWorkOrders } from '../src/lib/work-order-sheet.js';

it.live('rejects a malformed calendar day before the work-order write', () =>
	Effect.gen(function* () {
		expect(
			yield* Effect.flip(
				decodeWorkOrders([{ site: '1 Nowhere Rd', scheduled_for: '2026-13-40', title: 'Survey' }])
			)
		).toMatchObject({ _tag: 'SheetInvalid' });
	})
);
