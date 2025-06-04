import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
	return {
		plugins: [cloudflare(), react()],
		server: {
			proxy: {
				'/api/ephemeral-key': {
					target: 'https://api.openai.com/v1/realtime/keys',
					changeOrigin: true,
					rewrite: () => '/v1/realtime/keys',
					headers: {
						Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
						'Content-Type': 'application/json',
					},
				},
			},
		},
	}
})
