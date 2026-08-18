import { refuse } from '@norbital-ai/bolt/authoring';
import { Result, Schema } from 'effect';
import {
	statutoryRegimeIssues,
	statutoryRegimeSchema
} from '../../custom-types/statutory_regime/+definition.js';
import type { Hooks } from './$types.js';

function assertRegime(regime: unknown, currency: string): void {
	const parsed = Schema.decodeUnknownResult(statutoryRegimeSchema)(regime);
	if (!Result.isSuccess(parsed)) return refuse('The statutory regime is incomplete or malformed.');
	const issues = statutoryRegimeIssues(parsed.success, currency);
	if (issues.length > 0) refuse(issues.join(' '));
}

export default {
	create: {
		before: {
			description:
				'Validates the atomic statutory snapshot so coverage is coherent, overtime bands do not overlap, and every limit identity is unique.',
			handler: async ({ input }) => {
				assertRegime(input.regime, input.currency);
				return input;
			}
		}
	},
	update: {
		before: {
			description:
				'Re-validates the complete effective-dated regime whenever its currency or nested statutory policy changes.',
			handler: async ({ input, existing }) => {
				assertRegime(input.regime ?? existing.regime, input.currency ?? existing.currency);
				return input;
			}
		}
	}
} satisfies Hooks;
