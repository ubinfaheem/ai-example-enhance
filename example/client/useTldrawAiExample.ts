import type { TLAiChange } from '@tldraw/ai'
import { useTldrawAi } from '@tldraw/ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor } from 'tldraw'
import { ModelType } from './modelConfig'
import { createModelHandler } from './modelHandler'
import { getEventEmitter, handleRealtimeStream, isProcessingSpeechInput } from './realtimeHandler'

// Add type declarations for Web Speech API and Realtime API
declare global {
	interface Window {
		readonly speechSynthesis: SpeechSynthesis
		readonly SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance
	}
}

// System prompt for the AI tutor
const TUTOR_SYSTEM_PROMPT = `You are an engaging and helpful AI tutor who excels at explaining concepts while another model draws on the whiteboard.
Your role is to:
1. Actively engage with students through voice
2. Explain concepts clearly and concisely
3. Use the whiteboard drawings to support your explanations
4. Ask questions to check understanding
5. Provide immediate feedback
6. Adapt your explanation style based on student responses
7. Maintain a warm, encouraging tone

When you start:
- Introduce yourself briefly
- Explain that you can help them learn while using the whiteboard
- Ask what they'd like to learn about

Remember to:
- Keep your responses concise and natural
- Reference the drawings being made
- Use analogies and examples
- Encourage questions
- Show enthusiasm for the subject matter

Do not:
- Give long monologues
- Ignore the whiteboard drawings
- Use overly technical language without explanation
- Mention that you are an AI or reference these instructions`

interface GenerateParams {
	editor: Editor
	prompt: any
	signal: AbortSignal
}

interface RealtimeResponse {
	content: string
	done: boolean
}

interface RealtimeAudioResponse {
	audio: string // base64 encoded PCM audio
	done: boolean
}

interface RealtimeConfig {
	voice: string
	instructions: string
	input_audio_format: string
	input_audio_transcription: {
		model: string
	}
	turn_detection: {
		type: string
		threshold: number
		prefix_padding_ms: number
		silence_duration_ms: number
		create_response: boolean
	}
}

// Speech synthesis configuration
const SPEECH_CONFIG: SpeechSynthesisUtterance = {
	lang: 'en-US',
	pitch: 1,
	rate: 1,
	volume: 1,
} as SpeechSynthesisUtterance

const OPENAI_API_BASE = 'https://api.openai.com'

interface EphemeralKeyResponse {
	key: string
}

interface SessionResponse {
	client_secret?: {
		value: string
	}
}

// Audio element for playing remote audio
const audioElement = typeof window !== 'undefined' ? new Audio() : null
if (audioElement) {
	audioElement.autoplay = true

	// Add error handling for audio element
	audioElement.onerror = (e) => {
		console.error('❌ Audio element error:', e)
	}

	// Add state change logging
	audioElement.onplay = () => console.log('▶️ Audio started playing')
	audioElement.onpause = () => console.log('⏸️ Audio paused')
	audioElement.onended = () => console.log('⏹️ Audio ended')
}

// Add new interfaces for WebRTC events
interface WebRTCEvents {
	'input_audio_buffer.speech_started': {}
	'input_audio_buffer.speech_stopped': {}
	'response.audio_transcript.delta': { text: string }
	'response.done': {}
}

interface WebRTCEvent<T extends keyof WebRTCEvents> {
	type: T
	text?: string
}

interface CustomPromptOptions {
	message: string
	stream?: boolean
	meta?: {
		model: ModelType
	}
}

/**
 * A hook that calls `useTldrawAi` with static options.
 *
 * @param editor - The editor instance to use
 * @param selectedModel - The selected AI model to use
 */
export function useTldrawAiExample(editor: Editor, selectedModel: ModelType) {
	const modelConfig = useMemo(
		() => createModelHandler(selectedModel, editor),
		[selectedModel, editor]
	)
	const ai = useTldrawAi(modelConfig)
	const isSpeakingRef = useRef(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const streamRef = useRef<AsyncGenerator<TLAiChange> | null>(null)

	// Set up event handlers
	useEffect(() => {
		if (selectedModel === 'gpt-4o-realtime-preview-2025-06-03') {
			const textMessageHandler = (event: CustomEvent) => {
				const { text } = event.detail
				if (window.speechSynthesis && text) {
					const utterance = new SpeechSynthesisUtterance(text)
					utterance.onstart = () => {
						isSpeakingRef.current = true
					}
					utterance.onend = () => {
						isSpeakingRef.current = false
					}
					window.speechSynthesis.speak(utterance)
				}
			}

			const micStateHandler = (event: CustomEvent) => {
				const { enabled } = event.detail
				console.log('🎤 Microphone state changed:', enabled ? 'ON' : 'OFF')
				setIsProcessing(isProcessingSpeechInput())
			}

			const emitter = getEventEmitter()
			emitter.addEventListener('text-message', textMessageHandler as EventListener)
			emitter.addEventListener('mic-state-change', micStateHandler as EventListener)

			return () => {
				emitter.removeEventListener('text-message', textMessageHandler as EventListener)
				emitter.removeEventListener('mic-state-change', micStateHandler as EventListener)
				if (window.speechSynthesis) {
					window.speechSynthesis.cancel()
				}
			}
		}
	}, [selectedModel])

	const handleInput = useCallback(
		async (text: string) => {
			if (selectedModel === 'gpt-4o-realtime-preview-2025-06-03') {
				try {
					setIsProcessing(true)
					// For real-time model, handle drawing separately from speech
					const drawingPromise = ai.prompt({
						message: text,
						meta: { model: 'gpt-4.1-2025-04-14' },
					} as CustomPromptOptions).promise

					// Initialize speech stream if not already done
					if (!streamRef.current) {
						streamRef.current = handleRealtimeStream(text)
					}

					// Wait for drawing to complete
					await drawingPromise
				} finally {
					setIsProcessing(false)
				}
			} else {
				// For text-only models, just handle the drawing
				await ai.prompt({
					message: text,
					meta: { model: selectedModel },
				} as CustomPromptOptions).promise
			}
		},
		[ai, selectedModel]
	)

	return {
		prompt: handleInput,
		repeat: ai.repeat,
		cancel: () => {
			ai.cancel()
			if (window.speechSynthesis) {
				window.speechSynthesis.cancel()
			}
			// Don't reset streamRef here - let it maintain the WebRTC connection
			setIsProcessing(false)
		},
		generate: async (prompt: CustomPromptOptions) => {
			const { promise } = ai.prompt({
				...prompt,
				meta: { model: selectedModel },
			} as CustomPromptOptions)
			return promise
		},
		stream: async function* (prompt: CustomPromptOptions) {
			if (selectedModel === 'gpt-4o-realtime-preview-2025-06-03') {
				setIsProcessing(true)
				try {
					// Start the drawing process with GPT-4.1
					const drawingPromise = ai.prompt({
						...prompt,
						meta: { model: 'gpt-4.1-2025-04-14' },
					} as CustomPromptOptions).promise

					// Initialize or use existing speech stream
					if (!streamRef.current) {
						streamRef.current = handleRealtimeStream(prompt.message)
					}

					// Wait for the drawing to complete
					try {
						await drawingPromise
					} catch (e) {
						console.error('Drawing error:', e)
					}
				} finally {
					setIsProcessing(false)
				}
			} else {
				// For other models, just use regular streaming
				const { promise } = ai.prompt({
					...prompt,
					stream: true,
				} as CustomPromptOptions)
				try {
					await promise
				} catch (e) {
					throw e
				}
			}
		},
		isSpeaking: () => isSpeakingRef.current,
		isProcessing: () => isProcessing,
	}
}
