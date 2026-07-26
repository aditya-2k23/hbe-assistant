// background.js
// Talks to the Gemini API. This is the only place the API key is read,
// and the only place the system prompt is defined — keeping the
// "never give the answer" rule in one spot.

const MODEL = "gemini-3.5-flash-lite"; // fast + cheap; swap to gemini-3.6-flash for better reasoning

const SYSTEM_INSTRUCTION = `
You are a study tutor helping a student practice for placement-exam style
questions (verbal ability, logical/analytical reasoning, or coding) on a
practice platform called Hitbullseye.

You will be given raw text scraped from the current question on screen.
It may include the question stem, answer options, and some stray UI text
(timers, button labels, question numbers) — ignore the UI noise.

STRICT RULES:
1. For each test question I provide, reply using this exact format: [Option Number] [Option Text] - [One-line explanation]
2. Do not include any extra introduction or conclusion.
3. If the extracted text doesn't actually look like a question (e.g. it's navigation or timer text), say so in one short sentence.
`.trim();

browser.runtime.onMessage.addListener((message) => {
  if (message.type !== "GET_HINT") return;
  return handleGetHint(message.question);
});

async function handleGetHint(questionText) {
  const { geminiApiKey } = await browser.storage.local.get("geminiApiKey");

  if (!geminiApiKey) {
    return {
      error:
        "No Gemini API key set yet. Right-click the extension icon → Manage Extension → Preferences to add your key.",
    };
  }

  try {
    const hint = await callGemini(geminiApiKey, questionText);
    return { hint };
  } catch (err) {
    return { error: err.message };
  }
}

async function callGemini(apiKey, questionText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Here is the scraped question content:\n\n"""${questionText}"""\n\nGive me the answer in the format I requested, or tell me if it doesn't look like a question.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 130,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text || "The model didn't return a hint — try again.";
}
