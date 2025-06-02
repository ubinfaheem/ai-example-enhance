import { FormEventHandler, useCallback, useEffect, useRef, useState } from 'react'
import { DefaultSpinner, Editor, Tldraw } from 'tldraw'
import { MODEL_CONFIGS, ModelType } from './modelConfig'
import { useTldrawAiExample } from './useTldrawAiExample'

function App() {
	const [editor, setEditor] = useState<Editor | null>(null)
	const [selectedModel, setSelectedModel] = useState<ModelType>('gpt-4.1-2025-04-14')

	return (
		<div className="tldraw-ai-container">
			<Tldraw persistenceKey="tldraw-ai-demo" onMount={setEditor} />
			{editor && (
				<InputBar editor={editor} selectedModel={selectedModel} onModelChange={setSelectedModel} />
			)}
		</div>
	)
}

interface InputBarProps {
	editor: Editor
	selectedModel: ModelType
	onModelChange: (model: ModelType) => void
}

function InputBar({ editor, selectedModel, onModelChange }: InputBarProps) {
	const ai = useTldrawAiExample(editor, selectedModel)

	// The state of the prompt input, either idle or loading
	const [isGenerating, setIsGenerating] = useState(false)

	// A stashed cancel function that we can call if the user clicks the button while loading
	const rCancelFn = useRef<(() => void) | null>(null)

	// Put the editor and ai helpers onto the window for debugging
	useEffect(() => {
		if (!editor) return
		;(window as any).editor = editor
		;(window as any).ai = ai
	}, [ai, editor])

	const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
		async (e) => {
			e.preventDefault()

			// If we have a stashed cancel function, call it and stop here
			if (rCancelFn.current) {
				rCancelFn.current()
				rCancelFn.current = null
				setIsGenerating(false)
				return
			}

			try {
				const formData = new FormData(e.currentTarget)
				const value = formData.get('input') as string

				// We call the ai module with the value from the input field and get back a promise and a cancel function
				const { promise, cancel } = ai.prompt({ message: value, stream: true })

				// Stash the cancel function so we can call it if the user clicks the button again
				rCancelFn.current = cancel

				// Set the state to loading
				setIsGenerating(true)

				// ...wait for the promise to resolve
				await promise

				// ...then set the state back to idle
				setIsGenerating(false)
				rCancelFn.current = null
			} catch (e: any) {
				console.error(e)
				setIsGenerating(false)
				rCancelFn.current = null
			}
		},
		[ai]
	)

	return (
		<div className="prompt-input">
			<form onSubmit={handleSubmit}>
				<select
					value={selectedModel}
					onChange={(e) => onModelChange(e.target.value as ModelType)}
					className="model-selector"
				>
					{Object.entries(MODEL_CONFIGS).map(([key, config]) => (
						<option key={key} value={key}>
							{config.name}
						</option>
					))}
				</select>
				<input name="input" type="text" autoComplete="off" placeholder="Enter your prompt…" />
				<button>{isGenerating ? <DefaultSpinner /> : 'Send'}</button>
			</form>
		</div>
	)
}

export default App
