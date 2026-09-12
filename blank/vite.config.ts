import { defineConfig } from 'vite';
import { boltPlugin } from '@norbital-ai/bolt/vite';

export default defineConfig({ plugins: [boltPlugin()] });
