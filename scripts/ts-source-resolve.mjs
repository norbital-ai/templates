import { register } from 'node:module';

// The template's source imports sibling modules with `.js` specifiers; Node's type stripping needs them as `.ts`.
register(new URL('./ts-source-hooks.mjs', import.meta.url));
