export interface TldrawAiBaseServiceEnv {
	OPENAI_API_KEY: string
}

export abstract class TldrawAiBaseService {
	constructor(protected readonly env: TldrawAiBaseServiceEnv) {}
}
