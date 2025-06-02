import { TLAiSerializedPrompt } from '@tldraw/ai'
import { asMessage } from '@tldraw/ai/src/utils'
import {
	ChatCompletionContentPart,
	ChatCompletionDeveloperMessageParam,
	ChatCompletionUserMessageParam,
} from 'openai/resources'
import { getSimpleContentFromCanvasContent } from './getSimpleContentFromCanvasContent'
import { OPENAI_SYSTEM_PROMPT } from './system-prompt'

const MODELS_WITH_IMAGE_SUPPORT = ['gpt-4.1-2025-04-14', 'gpt-4o-2024-11-20', 'o4-mini-2025-04-16']

/**
 * Build the messages for the prompt.
 */
export function buildPromptMessages(prompt: TLAiSerializedPrompt, modelName: string = 'gpt-4') {
	console.log(`🔄 Building messages for model: ${modelName}`)
	const systemPrompt = buildSystemPrompt(prompt)
	const developerMessage = buildDeveloperMessage(prompt)
	const userMessage = buildUserMessages(prompt, modelName)

	console.log('📨 Final messages structure:', {
		systemPrompt: { ...systemPrompt, content: systemPrompt.content.substring(0, 100) + '...' },
		developerMessage,
		userMessage,
	})

	return [systemPrompt, developerMessage, userMessage]
}

/**
 * Build the system prompt.
 */
function buildSystemPrompt(_prompt: TLAiSerializedPrompt) {
	//console.log('🤖 Building system prompt')
	return {
		role: 'system',
		content: OPENAI_SYSTEM_PROMPT,
	} as const
}

function buildDeveloperMessage(prompt: TLAiSerializedPrompt) {
	//console.log('👨‍💻 Building developer message')
	const developerMessage: ChatCompletionDeveloperMessageParam & {
		content: Array<ChatCompletionContentPart>
	} = {
		role: 'developer',
		content: [],
	}

	console.log('📐 Viewport bounds:', {
		x: prompt.promptBounds.x,
		y: prompt.promptBounds.y,
		width: prompt.promptBounds.w,
		height: prompt.promptBounds.h,
	})

	developerMessage.content.push({
		type: 'text',
		text: `The user\'s current viewport is: { x: ${prompt.promptBounds.x}, y: ${prompt.promptBounds.y}, width: ${prompt.promptBounds.w}, height: ${prompt.promptBounds.h} }`,
	})

	if (prompt.canvasContent) {
		console.log('🎨 Processing canvas content')
		const simplifiedCanvasContent = getSimpleContentFromCanvasContent(prompt.canvasContent)
		console.log('🔍 Simplified canvas content:', simplifiedCanvasContent)

		developerMessage.content.push({
			type: 'text',
			text: `Here are all of the shapes that are in the user's current viewport:\n\n${JSON.stringify(simplifiedCanvasContent.shapes).replaceAll('\n', ' ')}`,
		})
	}

	return developerMessage
}

/**
 * Build the user messages.
 */
function buildUserMessages(prompt: TLAiSerializedPrompt, modelName: string) {
	//console.log('👤 Building user messages')
	const supportsImages = MODELS_WITH_IMAGE_SUPPORT.includes(modelName)
	console.log(`🖼️ Image support for ${modelName}:`, supportsImages)

	const userMessage: ChatCompletionUserMessageParam & {
		content: Array<ChatCompletionContentPart> | string
	} = {
		role: 'user',
		content: [],
	}

	const contentParts: Array<ChatCompletionContentPart> = []
	let imageUrlCount = 0

	if (prompt.image && supportsImages) {
		console.log('🖼️ Adding viewport screenshot URL:', prompt.image.substring(0, 50) + '...')
		contentParts.push(
			{
				type: 'image_url',
				image_url: {
					detail: 'auto',
					url: prompt.image,
				},
			},
			{
				type: 'text',
				text: 'Here is a screenshot of the my current viewport.',
			}
		)
		imageUrlCount++
	}

	contentParts.push({
		type: 'text',
		text: `Using the events provided in the response schema, here's what I want you to do:`,
	})

	console.log('📝 Processing user messages')
	for (const message of asMessage(prompt.message)) {
		if (message.type === 'image' && supportsImages) {
			console.log('🖼️ Adding user-provided image URL:', message.src?.substring(0, 50) + '...')
			contentParts.push({
				type: 'image_url',
				image_url: {
					url: message.src!,
				},
			})
			imageUrlCount++
		} else if (message.type === 'text') {
			console.log('📝 Adding text message:', message.text.substring(0, 100) + '...')
			contentParts.push({
				type: 'text',
				text: message.text,
			})
		}
	}

	// For models that don't support image content, convert everything to text
	if (!supportsImages) {
		console.log('📝 Converting content to text-only format')
		userMessage.content = contentParts
			.filter((part) => part.type === 'text')
			.map((part) => part.text)
			.join('\n')
	} else {
		userMessage.content = contentParts
	}

	return userMessage
}
