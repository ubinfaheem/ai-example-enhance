import { z } from 'zod'

export const ModelType = z.enum([
	'gpt-4.1-2025-04-14',
	'gemini-pro',
	'gpt-4o-2024-11-20',
	'o4-mini-2025-04-16',
	'gpt-4o-mini-realtime-preview-2024-12-17',
	'gpt-4o-realtime-preview-2024-12-17',
])
export type ModelType = z.infer<typeof ModelType>

export const MODEL_CONFIGS = {
	'gpt-4.1-2025-04-14': {
		name: 'GPT-4.1',
		supportsAudio: false,
		supportsRealtime: false,
	},
	'gpt-4o-2024-11-20': {
		name: 'GPT-4 Turbo',
		supportsAudio: false,
		supportsRealtime: false,
	},
	'o4-mini-2025-04-16': {
		name: 'GPT-4 Mini',
		supportsAudio: false,
		supportsRealtime: false,
	},
	'gemini-pro': {
		name: 'Gemini Pro',
		supportsAudio: false,
		supportsRealtime: false,
	},
	'gpt-4o-realtime-preview-2024-12-17': {
		name: 'GPT-4 Realtime',
		supportsAudio: true,
		supportsRealtime: true,
	},
	'gpt-4o-mini-realtime-preview-2024-12-17': {
		name: 'GPT-4 Mini Realtime',
		supportsAudio: true,
		supportsRealtime: true,
	},
} as const

export type ModelConfig = (typeof MODEL_CONFIGS)[keyof typeof MODEL_CONFIGS]
