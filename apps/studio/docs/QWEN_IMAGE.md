# OpenRouter Image API — Qwen: Qwen Image 3 (qwen/qwen-image-3)

Guide for generating images with `qwen/qwen-image-3` through OpenRouter's Image API.

Docs: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
Model page: https://openrouter.ai/qwen/qwen-image-3
Model discovery API: https://openrouter.ai/api/v1/images/models
Endpoints (qwen/qwen-image-3-20260805): https://openrouter.ai/api/v1/images/models/qwen/qwen-image-3-20260805/endpoints
Create an API key: https://openrouter.ai/settings/keys

## Endpoint

POST https://openrouter.ai/api/v1/images

Headers:

- Authorization: Bearer $OPENROUTER_API_KEY
- Content-Type: application/json

## Request fields (qwen/qwen-image-3)

- model: string (required) — `"qwen/qwen-image-3"`
- prompt: string (required) — text description of the desired image
- resolution: "1K" | "2K" (optional) — resolution tier; concrete pixel dimensions are derived per provider
- aspect_ratio: "1:1" | "1:2" | "1:4" | "2:1" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" (optional) — aspect ratio of the generated image
- n: integer 1-6 (optional) — number of images to generate
- input_references: array of up to 4 image references (optional) — reference images for image-to-image, as `{ "type": "image_url", "image_url": { "url": "…" } }` entries; the url is an https URL or a base64 data URL
- seed: integer (optional) — sample deterministically; determinism is not guaranteed for every provider

These are the generation parameters this model accepts between its providers; an
unlisted value is rejected, and a listed one can still be refused by whichever provider
serves the call. `provider` (routing preferences) is accepted on every request.

## Response

```json
{
  "created": 1748372400,
  "data": [{ "b64_json": "<base64 image bytes>", "media_type": "image/png" }],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 4175,
    "total_tokens": 4175,
    "cost": 0.04
  }
}
```

Base64-decode `data[i].b64_json` and write the bytes to a file; `media_type` gives the extension.
`usage.cost` is the USD charge for the call.

## Examples

### Text to Image

```bash
curl -X POST https://openrouter.ai/api/v1/images \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "model": "qwen/qwen-image-3",
  "prompt": "Editorial architectural photograph of a contemporary neighborhood storefront at blue hour, glowing warmly against the dusk. Above the entrance, a warm-white neon sign in flowing hand-bent cursive reads exactly \"OpenRouter\", the only text in the scene. Large windows reveal a cozy, lived-in interior: wood shelves styled with books and ceramics, lush trailing plants, and soft pendant lighting. Potted plants and a bicycle rest by the entrance, and golden light spills across the wet pavement in gentle reflections. Straight-on composition, realistic materials, quiet street with no people.",
  "n": 1,
  "aspect_ratio": "16:9"
}'
```

## Errors

Failures return `{"error": {"code": <number>, "message": <string>}}` with the HTTP status:

- 400 — malformed body, a parameter or value this model does not accept, or input blocked by the provider's content moderation
- 401 — missing or invalid API key
- 402 — insufficient credits
- 403 — spend limit reached, key disabled, or the model or provider is blocked for your account
- 404 — unknown model, or no provider can serve the request
- 413 — request body too large
- 429 — rate limited; retry with backoff
- 502 — the generation failed upstream; failed generations are not billed

---
