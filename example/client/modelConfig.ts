import { z } from 'zod'

export const ModelType = z.enum([
	'gpt-4.1-2025-04-14',
	'gemini-pro',
	'gpt-4o-2024-11-20',
	'o4-mini-2025-04-16',
])
export type ModelType = z.infer<typeof ModelType>

export const MODEL_CONFIGS = {
	'gpt-4.1-2025-04-14': {
		name: 'GPT-4.1',
		model: 'gpt-4.1-2025-04-14',
		provider: 'openai',
	},
	'gpt-4o-2024-11-20': {
		name: 'GPT-4o',
		model: 'gpt-4o-2024-11-20',
		provider: 'openai',
	},
	'o4-mini-2025-04-16': {
		name: 'O4 Mini',
		model: 'o4-mini-2025-04-16',
		provider: 'openai',
	},
	'gemini-pro': {
		name: 'Gemini Pro',
		model: 'gemini-pro',
		provider: 'google',
	},
} as const

export type ModelConfig = (typeof MODEL_CONFIGS)[keyof typeof MODEL_CONFIGS]
