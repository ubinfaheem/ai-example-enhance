import { TLAiChange } from '@tldraw/ai'

// Logging configuration
const VERBOSE = true
const log = (...args: any[]) => VERBOSE && console.log(...args)
const logSpeech = (...args: any[]) => console.log('🎤', ...args)
const logAI = (...args: any[]) => console.log('🤖', ...args)
const logError = (...args: any[]) => console.error('❌', ...args)
const logRTC = (...args: any[]) => console.log('📡', ...args)

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
- Show enthusiasm for the subject matter`

interface RealtimeConfig {
	voice: string
	instructions: string
	input_audio_format: string
	input_audio_transcription: {
		model: string
		language: string
		return_text: boolean
	}
	turn_detection: {
		type: string
		threshold: number
		prefix_padding_ms: number
		silence_duration_ms: number
		create_response: boolean
	}
}

interface SessionResponse {
	client_secret?: {
		value: string
	}
}

// Event emitter for text messages and mic state
const eventEmitter = new EventTarget()

// Keep track of the current RTCPeerConnection and state
let currentPeerConnection: RTCPeerConnection | null = null
let currentDataChannel: RTCDataChannel | null = null
let micStream: MediaStream | null = null
let micTrack: MediaStreamTrack | null = null
let isProcessingSpeech = false

// Function to emit mic state change
const emitMicStateChange = (enabled: boolean) => {
	eventEmitter.dispatchEvent(
		new CustomEvent('mic-state-change', {
			detail: { enabled },
		})
	)
}

// API configuration
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5177'

export async function* handleRealtimeStream(
	prompt: string,
	voice = 'alloy',
	modelId = 'gpt-4o-realtime-preview-2025-06-03'
): AsyncGenerator<TLAiChange> {
	// If there's already an active connection, just send the new prompt
	if (currentDataChannel && currentDataChannel.readyState === 'open' && currentPeerConnection) {
		logSpeech('Using existing connection to send prompt')
		currentDataChannel.send(
			JSON.stringify({
				type: 'conversation.item.create',
				item: {
					role: 'user',
					content: prompt,
				},
			})
		)
		return // Return empty generator as we're just sending a message
	}

	logRTC('Starting real-time stream with:', { voice, modelId })
	logSpeech('Initial prompt:', prompt)

	// Create RTCPeerConnection
	const peerConnection = new RTCPeerConnection({
		iceServers: [
			{ urls: 'stun:stun.l.google.com:19302' },
			{ urls: 'stun:global.stun.twilio.com:3478' },
		],
	})
	currentPeerConnection = peerConnection

	try {
		// Get microphone access if not already available
		if (!micStream || !micTrack) {
			try {
				logSpeech('Requesting microphone access...')
				micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
				micTrack = micStream.getAudioTracks()[0]
				micTrack.enabled = true // Start with mic on since user initiated
				peerConnection.addTrack(micTrack, micStream)
				logSpeech('Microphone access granted and enabled')
				emitMicStateChange(true)
			} catch (err) {
				logError('Microphone access denied:', err)
				throw new Error('Microphone access is required for real-time interaction')
			}
		} else {
			// Reuse existing microphone track
			peerConnection.addTrack(micTrack, micStream)
			logSpeech('Reusing existing microphone')
		}

		// Get session key
		logRTC('Getting session key...')
		const sessionResponse = (await fetch(`${API_BASE}/session`, {
			headers: { 'Content-Type': 'application/json' },
		}).then((r) => r.json())) as SessionResponse

		const key = sessionResponse?.client_secret?.value
		if (!key) {
			throw new Error('Failed to get session key')
		}
		logRTC('Got session key')

		// Create data channel
		currentDataChannel = peerConnection.createDataChannel('oai-events', {
			ordered: true,
		})
		logRTC('Created data channel')

		// Set up data channel handlers
		await new Promise<void>((resolve, reject) => {
			if (!currentDataChannel) {
				reject(new Error('Failed to create data channel'))
				return
			}

			currentDataChannel.onopen = () => {
				logRTC('Data channel opened')

				// Initialize session
				const config: RealtimeConfig = {
					voice,
					instructions: TUTOR_SYSTEM_PROMPT,
					input_audio_format: 'pcm16',
					input_audio_transcription: {
						model: 'whisper-1',
						language: 'en',
						return_text: true,
					},
					turn_detection: {
						type: 'server_vad',
						threshold: 0.5,
						prefix_padding_ms: 300,
						silence_duration_ms: 200,
						create_response: true,
					},
				}

				if (currentDataChannel && currentDataChannel.readyState === 'open') {
					logRTC('Sending session configuration')
					currentDataChannel.send(
						JSON.stringify({
							type: 'session.update',
							session: config,
						})
					)

					// Send initial prompt
					logSpeech('Sending initial prompt to AI')
					currentDataChannel.send(
						JSON.stringify({
							type: 'conversation.item.create',
							item: {
								role: 'user',
								content: prompt,
							},
						})
					)
				}
				resolve()
			}

			currentDataChannel.onmessage = (event) => {
				try {
					const msg = JSON.parse(event.data)
					log('Received message type:', msg.type)

					switch (msg.type) {
						case 'input_audio_buffer.speech_started':
							isProcessingSpeech = true
							logSpeech('Speech detected, processing...')
							break
						case 'input_audio_buffer.speech_stopped':
							isProcessingSpeech = false
							logSpeech('Speech processing complete')
							break
						case 'transcript':
							logSpeech('Transcribed:', msg.text)
							break
						case 'text':
						case 'response':
							logAI('Response:', msg.text)
							eventEmitter.dispatchEvent(
								new CustomEvent('text-message', {
									detail: { text: msg.text },
								})
							)
							break
						case 'error':
							logError('OpenAI error:', msg.error)
							break
					}
				} catch (error) {
					logError('Error processing message:', error)
				}
			}

			currentDataChannel.onerror = (error) => {
				logError('Data channel error:', error)
				reject(error)
			}

			currentDataChannel.onclose = () => {
				logRTC('Data channel closed')
			}
		})

		// Create and set local description
		const offer = await peerConnection.createOffer()
		await peerConnection.setLocalDescription(offer)
		logRTC('Created and set local description')

		// Get answer from OpenAI MCU
		logRTC('Getting answer from OpenAI MCU...')
		const answer = await fetch('https://api.openai.com/v1/realtime', {
			method: 'POST',
			body: peerConnection.localDescription!.sdp,
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/sdp',
			},
		}).then((r) => r.text())
		logRTC('Got answer from OpenAI MCU')

		// Set remote description
		await peerConnection.setRemoteDescription({ type: 'answer', sdp: answer })
		logRTC('Set remote description')

		// Handle incoming changes
		while (currentDataChannel && currentDataChannel.readyState === 'open') {
			const change = await new Promise<TLAiChange>((resolve, reject) => {
				if (!currentDataChannel) {
					reject(new Error('Data channel closed'))
					return
				}

				currentDataChannel.onmessage = (event) => {
					try {
						const msg = JSON.parse(event.data)
						if (msg.type === 'whiteboard' && msg.changes) {
							resolve(msg.changes as TLAiChange)
						}
					} catch (error) {
						logError('Error processing whiteboard message:', error)
					}
				}
			})
			yield change
		}
	} catch (error) {
		logError('Realtime stream error:', error)
		cleanup() // Only cleanup on error
		throw error
	}

	// Note: We don't cleanup in the finally block anymore
	// The connection should persist for subsequent prompts
}

// Cleanup function
const cleanup = () => {
	if (micTrack) {
		micTrack.stop()
		micTrack = null
	}
	if (micStream) {
		micStream.getTracks().forEach((track) => track.stop())
		micStream = null
	}
	if (currentDataChannel) {
		currentDataChannel.close()
		currentDataChannel = null
	}
	if (currentPeerConnection) {
		currentPeerConnection.close()
		currentPeerConnection = null
	}
	isProcessingSpeech = false
	emitMicStateChange(false)
	logRTC('Cleaned up WebRTC connections')
}

// Function to toggle microphone
export const toggleMicrophone = (): boolean => {
	if (!currentPeerConnection || !micTrack) {
		logError('No active connection or microphone track')
		return false
	}

	if (isProcessingSpeech) {
		logSpeech('Cannot toggle microphone while processing speech')
		return micTrack.enabled
	}

	micTrack.enabled = !micTrack.enabled
	logSpeech(micTrack.enabled ? 'Microphone enabled' : 'Microphone disabled')
	emitMicStateChange(micTrack.enabled)
	return micTrack.enabled
}

// Function to check if microphone is enabled
export const isMicrophoneEnabled = (): boolean => {
	return micTrack?.enabled || false
}

// Function to check if speech is being processed
export const isProcessingSpeechInput = (): boolean => {
	return isProcessingSpeech
}

// Export the event emitter for components that need to listen for events
export const getEventEmitter = () => eventEmitter
