import { Editor } from 'tldraw'
import { ModelType } from './modelConfig'
import {
	getEventEmitter,
	handleRealtimeStream,
	isMicrophoneEnabled,
	toggleMicrophone,
} from './realtimeHandler'
import { ShapeDescriptions, SimpleCoordinates, SimpleIds } from './transforms'

// Logging configuration
const logGPT = (...args: any[]) => console.log('🎨', ...args)
const logError = (...args: any[]) => console.error('❌', ...args)

interface GenerateParams {
	editor: Editor
	prompt: any
	signal: AbortSignal
}

interface GenerateResponse {
	changes: any // You might want to make this more specific based on your needs
}

async function handleDrawingWithGPT41(prompt: any, signal: AbortSignal) {
	try {
		logGPT('Sending prompt to GPT-4.1:', prompt)
		const res = await fetch('/generate', {
			method: 'POST',
			body: JSON.stringify({
				...prompt,
				meta: {
					model: 'gpt-4.1-2025-04-14',
				},
			}),
			headers: {
				'Content-Type': 'application/json',
			},
			signal,
		})

		if (!res.ok) {
			throw new Error(`Generate request failed: ${res.statusText}`)
		}

		const result = (await res.json()) as GenerateResponse
		logGPT('Received changes from GPT-4.1:', result.changes)
		return result.changes
	} catch (err) {
		logError('Drawing generation error:', err)
		throw err
	}
}

export function createModelHandler(model: ModelType, editor: Editor) {
	// Base configuration for all models
	const baseConfig = {
		editor,
		transforms: [SimpleIds, ShapeDescriptions, SimpleCoordinates],
	}

	// Model-specific handlers
	const handlers = {
		'gpt-4.1-2025-04-14': {
			generate: async ({ prompt, signal }: GenerateParams) => {
				logGPT('Using GPT-4.1 for drawing')
				return handleDrawingWithGPT41(prompt, signal)
			},
		},
		'gpt-4o-2024-11-20': {
			generate: async ({ prompt, signal }: GenerateParams) => {
				logGPT('Using GPT-4.1 for drawing (GPT-4o fallback)')
				return handleDrawingWithGPT41(prompt, signal)
			},
		},
		'o4-mini-2025-04-16': {
			generate: async ({ prompt, signal }: GenerateParams) => {
				logGPT('Using GPT-4.1 for drawing (O4-mini fallback)')
				return handleDrawingWithGPT41(prompt, signal)
			},
		},
		'gemini-pro': {
			generate: async ({ prompt, signal }: GenerateParams) => {
				logGPT('Using GPT-4.1 for drawing (Gemini fallback)')
				return handleDrawingWithGPT41(prompt, signal)
			},
		},
		'gpt-4o-realtime-preview-2025-06-03': {
			generate: async ({ prompt, signal }: GenerateParams) => {
				logGPT('Using GPT-4.1 for drawing (Real-time mode)')
				return handleDrawingWithGPT41(prompt, signal)
			},
			stream: async function* ({ prompt, signal }: GenerateParams) {
				// Set up event handling
				const eventHandler = (event: CustomEvent) => {
					const { text } = event.detail
					// Handle text message (e.g., update UI, play speech)
					console.log('🗣️ Text message received:', text)
				}

				const micStateHandler = (event: CustomEvent) => {
					const { enabled } = event.detail
					console.log('🎤 Microphone state changed:', enabled ? 'ON' : 'OFF')
				}

				// Add event listeners
				const emitter = getEventEmitter()
				emitter.addEventListener('text-message', eventHandler as EventListener)
				emitter.addEventListener('mic-state-change', micStateHandler as EventListener)

				try {
					// Handle drawing stream with voice and model settings
					yield* handleRealtimeStream(
						prompt.message,
						prompt.meta?.voice || 'alloy',
						prompt.meta?.model || 'gpt-4o-realtime-preview-2025-06-03'
					)
				} finally {
					// Clean up event listeners
					emitter.removeEventListener('text-message', eventHandler as EventListener)
					emitter.removeEventListener('mic-state-change', micStateHandler as EventListener)
				}
			},
			// Export microphone controls
			toggleMic: toggleMicrophone,
			isMicEnabled: isMicrophoneEnabled,
		},
	}

	return {
		...baseConfig,
		...handlers[model],
	}
}
