# Delhaize Groceries

A minimal grocery catalogue with a floating shopping chat and separate basket lists.

Product images are AI-generated illustrations, not official product packaging.

## Run locally

1. In `app`, run `npm install`.
2. Start the API in one terminal: `npm run api`.
3. Start the React app in another terminal: `npm start`.
4. Open `http://localhost:3000`.

The API listens on port 5000 and the development server proxies `/api` requests to it. The original Dutch catalog stays in the workspace `products.json`; `products.en.json` is the separately translated English catalog used by the website. Start/build/API scripts regenerate the English file from the original catalog and copy it to `public/products.json`. Run `npm run translate:products` to regenerate the English JSON on its own.

Product details use a `?product=<SKU>` URL, so reloading preserves the open product and browser Back returns to the catalogue.

## AI provider

Without credentials, the API provides demo actions for adding products, creating lists, and removing basket items or lists. For Grok, copy `.env.example` to `.env` and add your xAI key to `AI_API_KEY`; the example uses xAI's chat-completions endpoint and `grok-4.7`. Keep `.env` local and never paste API keys into chat or source files. The key stays on the server and is never sent to the browser. The chat can answer product questions, use recent conversation context, and apply item substitutions while preserving basket lists. The server validates SKUs, quantities, basket targets, and list budgets before applying changes.

For production, run `npm run build`, then `npm run start:production`; the API server also serves the generated static site.

## Checks

- `npm test -- --watchAll=false`
- `npm run build`
