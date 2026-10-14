import { Groq } from 'groq-sdk';
import env from 'dotenv'
    
env.config()

const groq = new Groq({
  apiKey: process.env.AI_API_KEY,
  baseUrl: 'https://api.groq.com/v1',
});

const chatCompletion = await groq.chat.completions.create({
  "messages": [
    {
      "role": "system",
      "content": "You are a teacher's assistant."
    },
    {
      "role": "user",
      "content": ""
    }
  ],
  "model": "openai/gpt-oss-120b",
  "temperature": 1,
  "max_completion_tokens": 2048,
  "top_p": 1,
  "stream": true,
  "reasoning_effort": "medium",
  "stop": null
});

for await (const chunk of chatCompletion) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}

