# AI Studio Chat Exporter

Tampermonkey user script that adds a draggable **Export JSON** button to Google AI Studio chats and saves a clean Markdown-friendly conversation archive. The exporter scrapes the full conversation, captures the system prompt, converts model responses to Markdown (including code fences), and downloads everything as a JSON file in one click.

## Features
- Multi-language UI (简体中文 / English / Deutsch / Русский / 日本語) with auto-detected locale
- Draggable floating export button that remembers its position per page session
- Automatic system prompt detection, even when the sidebar is collapsed
- Robust Markdown conversion for rich text, headings, lists, inline/code blocks
- Scroll automation to ensure every chat turn is collected before export
- Downloads a sanitized JSON payload ready for archival or downstream tooling

## Prerequisites
- Desktop Chromium-based browser (Chrome, Edge, Brave, etc.)
- Userscript manager: Tampermonkey (recommended) or Violentmonkey

## Installation
1. Install [Tampermonkey](https://www.tampermonkey.net/) (or another compatible userscript manager) in your browser.
2. Open the raw version of [`script.js`](./script.js) in the repository.
3. Click **Install** (Tampermonkey) or **Confirm** to add the script.
4. Ensure the script is enabled for `https://aistudio.google.com/prompts/*`.

## Usage
1. Navigate to any conversation inside [Google AI Studio](https://aistudio.google.com/prompts/).
2. Wait for the floating **Export JSON** button to appear at the top of the viewport.
3. Drag the button to any convenient position (optional).
4. Click the button to start the export workflow:
	 - The script fetches the system prompt (auto-expands the sidebar when necessary).
	 - The chat pane is scrolled to collect every turn.
	 - Each turn is converted to Markdown-safe text.
	 - A JSON file named after the current project title is downloaded.

The exported file contains:

```json
{
	"system_instruction": "...",
	"messages": [
		{ "role": "user", "content": "..." },
		{ "role": "assistant", "content": "..." }
	]
}
```

## Internationalization
The UI text is automatically localized based on `navigator.language`. Currently supported prefixes:

| Language | Locale Prefix |
|----------|---------------|
| 简体中文 | `zh` |
| English  | `en` |
| Deutsch  | `de` |
| Русский  | `ru` |
| 日本語   | `ja` |

Fallback defaults to English when the active locale is not listed.

## Troubleshooting
- **Button missing**: Reload the page; ensure the userscript manager shows the script as active.
- **Empty export**: Make sure the chat has loaded fully; the script requires the standard AI Studio layout.
- **System prompt blank**: Some conversations may not expose a system prompt. The script still exports user/model turns.
- **Permission prompts**: Tampermonkey might ask for new URL permissions after updates—accept them to keep exporting.

## Contributing
Pull requests are welcome. Please keep the userscript self-contained and adopt concise comments only when logic is non-obvious. For translation updates, extend the `MESSAGES` map in `script.js` and mention the new locale in this README.

## License
[MIT](./LICENSE)