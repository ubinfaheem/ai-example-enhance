import { TLAiChange } from '@tldraw/ai'
import { TldrawAiBaseService } from '../TldrawAiBaseService'

// Custom change types for the realtime service
interface TLAiThinkChange {
	type: 'think'
	description: string
}

interface TLAiSpeakChange {
	type: 'speak'
	description: string
}

type RealtimeAiChange = TLAiChange | TLAiThinkChange | TLAiSpeakChange

export class RealtimeService extends TldrawAiBaseService {
	private static REALTIME_ENDPOINT = 'v1/realtime'
	private static MODEL_NAME = 'gpt-4o-realtime-preview-2025-06-03'

	async *stream(prompt: any): AsyncGenerator<RealtimeAiChange> {
		const response = await fetch(RealtimeService.REALTIME_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
			},
			body: JSON.stringify({
				model: RealtimeService.MODEL_NAME,
				messages: [
					{
						role: 'system',
						content:
							'You are a helpful tutor assisting students with their learning through interactive whiteboard sessions. You can speak to the student and guide them while other models handle the drawing on the whiteboard.',
					},
					{
						role: 'user',
						content: prompt.message,
					},
				],
				stream: true,
				functions: [
					{
						name: 'drawOnWhiteboard',
						description: 'Request to draw something on the whiteboard',
						parameters: {
							type: 'object',
							properties: {
								description: {
									type: 'string',
									description: 'Description of what to draw',
								},
							},
							required: ['description'],
						},
					},
					{
						name: 'speakToStudent',
						description: 'Speak to the student using text-to-speech',
						parameters: {
							type: 'object',
							properties: {
								message: {
									type: 'string',
									description: 'Message to speak to the student',
								},
							},
							required: ['message'],
						},
					},
				],
			}),
		})

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`)
		}

		const reader = response.body?.getReader()
		if (!reader) throw new Error('No reader available')

		const decoder = new TextDecoder()
		let buffer = ''

		try {
			while (true) {
				const { value, done } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split('\n')
				buffer = lines.pop() || ''

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(5)
						if (data === '[DONE]') continue

						try {
							const parsed = JSON.parse(data)
							if (parsed.choices?.[0]?.delta?.function_call) {
								const functionCall = parsed.choices[0].delta.function_call

								if (functionCall.name === 'drawOnWhiteboard') {
									// Forward the drawing request to other models
									yield {
										type: 'think',
										description: `Drawing request: ${functionCall.arguments.description}`,
									} as TLAiThinkChange
								} else if (functionCall.name === 'speakToStudent') {
									// Yield a special change type for speech synthesis
									yield {
										type: 'speak',
										description: functionCall.arguments.message,
									} as TLAiSpeakChange
								}
							}
						} catch (e) {
							console.error('Error parsing streaming response:', e)
						}
					}
				}
			}
		} finally {
			reader.releaseLock()
		}
	}
}
