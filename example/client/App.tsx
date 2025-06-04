import { FormEventHandler, useCallback, useRef, useState } from 'react'
import { DefaultSpinner, Editor, Tldraw } from 'tldraw'
import { SpeechInterface } from './components/SpeechInterface'
import { MODEL_CONFIGS, ModelType } from './modelConfig'
import './styles/App.css'
import { useTldrawAiExample } from './useTldrawAiExample'

// Separate component that uses the AI functionality
function TldrawAiContainer({ editor }: { editor: Editor }) {
	const [selectedModel, setSelectedModel] = useState<ModelType>('gpt-4.1-2025-04-14')
	const [isListening, setIsListening] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [isBusy, setIsBusy] = useState(false)
	const [isSpeaking, setIsSpeaking] = useState(false)
	const [selectedVoice, setSelectedVoice] = useState('alloy')
	const [inputValue, setInputValue] = useState('')
	const abortControllerRef = useRef<AbortController | null>(null)
	const { prompt, cancel } = useTldrawAiExample(editor, selectedModel)

	const handleInput = useCallback(
		async (text: string) => {
			if (isBusy) return

			console.log('🎯 Processing input:', { text, model: selectedModel })
			setIsBusy(true)
			setIsLoading(true)

			// Store current listening state
			const wasListening = isListening
			if (wasListening) {
				setIsListening(false)
			}

			// Cancel any ongoing operations
			abortControllerRef.current?.abort()
			abortControllerRef.current = new AbortController()

			try {
				await prompt(text)
				console.log('✅ Input processing completed')
			} catch (e) {
				console.error('❌ Error processing input:', e)
			} finally {
				setIsBusy(false)
				setIsLoading(false)
				setIsSpeaking(false)
				// Restore listening state if it was previously enabled
				if (wasListening) {
					setIsListening(true)
				}
			}
		},
		[prompt, selectedModel, isBusy, isListening]
	)

	const handleTextSubmit: FormEventHandler = (e) => {
		e.preventDefault()
		if (!inputValue.trim()) return
		console.log('📝 Text input submitted:', inputValue)
		handleInput(inputValue)
		setInputValue('')
	}

	const handleToggleListening = useCallback(() => {
		if (isBusy) return
		setIsListening((prev) => {
			const newState = !prev
			console.log(`🎤 Microphone ${newState ? 'enabled' : 'disabled'}`)
			return newState
		})
	}, [isBusy])

	const handleVoiceChange = useCallback((voice: string) => {
		console.log('🔊 Voice changed to:', voice)
		setSelectedVoice(voice)
	}, [])

	return (
		<div className="ai-controls-container">
			<div className="controls">
				<select
					value={selectedModel}
					onChange={(e) => setSelectedModel(e.target.value as ModelType)}
					className="model-selector"
					disabled={isBusy}
				>
					{Object.entries(MODEL_CONFIGS).map(([id, config]) => (
						<option key={id} value={id}>
							{config.name}
						</option>
					))}
				</select>

				{/* Show speech interface only for real-time model */}
				{selectedModel === 'gpt-4o-realtime-preview-2025-06-03' && (
					<SpeechInterface
						onSpeechInput={handleInput}
						isListening={isListening}
						onToggleListening={handleToggleListening}
						onVoiceChange={handleVoiceChange}
						isSpeaking={isSpeaking}
						disabled={isBusy}
					/>
				)}

				{/* Always show text input */}
				<form onSubmit={handleTextSubmit} className="text-input-form">
					<input
						type="text"
						value={inputValue}
						onChange={(e) => setInputValue(e.target.value)}
						placeholder="Type your prompt here..."
						disabled={isLoading || isBusy}
						className="text-input"
					/>
					<button type="submit" disabled={isLoading || isBusy} className="submit-button">
						{isLoading ? <DefaultSpinner /> : 'Send'}
					</button>
				</form>

				{isBusy && (
					<button
						onClick={() => {
							cancel()
							setIsBusy(false)
							setIsLoading(false)
							setIsSpeaking(false)
						}}
						className="cancel-button"
					>
						Cancel
					</button>
				)}
			</div>

			{isLoading && (
				<div className="loading">
					<DefaultSpinner />
				</div>
			)}
		</div>
	)
}

// Main App component
function App() {
	const [editor, setEditor] = useState<Editor | null>(null)

	return (
		<div className="app-container">
			<div className="tldraw-wrapper">
				<Tldraw persistenceKey="tldraw-ai-demo" onMount={setEditor} />
			</div>
			{editor && <TldrawAiContainer editor={editor} />}
		</div>
	)
}

interface InputBarProps {
	editor: Editor
	selectedModel: ModelType
	onModelChange: (model: ModelType) => void
	onSubmit: (text: string) => void
	isLoading: boolean
}

function InputBar({ editor, selectedModel, onModelChange, onSubmit, isLoading }: InputBarProps) {
	const [inputValue, setInputValue] = useState('')

	const handleSubmit: FormEventHandler = (e) => {
		e.preventDefault()
		if (!inputValue.trim()) return
		onSubmit(inputValue)
		setInputValue('')
	}

	return (
		<div className="prompt-input">
			<form onSubmit={handleSubmit}>
				<select
					className="model-selector"
					value={selectedModel}
					onChange={(e) => onModelChange(e.target.value as ModelType)}
				>
					{Object.entries(MODEL_CONFIGS).map(([id, config]) => (
						<option key={id} value={id}>
							{config.name}
						</option>
					))}
				</select>
				<input
					className="text-input"
					type="text"
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					placeholder="Enter a prompt..."
					disabled={isLoading}
				/>
				<button type="submit" disabled={isLoading}>
					{isLoading ? <DefaultSpinner /> : 'Send'}
				</button>
			</form>
		</div>
	)
}

export default App
