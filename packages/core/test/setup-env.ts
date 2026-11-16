// 1.10.1 시험은 실제 키 환경변수와 무관하게(키 값을 읽거나 유료 호출하지 않도록) — 각 시험이 필요하면 직접 넣음
for (const k of ['SUBBRAIN_LLM_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'XAI_API_KEY']) delete process.env[k];

// Generated text language: the test suite asserts the Korean sentences (the app default is English)
process.env.SUBBRAIN_LANG ??= 'ko';
process.env.SUBBRAIN_UTC_OFFSET ??= '+09:00';
