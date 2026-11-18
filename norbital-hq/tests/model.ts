/** Native AI ports keep scripted answers and capture the actual prompts/decision requests. */
import { Ai, DecisionResult, Port, type Json } from '@norbital-ai/bolt/engine';
import { Effect, Layer, Predicate, Schema, Stream } from 'effect';

type AiEvent = Stream.Success<ReturnType<Ai['Service']['infer']>>;

const base: Ai['Service'] = {
	maxChoices: undefined,
	models: ['default'],
	catalog: Effect.succeed({ models: [{ id: 'default', label: 'Test' }], default: 'default' }),
	ask: () => Port.unavailable('ai.sys_1', 'No scripted System 1 answer remains.'),
	infer: () => Stream.fromEffect(Port.unavailable('ai', 'fake')),
	embed: () => Port.unavailable('ai.embed')
};

export function scriptedModel(answers: Json[]) {
	const prompts: string[] = [];
	const ports = Layer.succeed(Ai, {
		...base,
		infer: (request) =>
			Stream.unwrap(
				Effect.sync(() => {
					prompts.push(
						request.messages
							.map((message) =>
								typeof message.content === 'string'
									? message.content
									: JSON.stringify(message.content)
							)
							.join('\n')
					);
					const next = answers.shift();
					if (next === undefined) return Stream.fromEffect(Port.unavailable('ai', 'fake'));
					const event: AiEvent = {
						_tag: 'Response',
						response: {
							content: next,
							tool_calls: [],
							finish: 'stop',
							usage: { input: 0, output: 0 }
						}
					};
					return Stream.succeed(event);
				})
			)
	});
	return { prompts, ports };
}

/** Answers each System 2 request from its prompt (`null`: unavailable), capturing the prompts. */
export function answeringModel(answer: (prompt: string) => Json | null) {
	const prompts: string[] = [];
	const ports = Layer.succeed(Ai, {
		...base,
		infer: (request) =>
			Stream.unwrap(
				Effect.sync(() => {
					const prompt = request.messages
						.map((message) =>
							typeof message.content === 'string'
								? message.content
								: JSON.stringify(message.content)
						)
						.join('\n');
					prompts.push(prompt);
					const content = answer(prompt);
					if (content === null) return Stream.fromEffect(Port.unavailable('ai', 'fake'));
					const event: AiEvent = {
						_tag: 'Response',
						response: { content, tool_calls: [], finish: 'stop', usage: { input: 0, output: 0 } }
					};
					return Stream.succeed(event);
				})
			)
	});
	return { prompts, ports };
}

export function scriptedDecision(answers: Json[]) {
	const requests: Parameters<Ai['Service']['ask']>[0][] = [];
	const ports = Layer.succeed(Ai, {
		...base,
		ask: (request) =>
			Effect.gen(function* () {
				requests.push(request);
				const next = answers.shift();
				if (next === undefined)
					return yield* Port.unavailable('ai.sys_1', 'No scripted System 1 answer remains.');
				if (!Predicate.isObject(next))
					return yield* Port.unavailable('ai.sys_1', 'Invalid scripted System 1 answer.');
				return yield* Schema.decodeUnknownEffect(DecisionResult)({
					provider: 'test',
					...next
				}).pipe(Effect.mapError(Port.failure('scriptedDecision')));
			}),
		infer: () => Stream.die(new Error('System 2 must never classify synced CRM items.'))
	});
	return { ports, requests };
}

const EMPTY = {
	scope: { overview: '', definitions: [], implementation_scope: [], data_migration: [] },
	plan: { milestones: [], uat_tests: [], fees: [], decisions: [] },
	profile: { industry: '', description: '', preferences: [] }
};
/** `update_requirements`'s three extractions, answered by prompt; an absent part answers empty. */
export const extraction =
	(answers: { scope?: Json; plan?: Json; profile?: Json }) =>
	(prompt: string): Json | null =>
		prompt.includes('the project overview')
			? (answers.scope ?? EMPTY.scope)
			: prompt.includes('the timeline of milestones')
				? (answers.plan ?? EMPTY.plan)
				: prompt.includes('business nature')
					? (answers.profile ?? EMPTY.profile)
					: null;
