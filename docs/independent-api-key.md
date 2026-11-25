# Independent OpenAI API key

In **HP Codex → Settings → Independent API key**, save a separate OpenAI Platform project key with the masked VS Code prompt. Saving, replacing and removing the key uses HP's VS Code SecretStorage entry. Connect explicitly to API mode. Before a potentially billable turn, confirm the native VS Code dialog. The inherited native account remains the default connection.

## Routing and isolation

HP Codex checks the original native config and managed requirements before opening an API connection. Configured proxies, alternate routing, forced login/workspace routing, non-null or unknown managed requirements, remote extension hosts, and reuse of a key found in the inherited environment block this preview.

The extension host owns the actual key. It launches the native App Server with a unique per-connection Responses provider pointing to a randomized loopback endpoint. The child receives a distinct capability. The extension verifies the effective provider and thread provider before billing, disables provider retries, and arms the relay only after turn consent. Mode switches require a confirmed idle state and start a fresh conversation. An ambiguous request requires reconciliation.

The relay accepts authenticated JSON POSTs on the Responses and compact routes. It forwards to the fixed `api.openai.com` HTTPS destination, rejects cross-origin requests and redirects, bounds body size and concurrent traffic, and closes on disconnect. The extension shows authorization or rate-limit errors without forwarding upstream error bodies to the webview. An accepted real response is evidence of key usability for that request; locally saved key format is a separate status.

## Billing and qualification

API rate estimates use response-reported model, tier, input, cache and output fields. The dated rates cover known standard short-context models and omit unpriced responses. Estimates cover tokens only. OpenAI bills usage under the API project's terms. [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)

The local capability can be inherited by native tools depending on permission policy. Same-user compromise, enterprise routing and actual paid SSE remain release qualification items. ChatGPT-only entitlements and connected app availability can differ across modes. [Security review](security-review.md), [Acceptance](acceptance.md)
