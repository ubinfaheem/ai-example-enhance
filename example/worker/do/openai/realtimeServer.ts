import { TLAiChange, TLAiSerializedPrompt } from '@tldraw/ai'
import { createShapeId } from '@tldraw/tlschema'
import OpenAI from 'openai'
import { WebSocket, WebSocketServer } from 'ws'

type ExtendedWebSocket = WebSocket & {
	isAlive: boolean
	currentResponseId?: string
	currentResponse?: any
}

const SHAPE_FUNCTIONS = [
	{
		name: 'createShape',
		description: 'Create a shape on the whiteboard',
		parameters: {
			type: 'object',
			properties: {
				type: {
					type: 'string',
					enum: ['geo', 'text', 'draw', 'arrow', 'frame', 'note', 'line', 'highlight'],
					description: 'The type of shape to create',
				},
				x: {
					type: 'number',
					description: 'X position of the shape',
				},
				y: {
					type: 'number',
					description: 'Y position of the shape',
				},
				rotation: {
					type: 'number',
					description: 'Rotation angle in degrees',
				},
				width: {
					type: 'number',
					description: 'Width of the shape',
				},
				height: {
					type: 'number',
					description: 'Height of the shape',
				},
				color: {
					type: 'string',
					description: 'Color of the shape',
				},
				text: {
					type: 'string',
					description: 'Text content for text shapes',
				},
				geo: {
					type: 'string',
					enum: ['rectangle', 'ellipse', 'triangle', 'diamond'],
					description: 'Geometric shape type for geo shapes',
				},
			},
			required: ['type', 'x', 'y'],
		},
	},
]

export class RealtimeServer {
	private wss: WebSocketServer
	private openai: OpenAI
	private clients: Set<ExtendedWebSocket>
	private heartbeatInterval!: NodeJS.Timeout

	constructor(server: any, openai: OpenAI) {
		this.wss = new WebSocketServer({
			server,
			perMessageDeflate: false,
		})
		this.openai = openai
		this.clients = new Set()

		this.setupWebSocketServer()
		this.startHeartbeat()
	}

	private startHeartbeat() {
		this.heartbeatInterval = setInterval(() => {
			for (const ws of this.clients) {
				if (!ws.isAlive) {
					console.log('Client connection lost, terminating')
					this.clients.delete(ws)
					ws.terminate()
					continue
				}
				ws.isAlive = false
				try {
					ws.ping()
				} catch (error) {
					console.error('Error sending ping:', error)
					this.clients.delete(ws)
					ws.terminate()
				}
			}
		}, 30000)
	}

	private async handleTutorResponse(prompt: string, ws: WebSocket) {
		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				},
				body: JSON.stringify({
					model: 'gpt-4-turbo-preview',
					messages: [
						{
							role: 'system',
							content: `You are a helpful whiteboard tutor. Help the user understand how to use the whiteboard effectively.
When they want to create shapes or diagrams, explain the process and provide guidance.
Keep responses concise and focused on the whiteboarding task.`,
						},
						{
							role: 'user',
							content: prompt,
						},
					],
					stream: true,
				}),
			})

			if (!response.ok) {
				throw new Error(`Tutor API error: ${response.status} ${response.statusText}`)
			}

			const reader = response.body?.getReader()
			if (!reader) {
				throw new Error('No response body')
			}

			try {
				while (true) {
					const { done, value } = await reader.read()
					if (done) break

					const text = new TextDecoder().decode(value)
					const lines = text.split('\n')

					for (const line of lines) {
						if (line.startsWith('data: ')) {
							const data = line.slice(5)
							if (data === '[DONE]') continue

							try {
								const parsed = JSON.parse(data)
								const content = parsed.choices[0]?.delta?.content
								if (content) {
									if (ws.readyState === WebSocket.OPEN) {
										ws.send(
											JSON.stringify({
												type: 'tutor',
												content,
											})
										)
									}
								}
							} catch (err) {
								// Ignore parsing errors for incomplete chunks
							}
						}
					}
				}
			} finally {
				reader.releaseLock()
			}
		} catch (error) {
			console.error('Error in tutor response:', error)
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(
					JSON.stringify({
						type: 'error',
						content: 'Error processing tutor response',
					})
				)
			}
		}
	}

	private async handleShapeCreation(prompt: TLAiSerializedPrompt, ws: WebSocket) {
		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				},
				body: JSON.stringify({
					model: 'gpt-4-turbo-preview',
					messages: [
						{
							role: 'system',
							content: `You are a helpful assistant that generates whiteboard content based on user prompts.
You can create shapes, draw diagrams, and add text to help visualize ideas.
When creating shapes, consider:
- Appropriate positioning within the viewport
- Clear visual hierarchy
- Logical grouping of related elements
- Descriptive labels and annotations
- Consistent styling and colors`,
						},
						{
							role: 'user',
							content: JSON.stringify(prompt),
						},
					],
					functions: SHAPE_FUNCTIONS,
					function_call: { name: 'createShape' },
					stream: true,
				}),
			})

			if (!response.ok) {
				throw new Error(`Shape API error: ${response.status} ${response.statusText}`)
			}

			const reader = response.body?.getReader()
			if (!reader) {
				throw new Error('No response body')
			}

			try {
				while (true) {
					const { done, value } = await reader.read()
					if (done) break

					const text = new TextDecoder().decode(value)
					const lines = text.split('\n')

					for (const line of lines) {
						if (line.startsWith('data: ')) {
							const data = line.slice(5)
							if (data === '[DONE]') continue

							try {
								const parsed = JSON.parse(data)
								const functionCall = parsed.choices[0]?.delta?.function_call

								if (functionCall?.arguments) {
									try {
										const args = JSON.parse(functionCall.arguments)
										const shapeId = createShapeId()
										const change: TLAiChange = {
											type: 'createShape',
											description: `Creating ${args.type} shape at (${args.x}, ${args.y})`,
											shape: {
												id: shapeId,
												type: args.type,
												x: args.x,
												y: args.y,
												rotation: args.rotation || 0,
												props: {
													w: args.width || 100,
													h: args.height || 100,
													color: args.color || 'blue',
													text: args.text,
													geo: args.geo,
												},
											},
										}

										if (ws.readyState === WebSocket.OPEN) {
											ws.send(
												JSON.stringify({
													type: 'change',
													content: change,
												})
											)
										}
									} catch (err) {
										// Ignore parsing errors for incomplete chunks
									}
								}
							} catch (err) {
								console.error('Error parsing model output:', err)
							}
						}
					}
				}
			} finally {
				reader.releaseLock()
			}
		} catch (error) {
			console.error('Error in shape creation:', error)
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(
					JSON.stringify({
						type: 'error',
						content: 'Error processing shape creation',
					})
				)
			}
		}
	}

	private setupWebSocketServer() {
		this.wss.on('connection', (ws: WebSocket) => {
			const extWs = ws as ExtendedWebSocket
			console.log('New WebSocket connection established')
			extWs.isAlive = true
			this.clients.add(extWs)

			ws.on('pong', () => {
				extWs.isAlive = true
			})

			ws.on('message', async (data: Buffer) => {
				try {
					const message = JSON.parse(data.toString())
					console.log('Received message:', message)

					if (message.type === 'tutor') {
						await this.handleTutorResponse(message.text, ws)
					} else {
						const prompt: TLAiSerializedPrompt = message
						await this.handleShapeCreation(prompt, ws)
					}

					if (ws.readyState === WebSocket.OPEN) {
						ws.send(
							JSON.stringify({
								type: 'end',
							})
						)
					}
				} catch (error) {
					console.error('Error processing message:', error)
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(
							JSON.stringify({
								type: 'error',
								content: 'Error processing message',
							})
						)
					}
				}
			})

			ws.on('error', (error: Error) => {
				console.error('WebSocket error:', error)
				this.clients.delete(extWs)
			})

			ws.on('close', () => {
				console.log('Client disconnected')
				this.clients.delete(extWs)
			})
		})

		this.wss.on('error', (error) => {
			console.error('WebSocket server error:', error)
		})
	}

	public shutdown() {
		clearInterval(this.heartbeatInterval)
		this.wss.close()
	}
}
