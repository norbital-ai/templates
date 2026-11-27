import { Option, Schema } from 'effect';

const ClassifierConfigSchema = Schema.Struct({
	mode: Schema.Literals(['smart', 'all', 'off']),
	instructions: Schema.optionalKey(Schema.String),
	disabled_automations: Schema.optionalKey(Schema.Array(Schema.String))
});

export type ClassifierConfig = typeof ClassifierConfigSchema.Type;

export const readClassifier = (value: unknown): ClassifierConfig =>
	Option.getOrElse(Schema.decodeUnknownOption(ClassifierConfigSchema)(value), () => ({
		mode: 'smart' as const
	}));

export const allowsAutomation = (value: unknown, automation: string): boolean => {
	const cfg = readClassifier(value);
	if (cfg.mode === 'off') return false;
	return !(cfg.disabled_automations ?? []).includes(automation);
};
