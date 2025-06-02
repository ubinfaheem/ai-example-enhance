import { TLAiSerializedPrompt } from '@tldraw/ai'
import { parse } from 'best-effort-json-parser'
import OpenAI from 'openai'
import { buildPromptMessages } from './prompt'
import { ISimpleEvent, RESPONSE_FORMAT, SimpleEvent } from './schema'

const MODELS_WITH_JSON_SUPPORT = ['gpt-4.1-2025-04-14', 'gpt-4o-2024-11-20', 'o4-mini-2025-04-16']

/**
 * Prompt the OpenAI model with the given prompt. Stream the events as they come back.
 */
export async function* streamEvents(
	model: OpenAI,
	prompt: TLAiSerializedPrompt,
	modelName: string = 'gpt-4'
): AsyncGenerator<ISimpleEvent> {
	//console.log(`🌊 Starting stream with model: ${modelName}`)

	const requestOptions: any = {
		model: modelName,
		messages: buildPromptMessages(prompt, modelName),
	}

	// Only add response_format for models that support it
	if (MODELS_WITH_JSON_SUPPORT.includes(modelName)) {
		//console.log('📋 Adding JSON response format for supported model')
		requestOptions.response_format = RESPONSE_FORMAT
	}

	console.log('📤 Sending streaming request to OpenAI:', {
		model: modelName,
		messageCount: requestOptions.messages.length,
		hasResponseFormat: !!requestOptions.response_format,
	})

	const stream = model.beta.chat.completions.stream(requestOptions)
	console.log('🔗 Stream connection established')

	let accumulatedText = '' // Buffer for incoming chunks
	let cursor = 0

	const events: ISimpleEvent[] = []
	let maybeUnfinishedEvent: ISimpleEvent | null = null

	// Process the stream as chunks arrive
	for await (const chunk of stream) {
		if (!chunk) continue

		// Add the text to the accumulated text
		const newContent = chunk.choices[0]?.delta?.content ?? ''
		accumulatedText += newContent
		if (newContent) {
			//console.log('📝 Received chunk:', newContent)
		}

		// Even though the accumulated text is incomplete JSON, try to extract data
		const json = parse(accumulatedText)

		// If we have events, iterate over the events...
		if (Array.isArray(json?.events)) {
			// Starting at the current cursor, iterate over the events
			for (let i = cursor, len = json.events.length; i < len; i++) {
				const part = json.events[i]
				if (i === cursor) {
					try {
						// Check whether it's a valid event using our schema
						SimpleEvent.parse(part)

						if (i < len) {
							// If this is valid AND there are additional events, we're done with this one
							events.push(part)
							console.log('✨ Generated new event:', part)
							yield part
							maybeUnfinishedEvent = null
							cursor++
						} else {
							// This is the last event we've seen so far, so it might still be cooking
							maybeUnfinishedEvent = part
							console.log('⏳ Potential event being processed:', part)
						}
					} catch {
						// noop but okay, it's just not done enough to be a valid event
						//console.log('⚠️ Invalid event format, waiting for more data')
					}
				}
			}
		}
	}

	// If we still have an event, then it was the last event to be seen as a JSON object
	if (maybeUnfinishedEvent) {
		console.log('✨ Processing final event:', maybeUnfinishedEvent)
		events.push(maybeUnfinishedEvent)
		yield maybeUnfinishedEvent
	}

	console.log(`🏁 Stream completed. Generated ${events.length} events in total`)
}
