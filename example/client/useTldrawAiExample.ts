import { TLAiChange, TLAiResult, useTldrawAi } from '@tldraw/ai'
import { Editor } from 'tldraw'
import { ModelType } from './modelConfig'
import { ShapeDescriptions, SimpleCoordinates, SimpleIds } from './transforms/index'

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

// Audio element for playing remote audio
const audioElement = typeof window !== 'undefined' ? new Audio() : null
if (audioElement) {
	audioElement.autoplay = true
}

/**
 * A hook that calls `useTldrawAi` with static options.
 *
 * @param editor - The editor instance to use
 * @param selectedModel - The selected AI model to use
 */
export function useTldrawAiExample(editor: Editor, selectedModel: ModelType) {
	const ai = useTldrawAi({
		editor,
		transforms: [SimpleIds, ShapeDescriptions, SimpleCoordinates],
		generate: async ({ editor, prompt, signal }: GenerateParams) => {
			try {
				// Add error handling for image generation
				if (!prompt.image) {
					console.log('No image in prompt, proceeding without image')
				}

				const res = await fetch('/generate', {
					method: 'POST',
					body: JSON.stringify({
						...prompt,
						meta: {
							// Always use GPT-4.1 for drawing
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

				const result: TLAiResult = await res.json()
				return result.changes
			} catch (err) {
				console.error('Generate error:', err)
				if (err instanceof Error && err.message.includes('Could not construct image')) {
					// If image construction fails, try again without the image
					console.log('Retrying without image...')
					const res = await fetch('/generate', {
						method: 'POST',
						body: JSON.stringify({
							...prompt,
							image: undefined,
							meta: {
								// Always use GPT-4.1 for drawing
								model: 'gpt-4.1-2025-04-14',
							},
						}),
						headers: {
							'Content-Type': 'application/json',
						},
						signal,
					})

					if (!res.ok) {
						throw new Error(`Generate retry failed: ${res.statusText}`)
					}

					const result: TLAiResult = await res.json()
					return result.changes
				}
				throw err
			}
		},
		stream: async function* ({ editor, prompt, signal }: GenerateParams) {
			// For the realtime model, we don't yield any changes here
			// Instead, we handle it in the custom stream function
			if (selectedModel === 'gpt-4o-realtime-preview-2025-06-03') {
				return []
			}

			const res = await fetch('/stream', {
				method: 'POST',
				body: JSON.stringify({ ...prompt, meta: { model: selectedModel } }),
				headers: {
					'Content-Type': 'application/json',
				},
				signal,
			})

			if (!res.body) {
				throw Error('No body in response')
			}

			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			let buffer = ''

			try {
				while (true) {
					const { value, done } = await reader.read()
					if (done) break

					buffer += decoder.decode(value, { stream: true })
					const events = buffer.split('\n\n')
					buffer = events.pop() || ''

					for (const event of events) {
						const match = event.match(/^data: (.+)$/m)
						if (match) {
							try {
								const parsed = JSON.parse(match[1])
								yield parsed as TLAiChange
							} catch (err) {
								console.error(err)
								throw Error(`JSON parsing error: ${match[1]}`)
							}
						}
					}
				}
			} finally {
				reader.releaseLock()
			}
		},
	})

	const handleRealtimeStream = async function* (prompt: string) {
		console.log('🎙️ Starting realtime stream with prompt:', prompt)
		try {
			// First, get an ephemeral key
			console.log('🔑 Requesting ephemeral key...')
			const ephemeralKeyRes = await fetch('/api/ephemeral-key', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					ttl_seconds: 60, // Key expires in 1 minute
				}),
			})

			if (!ephemeralKeyRes.ok) {
				const error = await ephemeralKeyRes.text()
				console.error('❌ Failed to get ephemeral key:', error)
				throw new Error('Failed to get ephemeral key')
			}

			const data = (await ephemeralKeyRes.json()) as EphemeralKeyResponse
			const ephemeralKey = data.key

			if (!ephemeralKey) {
				console.error('❌ No key in response')
				throw new Error('No key in response')
			}

			console.log('✅ Successfully got ephemeral key')

			// Initialize WebRTC connection
			console.log('🔄 Initializing WebRTC connection...')
			const pc = new RTCPeerConnection({
				iceServers: [
					{ urls: 'stun:stun.l.google.com:19302' },
					{ urls: 'stun:global.stun.twilio.com:3478' },
				],
			})

			// Set up ICE candidate handling
			pc.onicecandidate = (event) => {
				if (event.candidate) {
					console.log('🧊 New ICE candidate:', event.candidate.type)
				}
			}

			pc.oniceconnectionstatechange = () => {
				console.log('🔄 ICE connection state changed to:', pc.iceConnectionState)
			}

			// Set up audio element for remote audio playback
			if (audioElement) {
				pc.ontrack = (event) => {
					audioElement.srcObject = event.streams[0]
				}
			}

			// Set up local audio input
			try {
				const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
				mediaStream.getTracks().forEach((track) => {
					pc.addTrack(track, mediaStream)
				})
			} catch (err) {
				console.error('Failed to get microphone access:', err)
				throw new Error('Microphone access required')
			}

			// Create data channel
			console.log('📡 Creating data channel...')
			const dc = pc.createDataChannel('oai-events', {
				ordered: true,
			})

			// Create a promise to handle messages
			const messageQueue: Array<{ type: string; text: string }> = []
			let resolveNext: ((value: { type: string; text: string } | undefined) => void) | null = null

			dc.onopen = () => {
				console.log('✅ Data channel opened')
				// Send session configuration
				console.log('📝 Sending session configuration...')
				dc.send(
					JSON.stringify({
						type: 'session.update',
						session: {
							voice: 'alloy',
							instructions: TUTOR_SYSTEM_PROMPT,
							input_audio_format: 'pcm16',
							input_audio_transcription: {
								model: 'whisper-1',
							},
							turn_detection: {
								type: 'server_vad',
								threshold: 0.5,
								prefix_padding_ms: 300,
								silence_duration_ms: 200,
								create_response: true,
							},
							output_audio: {
								enable_chunking: true,
								chunk_size_ms: 500,
							},
						},
					})
				)

				// Send initial prompt
				console.log('💬 Sending initial prompt:', prompt)
				dc.send(
					JSON.stringify({
						type: 'conversation.item.create',
						item: {
							role: 'user',
							content: prompt,
						},
					})
				)
			}

			dc.onmessage = (event) => {
				try {
					const msg = JSON.parse(event.data)
					console.log('📥 Received message type:', msg.type)
					if (msg.type === 'response.audio_transcript.delta' && msg.text) {
						console.log('🗣️ Received transcript:', msg.text)
						const response = { type: 'text', text: msg.text }
						if (resolveNext) {
							resolveNext(response)
							resolveNext = null
						} else {
							messageQueue.push(response)
						}
					}
				} catch (err) {
					console.error('❌ Error handling message:', err)
				}
			}

			dc.onerror = (error) => {
				console.error('❌ Data channel error:', error)
			}

			dc.onclose = () => {
				console.log('🔒 Data channel closed')
			}

			// Create and send offer
			console.log('📤 Creating WebRTC offer...')
			const offer = await pc.createOffer({
				offerToReceiveAudio: true,
			})
			await pc.setLocalDescription(offer)

			// Get answer from OpenAI
			console.log('🤖 Getting answer from OpenAI...')
			const res = await fetch(
				`${OPENAI_API_BASE}/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${ephemeralKey}`,
						'Content-Type': 'application/sdp',
					},
					body: pc.localDescription!.sdp,
				}
			)

			if (!res.ok) {
				const error = await res.text()
				console.error('❌ Failed to get WebRTC answer:', error)
				throw new Error('Failed to get WebRTC answer from OpenAI')
			}

			const answer = await res.text()
			console.log('✅ Received WebRTC answer, setting remote description...')
			await pc.setRemoteDescription({ type: 'answer', sdp: answer })

			// Yield messages as they come in
			try {
				console.log('🔄 Starting message processing loop...')
				while (true) {
					const nextMessage = messageQueue.shift()
					if (nextMessage) {
						console.log('📤 Yielding message:', nextMessage)
						yield nextMessage
					} else {
						// Wait for the next message
						console.log('⏳ Waiting for next message...')
						const message = await new Promise<{ type: string; text: string } | undefined>(
							(resolve) => {
								resolveNext = resolve
								// Add timeout to avoid infinite wait
								setTimeout(() => {
									console.log('⚠️ Message wait timeout')
									resolve(undefined)
								}, 10000)
							}
						)
						if (message) {
							console.log('📤 Yielding message from wait:', message)
							yield message
						}
					}
				}
			} finally {
				// Cleanup
				console.log('🧹 Cleaning up WebRTC connection...')
				dc.close()
				pc.close()
				// Cleanup audio resources
				if (audioElement) {
					audioElement.srcObject = null
				}
			}
		} catch (err) {
			console.error('❌ Realtime streaming error:', err)
			// Cleanup audio resources
			if (audioElement) {
				audioElement.srcObject = null
			}
			throw err
		}
	}

	return {
		prompt: ai.prompt,
		repeat: ai.repeat,
		cancel: ai.cancel,
		generate: async (prompt: any) => {
			const { promise } = ai.prompt({
				...prompt,
				meta: { model: 'gpt-4.1-2025-04-14' },
			})
			return promise
		},
		stream: async function* (prompt: any) {
			if (selectedModel === 'gpt-4o-realtime-preview-2025-06-03') {
				// First, immediately start the drawing process with GPT-4.1
				const drawingPromise = ai.prompt({
					...prompt,
					meta: { model: 'gpt-4.1-2025-04-14' },
				}).promise

				// Start the realtime speech stream
				try {
					for await (const chunk of handleRealtimeStream(prompt.message)) {
						yield chunk
					}
				} catch (e) {
					console.error('Speech streaming error:', e)
				}

				// Wait for the drawing to complete
				try {
					await drawingPromise
				} catch (e) {
					console.error('Drawing error:', e)
				}
			} else {
				// For other models, just use regular streaming
				const { promise } = ai.prompt({ ...prompt, stream: true })
				try {
					await promise
				} catch (e) {
					throw e
				}
			}
		},
	}
}
