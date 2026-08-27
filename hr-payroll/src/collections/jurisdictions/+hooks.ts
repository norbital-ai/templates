import { refuse } from '@norbital-ai/bolt/authoring';
import { Result, Schema } from 'effect';
import {
	statutoryRegimeIssues,
	statutoryRegimeSchema
} from '../../datatypes/statutory_regime/+definition.js';
import type { Hooks } from './$types.js';

function assertRegime(regime: unknown, currency: string): void {
	const parsed = Schema.decodeUnknownResult(statutoryRegimeSchema)(regime);
	if (!Result.isSuccess(parsed)) return refuse('The statutory regime is incomplete or malformed.');
	const issues = statutoryRegimeIssues(parsed.success, currency);
	if (issues.length > 0) refuse(issues.join(' '));
}

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Validates the atomic statutory snapshot so coverage is coherent, overtime bands do not overlap, and every limit identity is unique. Re-validated whenever the currency or nested statutory policy changes.',
				handler: ({ input, existing }) => {
					const regime = input.regime ?? existing?.regime;
					const currency = input.currency ?? existing?.currency;
					// A create states both; an edit may restate neither and keep what is stored. `refuse`
					// returns `never`, so the call below sees them narrowed.
					if (regime == null || currency == null)
						refuse('A jurisdiction states its statutory regime and its currency.');
					assertRegime(regime, currency);
					return input;
				}
			}
		}
	}
} satisfies Hooks;
