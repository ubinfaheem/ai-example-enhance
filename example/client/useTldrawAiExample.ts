import { TLAiChange, TLAiResult, useTldrawAi } from '@tldraw/ai'
import { Editor } from 'tldraw'
import { ModelType } from './modelConfig'
import { ShapeDescriptions, SimpleCoordinates, SimpleIds } from './transforms/index'

interface GenerateParams {
	editor: Editor
	prompt: any
	signal: AbortSignal
}

/**
 * A hook that calls `useTldrawAi` with static options.
 *
 * @param editor - The editor instance to use
 * @param selectedModel - The selected AI model to use
 */
export function useTldrawAiExample(editor: Editor, selectedModel: ModelType) {
	return useTldrawAi({
		editor,
		transforms: [SimpleIds, ShapeDescriptions, SimpleCoordinates],
		generate: async ({ editor, prompt, signal }) => {
			const res = await fetch('/generate', {
				method: 'POST',
				body: JSON.stringify({ ...prompt, meta: { model: selectedModel } }),
				headers: {
					'Content-Type': 'application/json',
				},
				signal,
			})

			const result: TLAiResult = await res.json()
			return result.changes
		},
		stream: async function* ({ editor, prompt, signal }) {
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
								const change: TLAiChange = JSON.parse(match[1])
								yield change
							} catch (err) {
								console.error(err)
								throw Error(`JSON parsing error: ${match[1]}`)
							}
						}
					}
				}
			} catch (err) {
				throw err
			} finally {
				reader.releaseLock()
			}
		},
	})
}
