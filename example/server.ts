import { config } from 'dotenv'
import { createServer } from 'http'
import OpenAI from 'openai'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { RealtimeServer } from './worker/do/openai/realtimeServer'

// Get the directory path of the current module
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Load environment variables from .dev.vars file
config({ path: join(__dirname, '.dev.vars') })

if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		'OPENAI_API_KEY environment variable is missing. Please add it to your .dev.vars file.'
	)
}

// Create HTTP server
const server = createServer((req, res) => {
	// Add CORS headers
	res.setHeader('Access-Control-Allow-Origin', '*')
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

	// Handle preflight requests
	if (req.method === 'OPTIONS') {
		res.writeHead(204)
		res.end()
		return
	}

	// Handle normal requests
	res.writeHead(200, { 'Content-Type': 'text/plain' })
	res.end('WebSocket server is running')
})

// Initialize OpenAI client
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
	baseURL: process.env.OPENAI_API_BASE_URL,
})

// Create WebSocket server
const wsServer = new RealtimeServer(server, openai)

// Start server
const port = 8080
server.listen(port, () => {
	console.log(`Server is running on port ${port}`)
	console.log('Environment:', {
		OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '***' : undefined,
		OPENAI_API_BASE_URL: process.env.OPENAI_API_BASE_URL,
	})
})

// Handle server shutdown
process.on('SIGINT', () => {
	console.log('Shutting down server...')
	wsServer.shutdown()
	server.close(() => {
		console.log('Server shut down')
		process.exit(0)
	})
})
