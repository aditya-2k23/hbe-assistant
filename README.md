# Hitbullseye Assistant

A Firefox extension that adds a floating panel to Hitbullseye practice test pages. Click it while stuck on a question and it uses the Gemini API to give short answer.

Each question is only ever sent to the API once. Answers are cached locally, so re-visiting a question you've already asked about costs zero extra API calls.

## Features

- Floating hint panel injected into the test page (collapsible via its header)
- Reads only the question currently visible on screen
- One Gemini API call per unique question, ever — cached locally afterward
- Status indicator shows whether a question has already been explained
- Answers are in a structured format: `[Option Number] [Option Text] - [One-line explanation]`
- Uses your own Gemini API key — nothing is sent to any server other than Gemini's

## Requirements

- A Firefox-based browser (Firefox Desktop 142+, or Firefox for Android 142+)
- A free Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
  The model we are using is `gemini-3.5-flash-lite` Gemini's fastest and cheapest model yet.

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

**You can download the signed `.xpi` file here:** [hbe-assistant.xpi v1.1.4](./web-ext-artifacts/118705a87f3b402cbf41-1.1.4.xpi)

1. Open Firefox and go to `about:addons`
2. Click the gear icon (⚙️) → **Install Add-on From File…**
3. Select the `.xpi` file
4. Click **Add** when prompted

## Setup after installing

1. Go to `about:addons`, find **Hitbullseye Assistant**, click **Three dots** -> **Options**
2. Paste in your Gemini API key and click **Save**
3. Open a Hitbullseye test page — the hint panel should appear in the bottom-right corner

## Usage

- Click **Answer this question** to get a hint for whatever question is currently on screen
- The status line above the button shows whether that question has already been explained — if so, clicking it just re-shows the saved hint at no extra cost
- Click the panel's header to collapse/expand it

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
├── background.js      — holds the API key, calls Gemini, enforces hints-only behavior
├── options.html/.js   — settings page for entering your Gemini API key
└── icons/              — extension icons
```

## Notes and limitations

- The domain match in `manifest.json` (`host_permissions` and `content_scripts.matches`) is set to `*.hitbullseye.com` — update this if your test platform uses a different domain
- Question extraction is heuristic-based (it looks for visible answer inputs and walks up the DOM to find the surrounding question text), since it isn't tied to Hitbullseye's exact internal markup. If a particular test layout doesn't extract cleanly, the extraction logic in `content.js` may need adjusting for that layout
- This extension only works within Firefox-based browsers — it uses the `browser.*` WebExtension APIs, which aren't available in Chromium-based browsers without a separate build
