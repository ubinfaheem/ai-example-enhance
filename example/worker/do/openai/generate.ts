import { TLAiSerializedPrompt } from '@tldraw/ai'
import OpenAI from 'openai'
import { buildPromptMessages } from './prompt'
import { IModelResponse, ISimpleEvent, ModelResponse, RESPONSE_FORMAT } from './schema'

const MODELS_WITH_JSON_SUPPORT = ['gpt-4.1-2025-04-14', 'gpt-4o-2024-11-20', 'o4-mini-2025-04-16']

/**
 * Prompt the OpenAI model with the given prompt. Stream the events as they come back.
 */
export async function generateEvents(
	model: OpenAI,
	prompt: TLAiSerializedPrompt,
	modelName: string = 'gpt-4'
): Promise<ISimpleEvent[]> {
	console.log(`🚀 Generating events with model: ${modelName}`)

	const requestOptions: any = {
		model: modelName,
		messages: buildPromptMessages(prompt, modelName),
	}

	// Only add response_format for models that support it
	if (MODELS_WITH_JSON_SUPPORT.includes(modelName)) {
		console.log('📋 Adding JSON response format for supported model')
		requestOptions.response_format = RESPONSE_FORMAT
	}

	console.log('📤 Sending request to OpenAI:', {
		model: modelName,
		messageCount: requestOptions.messages.length,
		hasResponseFormat: !!requestOptions.response_format,
	})

	const response = await model.chat.completions.create(requestOptions)
	console.log('📥 Received response from OpenAI')

	const text = response.choices[0]?.message?.content ?? ''
	//console.log('📝 Raw response content:', text.substring(0, 200) + '...')

	const json = JSON.parse(text) as IModelResponse
	console.log('🔍 Parsed JSON response:', json)

	try {
		ModelResponse.parse(json)
		console.log('✅ Response validation successful')
	} catch (err) {
		console.error('❌ Response validation failed:', err)
		throw new Error(`Invalid response from OpenAI: ${err}`)
	}

	console.log(`✨ Generated ${json.events.length} events`)
	return json.events
}
