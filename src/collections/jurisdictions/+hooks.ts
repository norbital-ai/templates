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
	create: {
		perRecord: {
			before: {
				description:
					'Validates the atomic statutory snapshot so coverage is coherent, overtime bands do not overlap, and every limit identity is unique.',
				handler: ({ input }) => {
					assertRegime(input.regime, input.currency);
					return input;
				}
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-validates the complete effective-dated regime whenever its currency or nested statutory policy changes.',
				handler: ({ input, existing }) => {
					assertRegime(input.regime ?? existing.regime, input.currency ?? existing.currency);
					return input;
				}
			}
		}
	}
} satisfies Hooks;
