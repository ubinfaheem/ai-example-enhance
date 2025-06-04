'use client'

import type { Editor } from '@tldraw/tldraw'
import { RefObject, useCallback, useEffect, useRef, useState } from 'react'

/* ------------------------------------------------------------------ */
/*  Type declarations                                                   */
/* ------------------------------------------------------------------ */
interface SpeechRecognitionResult {
	transcript: string
	isFinal: boolean
}

interface SpeechRecognitionResultList {
	[index: number]: SpeechRecognitionResult[]
	length: number
}

interface SpeechRecognitionEvent extends Event {
	results: SpeechRecognitionResultList
	resultIndex: number
}

interface SpeechRecognition extends EventTarget {
	continuous: boolean
	interimResults: boolean
	lang: string
	onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null
	start(): void
	stop(): void
}

interface SessionResponse {
	client_secret?: {
		value: string
	}
}

interface WhiteboardResponse {
	instructions?: {
		type: string
		data: any
	}
}

/* ------------------------------------------------------------------ */
/*  Configurable logging helpers                                        */
/* ------------------------------------------------------------------ */
const VERBOSE = process.env.NEXT_PUBLIC_VERBOSE === '1'

const log = (...args: any[]) => VERBOSE && console.log(...args)
const logTool = (...args: any[]) => console.log(...args) // always show tool calls
const logError = (...args: any[]) => console.error(...args)

const API = process.env.NEXT_PUBLIC_API || ''
log('[RTC] API base URL:', API)

/* fetch wrapper (ngrok header for local dev) ----------------------- */
const apiFetch = (url: string, init: RequestInit = {}) =>
	fetch(url, {
		...init,
		headers: {
			'ngrok-skip-browser-warning': 'true',
			...(init.headers || {}),
		},
	})

// Tutor system prompt
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

/* ------------------------------------------------------------------ */
/*  Hook return type                                                    */
/* ------------------------------------------------------------------ */
type Return = {
	connect: (voice: string, modelId: string, sys?: string) => Promise<void>
	disconnect: () => void
	toggleMic: () => void
	isConnected: boolean
	micEnabled: boolean
	transcript: string
	aiSpeaking: boolean
	userSpeaking: boolean
}

/* ==================================================================
   The hook
=================================================================== */
export function useRtc(tldrawRef?: RefObject<Editor | null>): Return {
	/* refs – peer, data-channel, etc. -------------------------------- */
	const pcRef = useRef<RTCPeerConnection | null>(null)
	const dcRef = useRef<RTCDataChannel | null>(null)
	const audioElRef = useRef<HTMLAudioElement | null>(null)
	const micTrack = useRef<MediaStreamTrack | null>(null)
	const lastUser = useRef('')

	/* React state ---------------------------------------------------- */
	const [isConnected, setConn] = useState(false)
	const [micEnabled, setMic] = useState(false)
	const [transcript, setTxt] = useState('')
	const [aiSpeaking, setAiSp] = useState(false)
	const [userSpeaking, setUsrSp] = useState(false)

	/* helper – append / replace transcript lines -------------------- */
	const speaker = useRef<'👤' | '🤖' | null>(null)
	const render = (who: '👤' | '🤖', text: string, done = false) => {
		if (!text.trim()) return
		setTxt((prev) => {
			const lines = prev ? prev.split('\n') : []
			if (who === speaker.current && lines.length) {
				lines[lines.length - 1] = `${who} ${text}`
			} else {
				lines.push(`${who} ${text}`)
				speaker.current = who
			}
			if (done) speaker.current = null
			return lines.join('\n')
		})
		if (who === '👤') lastUser.current = text
	}

	/* toggle mic --------------------------------------------------- */
	const toggleMic = useCallback(() => {
		if (!micTrack.current) return
		micTrack.current.enabled = !micTrack.current.enabled
		setMic(micTrack.current.enabled)
	}, [])

	/* Send transcribed text to GPT-4.1 for whiteboard manipulation --- */
	const sendToGpt41 = async (text: string) => {
		try {
			const response = await fetch(`${API}/whiteboard`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: 'gpt-4.1-2025-04-14',
					messages: [
						{
							role: 'system',
							content:
								'You are a helpful AI that translates natural language into whiteboard drawing instructions.',
						},
						{
							role: 'user',
							content: text,
						},
					],
				}),
			})

			const data = (await response.json()) as WhiteboardResponse
			if (data.instructions && tldrawRef?.current) {
				const { type, data: shapeData } = data.instructions
				const shapeId = shapeData.id || tldrawRef.current.createShape({ type }).id
				tldrawRef.current.updateShape({
					id: shapeId,
					type,
					...shapeData,
				})
			}
		} catch (err) {
			logError('[RTC] GPT-4.1 whiteboard error:', err)
		}
	}

	const initializeTutor = (dc: RTCDataChannel) => {
		// Send session configuration
		dc.send(
			JSON.stringify({
				type: 'session.update',
				session: {
					voice: 'alloy',
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
				},
			})
		)

		// Trigger initial greeting
		dc.send(
			JSON.stringify({
				type: 'response.create',
				response: {
					modalities: ['audio', 'text'],
					instructions:
						'Greet the student warmly and introduce yourself as their tutor who can help them learn while using the whiteboard. Ask what they would like to learn about today.',
				},
			})
		)
	}

	/* cleanup helper ------------------------------------------------- */
	const cleanup = useCallback(() => {
		dcRef.current?.close()
		pcRef.current?.getSenders().forEach((s) => s.track?.stop())
		pcRef.current?.close()

		pcRef.current = null
		dcRef.current = null
		audioElRef.current = null
		micTrack.current = null

		setConn(false)
		setMic(false)
		setAiSp(false)
		setUsrSp(false)
	}, [])

	/* CONNECT ------------------------------------------------------ */
	const connect = async (voice: string, modelId: string, sys?: string) => {
		if (isConnected) return

		try {
			/* 1 ─ get session secret ------------------------------------ */
			const qs = `voice=${voice}&model=${modelId}` + (sys ? `&sys=${encodeURIComponent(sys)}` : '')
			log('[RTC] ➤ fetching session URL →', `${API}/session?${qs}`)
			const ses = (await apiFetch(`${API}/session?${qs}`).then((r) => r.json())) as SessionResponse
			const key = ses?.client_secret?.value

			if (!key) {
				throw new Error('Failed to get session key')
			}

			/* 2 ─ peer connection -------------------------------------- */
			const pc = new RTCPeerConnection({
				iceServers: [
					{ urls: 'stun:stun.l.google.com:19302' },
					{ urls: 'stun:global.stun.twilio.com:3478' },
				],
			})
			pcRef.current = pc

			/* inbound audio -------------------------------------------- */
			audioElRef.current = new Audio()
			audioElRef.current.autoplay = true
			pc.ontrack = (e) => (audioElRef.current!.srcObject = e.streams[0])

			/* 3 ─ mic --------------------------------------------------- */
			const ms = await navigator.mediaDevices.getUserMedia({ audio: true })
			micTrack.current = ms.getAudioTracks()[0]
			micTrack.current.enabled = false // Initialize as disabled
			pc.addTrack(micTrack.current)
			setMic(false)

			/* 4 ─ data-channel ----------------------------------------- */
			const dc = pc.createDataChannel('oai-events')
			dcRef.current = dc

			dc.onopen = () => {
				initializeTutor(dc)
			}

			dc.onmessage = (e: MessageEvent) => {
				let msg: any
				try {
					msg = JSON.parse(e.data)
				} catch {
					return
				}

				log('%c[RTC] msg.type =', 'color:#03a9f4', msg.type)

				switch (msg.type) {
					case 'input_audio_buffer.speech_started':
						setUsrSp(true)
						break
					case 'input_audio_buffer.speech_stopped':
						setUsrSp(false)
						break
					case 'output_audio_buffer.started':
						setAiSp(true)
						break
					case 'output_audio_buffer.stopped':
						setAiSp(false)
						break
					case 'transcript':
						// Handle transcribed text from OpenAI
						if (msg.text) {
							render('👤', msg.text, msg.is_final)
							// When we get final transcription, send to GPT-4.1 for whiteboard
							if (msg.is_final) {
								sendToGpt41(msg.text)
							}
						}
						break
					case 'response':
						// Handle AI response text
						if (msg.text) {
							render('🤖', msg.text, true)
						}
						break
					case 'session.updated':
						log('[RTC] Session configured:', msg.session)
						break
				}
			}

			/* 5 ─ SDP with OpenAI MCU ---------------------------------- */
			await pc.setLocalDescription(await pc.createOffer())
			const ans = await fetch(`https://api.openai.com/v1/realtime?model=${modelId}`, {
				method: 'POST',
				body: pc.localDescription!.sdp,
				headers: {
					Authorization: `Bearer ${key}`,
					'Content-Type': 'application/sdp',
				},
			}).then((r) => r.text())
			await pc.setRemoteDescription({ type: 'answer', sdp: ans })

			setConn(true)
		} catch (err) {
			logError('[RTC] connect error:', err)
			cleanup()
			throw err
		}
	}

	/* DISCONNECT ---------------------------------------------------- */
	const disconnect = () => {
		if (isConnected) cleanup()
	}
	useEffect(() => disconnect, []) // unmount

	return {
		connect,
		disconnect,
		toggleMic,
		isConnected,
		micEnabled,
		transcript,
		aiSpeaking,
		userSpeaking,
	}
}
