# The Model Desk

A private, live AI news reader. It collects public feeds on the server, groups related articles into one entry, and links back to each publisher. The optional AI brief reviews available original documents and related coverage.

## Run locally

With Node.js 22.13 or newer, run `npm start` from this folder. Open [the local reader](http://127.0.0.1:4173). The live feed runs without dependency installation or a provider key. The server needs outbound HTTPS access to the feed hosts in `server/news.mjs`. Use `MODEL_DESK_PORT` to change the local port.

- **Today** scores impact (40%), urgency (30%), and evidence quality (30%). Publication time breaks ties after urgency. An older story can surface again as its deadline approaches. The feed and story reader explain the signals used.
- **Latest** shows recent stories in chronological order.
- **Saved** stores your reading list in this browser.
- The search bar checks headlines, source names, topics, and available excerpts as you type. Search and topic filters apply to the current view.
- The reading theme is saved in your browser. Choose Light, Dark, Sepia, Forest, Rose, Midnight, or Contrast, or use System to follow your device setting.
- Opening a story shows the lead publisher excerpt and all source links grouped under that entry.

The server refreshes its feed snapshot on demand after 10 minutes. The source list includes RSS and Atom feeds, open-source release notes, targeted GitHub advisories, AI-related CISA alerts, and U.S. Federal Register documents. When a source fails, the reader can serve its previous articles and mark that source as cached. Automated grouping uses shared words, versions, identifiers, event type, and timing. It can miss coverage with very different wording.

Ranking is computed from available headlines, snippets, provenance, and structured advisory or policy metadata. A first-party announcement establishes what the publisher announced. The evidence label describes the kind of support available for the story.

## AI briefs

1. Open **Models** and connect a key from OpenAI, Anthropic, or Google Gemini. Enter keys only in the signed-in app. The connection check uses model metadata.
2. Choose a lower-cost structured-output model for **Fact extraction** and a stronger model for **Brief writing**. Use the model IDs shown by your providers. The steps can use different providers or the same one.
3. Open a story and select **Generate brief**. Select **Run fact check** on a brief saved before original-source checks were added. Review each verdict and compare the quotes and source links underneath it.

The app can open approved publisher pages, arXiv abstracts, GitHub release notes, and Federal Register filings through GovInfo. It also checks the collected news for related independent coverage. The source list identifies which material came from an original document or a feed excerpt. Briefs mark direct primary evidence as **Documented**, separate first-hand support as **Independently corroborated**, conflicting accounts as **Sources disagree**, and claims with insufficient confirmation as **Unverified**.

Briefs are generated on demand, limited by the attempt allowance, and reused for identical evidence and model settings. A new brief may make two billed model calls. Provider quotas, pricing, and retention settings apply. The writer receives only the extracted evidence packet. Source links are resolved by the server.

Production uses Sites sign-in, D1, and a 32-byte base64 secret named `MODEL_DESK_VAULT_KEY`. Key ciphertext is scoped to the signed-in user and provider using AES-GCM. The local loopback preview uses an in-memory database and an ephemeral encryption key that reset when the process exits.

The included hosting manifest declares the D1 binding. Supply your own Sites project ID and vault secret when deploying. The Worker relies on Sites to supply authenticated user identity. If you adapt it for a different host, integrate that host’s server-side authentication before enabling AI briefs.

Run `npm test` for the feed and grouping checks. Run `npm run build` to produce the Sites Worker in `dist/server/index.js`. Spectral and Source Sans 3 are distributed under their OFL license files in `public/`.
