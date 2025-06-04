import dotenv from 'dotenv'
import { NextResponse } from 'next/server'
dotenv.config()
console.log('✅ Loaded API key:', process.env.OPENAI_API_KEY) // ← test line

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_API_BASE = 'https://api.openai.com'

export async function POST() {
	try {
		// Get ephemeral key from OpenAI
		const response = await fetch(`${OPENAI_API_BASE}/v1/realtime/sessions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4o-realtime-preview-2025-06-03',
				voice: 'alloy',
			}),
		})

		if (!response.ok) {
			throw new Error('Failed to get ephemeral key from OpenAI')
		}

		const data = await response.json()
		return NextResponse.json({ key: data.key })
	} catch (error) {
		console.error('Error getting ephemeral key:', error)
		return NextResponse.json({ error: 'Failed to get ephemeral key' }, { status: 500 })
	}
}
