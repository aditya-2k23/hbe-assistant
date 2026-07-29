# Hitbullseye Assistant

A Firefox extension that adds a floating panel to Hitbullseye practice test pages. Click it while stuck on a question and it uses the Gemini API to give a short, structured answer.

Each question is only ever sent to the API once. Answers are cached locally, so re-visiting a question you've already asked about costs zero extra API calls.

## Features

- Floating hint panel injected into the test page (collapsible via its header)
- Floating hint panel includes a built-in model switcher for fast vs accurate answers
- Reads only the question currently visible on screen
- Captures both text and visible images from the question area when available
- One Gemini API call per unique question, ever — cached locally afterward
- Auto-fetches a hint when the visible question changes, so you do not need to click for every new question
- Status indicator shows whether a question has already been explained
- Answers are returned in a strict JSON structured format and rendered as a compact answer card:

  ```json
  {
    "kind": "answer",
    "answerOptionNumber": 2,
    "answerOptionText": "The exact option text",
    "explanation": "A concise, specific explanation of why this is the best option.",
    "confidence": "high",
    "alternateConsideration": "Optional short note only if it helps compare a close distractor."
  }
  ```

- Uses your own Gemini API key — nothing is sent to any server other than Gemini's
- Lets you choose the answer model in Settings: fast `gemini-3.5-flash-lite` or more accurate `gemini-3.6-flash`

## Requirements

- A Firefox-based browser (Firefox Desktop 142+, or Firefox for Android 142+)
- A free Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
  The model we are using is `gemini-3.5-flash-lite`, Gemini's fast and low-cost model.

## Installation

There are two ways to install this, depending on what you're doing.

### Option A — Load temporarily (for testing/development only)

This is the fastest way to try it, but it's wiped out every time Firefox restarts — not suitable for regular day-to-day use.

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select the `manifest.json` file inside this project's folder
4. The extension is now active until you restart Firefox

### Option B — Install a signed build (persists across restarts)

Firefox requires extensions to be signed by Mozilla to stay installed permanently, even for personal/private use. This project is distributed as an **unlisted, self-signed** build — not published on the public add-ons store.

**You can download the signed `.xpi` file here:** [hbe-assistant.xpi v1.3.0](./web-ext-artifacts/118705a87f3b402cbf41-1.3.0.xpi)

1. Open Firefox and go to `about:addons`
2. Click the gear icon (⚙️) → **Install Add-on From File…**
3. Select the `.xpi` file
4. Click **Add** when prompted

## Setup after installing

1. Go to `about:addons`, find **Hitbullseye Assistant**, click **Three dots** -> **Options**
2. Paste in your Gemini API key, choose the answer model, and click **Save**
3. Open a Hitbullseye test page — the hint panel should appear in the bottom-right corner

## Usage

- Click **Answer this question** to get a hint for whatever question is currently on screen
- The status line above the button shows whether that question has already been explained — if so, clicking it just re-shows the saved hint at no extra cost
- Click the panel's header to collapse/expand it
- If the question or options include images, the extension sends them to Gemini together with the text when the browser allows canvas access
- If an image is cross-origin and cannot be read safely, the extension falls back to text-only for that image instead of failing the whole hint request
- If the selected model fails or returns no usable answer, the extension will try the other supported model before showing an error

### Ignore below steps if you just want to install the pre-signed `.xpi` — it's only relevant if you want to make changes to the source and sign it yourself

**If you need to produce the signed `.xpi` yourself** (e.g. after making changes to the source):

1. Install the signing tool:

   ```bash
   npm install -g web-ext
   ```

2. Create a free account at [addons.mozilla.org](https://addons.mozilla.org), then generate an API key pair at [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/developers/addon/api/key/) (you'll get a JWT issuer + secret — keep these private)

3. From inside the project folder, lint first to catch manifest errors early:

   ```bash
   web-ext lint
   ```

4. Sign the build:

   ```bash
   web-ext sign --channel=unlisted --api-key=YOUR_JWT_ISSUER --api-secret=YOUR_JWT_SECRET
   ```

5. The signed `.xpi` appears in a new `web-ext-artifacts/` folder — install it using the steps above

> Updating later? Bump `"version"` in `manifest.json`, re-run `web-ext sign`, and reinstall the new `.xpi` the same way — it isn't automatic unless an update URL is configured separately.

## Project structure

```plaintext
hbe-hint-assistant/
├── manifest.json     — extension configuration and permissions
├── content.js        — injected into the page: finds the question, draws the panel
├── content.css        — panel styling
├── background.js      — holds the API key, calls Gemini, enforces answers-only behavior
├── options.html/.js   — settings page for entering your Gemini API key
└── icons/              — extension icons
```

## Notes and limitations

- The domain match in `manifest.json` (`host_permissions` and `content_scripts.matches`) is set to `*.hitbullseye.com` — update this if your test platform uses a different domain
- Question extraction is heuristic-based (it looks for visible answer inputs and walks up the DOM to find the surrounding question text), since it isn't tied to Hitbullseye's exact internal markup. If a particular test layout doesn't extract cleanly, the extraction logic in `content.js` may need adjusting for that layout
- The extension also looks for visible images inside the question container and sends them to Gemini as inline image data when possible; blocked cross-origin images are skipped gracefully
- This extension only works within Firefox-based browsers — it uses the `browser.*` WebExtension APIs, which aren't available in Chromium-based browsers without a separate build
