import { Schema } from 'effect';
const MaskedField = Schema.Struct({ $masked: Schema.Literal(true) });
export const isMasked = Schema.is(MaskedField);
