import { useCallback, useEffect, useRef, useState } from 'react'
import '../styles/SpeechInterface.css'

interface SpeechRecognitionEvent {
	results: {
		[index: number]: {
			[index: number]: {
				transcript: string
			}
		} & {
			isFinal: boolean
		}
	}
}

interface SpeechRecognitionErrorEvent {
	error: string
}

interface SpeechRecognition extends EventTarget {
	continuous: boolean
	interimResults: boolean
	lang: string
	start(): void
	stop(): void
	onresult: (event: SpeechRecognitionEvent) => void
	onerror: (event: SpeechRecognitionErrorEvent) => void
	onend: () => void
}

export interface SpeechInterfaceProps {
	onSpeechInput: (text: string) => void
	isListening: boolean
	onToggleListening: () => void
	onVoiceChange: (voice: string) => void
	isSpeaking: boolean
	disabled?: boolean
}

// Available OpenAI voices
const AVAILABLE_VOICES = [
	{ id: 'alloy', name: 'Alloy' },
	{ id: 'echo', name: 'Echo' },
	{ id: 'fable', name: 'Fable' },
	{ id: 'onyx', name: 'Onyx' },
	{ id: 'nova', name: 'Nova' },
	{ id: 'shimmer', name: 'Shimmer' },
]

export function SpeechInterface({
	onSpeechInput,
	isListening,
	onToggleListening,
	onVoiceChange,
	isSpeaking,
	disabled = false,
}: SpeechInterfaceProps) {
	const [error, setError] = useState<string>('')
	const [selectedVoice, setSelectedVoice] = useState('alloy')
	const recognitionRef = useRef<SpeechRecognition | null>(null)
	const synthRef = useRef<SpeechSynthesis | null>(null)

	useEffect(() => {
		if (typeof window !== 'undefined') {
			// Initialize speech recognition
			const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
			if (SpeechRecognition) {
				recognitionRef.current = new SpeechRecognition()
				recognitionRef.current.continuous = true
				recognitionRef.current.interimResults = true
				recognitionRef.current.lang = 'en-US'

				recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
					const transcript = Array.from(Object.values(event.results))
						.map((result) => result[0])
						.map((result) => result.transcript)
						.join('')

					if (event.results[0].isFinal) {
						onSpeechInput(transcript)
					}
				}

				recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
					// Handle no-speech differently as it's a common non-critical event
					if (event.error === 'no-speech') {
						console.log('No speech detected, continuing to listen...')
						return
					}

					console.error('Speech recognition error:', event.error)
					setError('Speech recognition error: ' + event.error)
					// Only stop listening for critical errors
					if (event.error !== 'no-speech' && isListening) {
						onToggleListening()
					}
				}

				recognitionRef.current.onend = () => {
					// Clear any previous errors when recognition ends normally
					setError('')

					// If we're supposed to be listening but recognition stopped, restart it
					if (isListening && !isSpeaking) {
						try {
							recognitionRef.current?.start()
						} catch (e) {
							console.error('Failed to restart speech recognition:', e)
							setError('Failed to restart speech recognition')
							onToggleListening()
						}
					}
				}
			} else {
				setError('Speech recognition not supported in this browser')
			}

			// Initialize speech synthesis
			if ('speechSynthesis' in window) {
				synthRef.current = window.speechSynthesis
			} else {
				setError('Speech synthesis not supported in this browser')
			}
		}

		return () => {
			if (recognitionRef.current) {
				try {
					recognitionRef.current.stop()
				} catch (e) {
					console.error('Error stopping speech recognition:', e)
				}
			}
		}
	}, [isListening, isSpeaking, onToggleListening, onSpeechInput])

	useEffect(() => {
		if (recognitionRef.current) {
			try {
				if (isListening && !isSpeaking) {
					recognitionRef.current.start()
				} else {
					recognitionRef.current.stop()
				}
			} catch (e) {
				console.error('Error toggling speech recognition:', e)
				setError('Error toggling speech recognition')
				if (isListening) {
					onToggleListening()
				}
			}
		}
	}, [isListening, isSpeaking, onToggleListening])

	const handleVoiceChange = useCallback(
		(event: React.ChangeEvent<HTMLSelectElement>) => {
			const voice = event.target.value
			setSelectedVoice(voice)
			onVoiceChange(voice)
		},
		[onVoiceChange]
	)

	const speak = useCallback((text: string) => {
		if (synthRef.current) {
			const utterance = new SpeechSynthesisUtterance(text)
			utterance.rate = 1.0 // Normal speed
			utterance.pitch = 1.0 // Normal pitch
			synthRef.current.speak(utterance)
		}
	}, [])

	return (
		<div className="speech-interface">
			<div className="speech-controls">
				<button
					onClick={onToggleListening}
					className={`speech-button ${isListening ? 'listening' : ''} ${isSpeaking ? 'ai-speaking' : ''}`}
					title={isListening ? 'Stop listening' : 'Start listening'}
					disabled={disabled}
				>
					{isSpeaking ? '🔊 AI Speaking...' : isListening ? '🎤 Listening...' : '🎤 Start'}
				</button>

				<select
					value={selectedVoice}
					onChange={handleVoiceChange}
					className="voice-selector"
					disabled={disabled}
				>
					{AVAILABLE_VOICES.map((voice) => (
						<option key={voice.id} value={voice.id}>
							{voice.name}
						</option>
					))}
				</select>
			</div>

			{error && <div className="speech-error">{error}</div>}
		</div>
	)
}

// Add TypeScript declarations for the Web Speech API
declare global {
	interface Window {
		SpeechRecognition: {
			new (): SpeechRecognition
		}
		webkitSpeechRecognition: {
			new (): SpeechRecognition
		}
	}
}
