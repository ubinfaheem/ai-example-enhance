import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'

dotenv.config()
console.log('✅ Loaded API key:', process.env.OPENAI_API_KEY) // ← test line

const app = express()
app.use(cors())
app.use(express.json())

// Combined endpoint to get session data with ephemeral key
app.get('/session', async (req, res) => {
	try {
		console.log('🔄 Requesting session from OpenAI...')
		const sessionResponse = await fetch('https://api.openai.com/v1/realtime/sessions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4o-realtime-preview-2025-06-03',
				voice: 'alloy',
			}),
		})

		const sessionData = await sessionResponse.json()
		console.log('📡 Session response status:', sessionResponse.status)

		if (!sessionResponse.ok) {
			console.error('❌ OpenAI Session API error:', sessionData)
			return res.status(sessionResponse.status).json({
				error: 'Failed to create session',
				details: sessionData,
			})
		}

		console.log('✅ Got session data')
		res.json(sessionData)
	} catch (error) {
		console.error('❌ Server error:', error)
		res.status(500).json({
			error: 'Internal server error',
			message: error instanceof Error ? error.message : 'Unknown error',
		})
	}
})

const PORT = 5177
app.listen(PORT, () => {
	console.log(`✅ Server is running on http://localhost:${PORT}`)
})
