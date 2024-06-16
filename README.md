# AI-Controlled Browser on Cloudflare

This is an experiment to create an AI Agent that can crawl and interact with webpages to achieve desired goal. Fully on Cloudflare (almost).

Services used:

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) - responding to HTTP requests
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) - running agent's core loop
- [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) - programmatically control a web browser
- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) - monitor requests to OpenAI (to be replaced with Workers AI 🤞)
- [Cloudflare R2](https://developers.cloudflare.com/r2/) - store screenshots of the interactions

## Usage

```sh
pnpm run deploy # You can use `pnpm run dev` as well but Browser Rendering does not work locally
curl -X POST \
  https://cloudflare-agentic-ai-browser.raf-wilinski.workers.dev \
  -d '{"baseUrl": "https://bubble.io", "goal": "Extract pricing data" }' # Replace with your Worker URL, base URL and goal
```
