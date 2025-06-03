import { Request, Response } from 'express'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_API_BASE = 'https://api.openai.com'

export default async function handler(req: Request, res: Response) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' })
	}

	try {
		// Get ephemeral key from OpenAI
		const response = await fetch(`${OPENAI_API_BASE}/v1/realtime/keys`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				ttl_seconds: 60, // Key expires in 1 minute
			}),
		})

		if (!response.ok) {
			throw new Error('Failed to get ephemeral key from OpenAI')
		}

		const data = await response.json()
		res.status(200).json({ key: data.key })
	} catch (error) {
		console.error('Error getting ephemeral key:', error)
		res.status(500).json({ error: 'Failed to get ephemeral key' })
	}
}
