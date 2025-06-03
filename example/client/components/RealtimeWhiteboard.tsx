import { FormEventHandler, useCallback, useEffect, useRef, useState } from 'react'
import { Editor } from 'tldraw'
import { ModelType } from '../modelConfig'
import { useTldrawAiExample } from '../useTldrawAiExample'
import styles from './RealtimeWhiteboard.module.css'

interface RealtimeWhiteboardProps {
	editor: Editor
	selectedModel?: ModelType
}

export function RealtimeWhiteboard({
	editor,
	selectedModel = 'gpt-4o-realtime-preview-2024-12-17' as ModelType,
}: RealtimeWhiteboardProps) {
	const [isGenerating, setIsGenerating] = useState(false)
	const [connectionStatus, setConnectionStatus] = useState<
		'connecting' | 'connected' | 'disconnected'
	>('disconnected')
	const [error, setError] = useState<string | null>(null)
	const ai = useTldrawAiExample(editor, selectedModel)
	const ws = useRef<WebSocket | null>(null)
	const reconnectAttempts = useRef(0)
	const maxReconnectAttempts = 5
	const reconnectTimeout = useRef<NodeJS.Timeout>()
	const isConnecting = useRef(false)

	const connectWebSocket = useCallback(() => {
		// Prevent multiple simultaneous connection attempts
		if (isConnecting.current || ws.current?.readyState === WebSocket.CONNECTING) {
			console.log('Connection attempt already in progress...')
			return
		}

		// Clear any existing connection
		if (ws.current) {
			if (ws.current.readyState === WebSocket.OPEN) {
				console.log('Already connected')
				return
			}
			ws.current.close()
			ws.current = null
		}

		try {
			isConnecting.current = true
			console.log('Attempting to connect to WebSocket...')
			setConnectionStatus('connecting')
			setError(null)

			const socket = new WebSocket('ws://localhost:8080')
			ws.current = socket

			socket.onopen = () => {
				console.log('WebSocket connection established')
				setConnectionStatus('connected')
				setError(null)
				reconnectAttempts.current = 0
				isConnecting.current = false
			}

			socket.onclose = (event) => {
				console.log('WebSocket connection closed:', event.code, event.reason)
				setConnectionStatus('disconnected')
				ws.current = null
				isConnecting.current = false

				// Don't attempt to reconnect if we're intentionally closing
				if (event.code === 1000) {
					return
				}

				// Attempt to reconnect if we haven't exceeded max attempts
				if (reconnectAttempts.current < maxReconnectAttempts) {
					const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000)
					console.log(
						`Attempting to reconnect in ${delay}ms... (Attempt ${
							reconnectAttempts.current + 1
						}/${maxReconnectAttempts})`
					)
					setError(`Connection lost. Reconnecting in ${delay / 1000} seconds...`)

					if (reconnectTimeout.current) {
						clearTimeout(reconnectTimeout.current)
					}

					reconnectTimeout.current = setTimeout(() => {
						reconnectAttempts.current++
						connectWebSocket()
					}, delay)
				} else {
					setError('Could not establish connection to server. Please try again later.')
				}
			}

			socket.onerror = (error) => {
				console.error('WebSocket error:', error)
				setError('Connection error')
				isConnecting.current = false
			}

			socket.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data)
					console.log('Received message:', data)

					switch (data.type) {
						case 'change':
							if (editor && data.content) {
								editor.updateShapes([data.content])
							}
							break
						case 'end':
							setIsGenerating(false)
							break
						case 'error':
							console.error('Server error:', data.content)
							setError(data.content)
							setIsGenerating(false)
							break
						default:
							console.warn('Unknown message type:', data.type)
					}
				} catch (error) {
					console.error('Error processing server message:', error)
					setError('Error processing server message')
				}
			}
		} catch (error) {
			console.error('Error creating WebSocket connection:', error)
			setConnectionStatus('disconnected')
			setError('Failed to connect to server')
			isConnecting.current = false
		}
	}, [editor])

	useEffect(() => {
		// Add a small delay before initial connection
		const initialConnectTimeout = setTimeout(() => {
			connectWebSocket()
		}, 1000)

		// Cleanup function
		return () => {
			clearTimeout(initialConnectTimeout)
			if (reconnectTimeout.current) {
				clearTimeout(reconnectTimeout.current)
			}
			if (ws.current) {
				ws.current.close(1000, 'Component unmounting')
				ws.current = null
			}
			isConnecting.current = false
		}
	}, [editor, connectWebSocket])

	const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
		async (e) => {
			e.preventDefault()
			if (!ws.current || !editor || ws.current.readyState !== WebSocket.OPEN) {
				setError('WebSocket is not connected')
				return
			}

			try {
				const formData = new FormData(e.currentTarget)
				const message = formData.get('input') as string

				// Get the current viewport bounds
				const viewportBounds = editor.getViewportPageBounds()
				const content = editor.getContentFromCurrentPage(editor.getCurrentPageShapesSorted())

				// Send the prompt to the server
				ws.current.send(
					JSON.stringify({
						message: { type: 'text', text: message },
						canvasContent: content,
						contextBounds: viewportBounds.toJson(),
						promptBounds: viewportBounds.toJson(),
					})
				)

				setIsGenerating(true)
				setError(null)
			} catch (error) {
				console.error('Error sending prompt:', error)
				setError('Error sending prompt to server')
				setIsGenerating(false)
			}
		},
		[editor]
	)

	return (
		<div className={styles.promptInput}>
			<form onSubmit={handleSubmit}>
				<input
					type="text"
					name="input"
					className={styles.input}
					placeholder={
						connectionStatus !== 'connected'
							? 'Connecting to server...'
							: isGenerating
								? 'Generating...'
								: 'Enter your prompt...'
					}
					disabled={connectionStatus !== 'connected' || isGenerating}
				/>
				<button
					type="submit"
					className={styles.button}
					disabled={connectionStatus !== 'connected' || isGenerating}
				>
					{isGenerating ? 'Stop' : 'Send'}
				</button>
				{error && <div className={styles.errorMessage}>{error}</div>}
				{connectionStatus !== 'connected' && !error && (
					<div className={styles.connectionStatus}>
						{connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
					</div>
				)}
			</form>
		</div>
	)
}
