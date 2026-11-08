import { Schema } from 'effect';

const Connection = Schema.Struct({
	state: Schema.String,
	databaseVerified: Schema.optionalKey(Schema.Boolean)
});
export function kingdeeConnectionStatus(instance: { active: boolean; status: unknown }) {
	if (!instance.active || !Schema.is(Connection)(instance.status)) return 'off';
	switch (instance.status.state) {
		case 'connected':
			return instance.status.databaseVerified === true ? 'connected' : 'off';
		case 'error':
			return 'connection_error';
		default:
			return 'off';
	}
}
