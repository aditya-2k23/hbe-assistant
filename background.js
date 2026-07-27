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
It may include the question stem, answer options, and stray UI text
(timers, button labels, question numbers) — ignore the UI noise.

STRICT OUTPUT RULES:
1. Return exactly one valid JSON object and nothing else.
2. Do not wrap the JSON in markdown fences or add commentary.
3. Use this shape when the text is a real question:
   {
     "kind": "answer",
     "answerOptionNumber": 2,
     "answerOptionText": "The exact option text",
     "explanation": "A concise, specific explanation of why this is the best option.",
     "confidence": "high",
     "alternateConsideration": "Optional short note only if it helps compare a close distractor."
   }
4. Use this shape when the text is not a question:
   {
     "kind": "not_question",
     "message": "One short sentence explaining why the content does not look like a question."
   }
5. Keep explanations crisp and practical. Do not mention that you are an AI.
`.trim();

browser.runtime.onMessage.addListener((message) => {
  if (message.type !== "GET_HINT") return;
  return handleGetHint(message.question);
});

async function handleGetHint(questionPayload) {
  const { geminiApiKey } = await browser.storage.local.get("geminiApiKey");

  if (!geminiApiKey) {
    return {
      error:
        "No Gemini API key set yet. Go to extension's settings (Gear icon) → Manage Extension → Three Dots -> Options to add your key.",
    };
  }

  try {
    const hint = await callGemini(geminiApiKey, questionPayload);
    return { hint };
  } catch (err) {
    return { error: err.message };
  }
}

async function callGemini(apiKey, questionPayload) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const contentParts = buildContentParts(questionPayload);

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
          parts: contentParts,
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 220,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return { kind: "raw", text: "The model didn't return an answer — try again." };
  }

  return parseGeminiHint(text);
}

function buildContentParts(questionPayload) {
  const payload = normalizeQuestionPayload(questionPayload);
  const parts = [];

  parts.push({
    text: `Here is the scraped question content:\n\n"""${payload.text}"""\n\nUse any attached images as part of the question. If image content is unreadable or unavailable, rely on the text and still provide the best possible hint. Return only the JSON object requested in the system instructions.`,
  });

  for (const image of payload.images) {
    if (!image?.data || !image?.mimeType) continue;
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    });
  }

  return parts;
}

function normalizeQuestionPayload(questionPayload) {
  if (typeof questionPayload === "string") {
    return { text: questionPayload, images: [] };
  }

  if (!questionPayload || typeof questionPayload !== "object") {
    return { text: "", images: [] };
  }

  return {
    text: String(questionPayload.text || ""),
    images: Array.isArray(questionPayload.images) ? questionPayload.images : [],
  };
}

function parseGeminiHint(text) {
  const parsed = safeParseJson(stripCodeFences(text));

  if (parsed && typeof parsed === "object") {
    if (parsed.kind === "not_question") {
      return {
        kind: "not_question",
        message: String(parsed.message || "The extracted text does not look like a question."),
      };
    }

    const answerOptionNumber = parsed.answerOptionNumber ?? parsed.optionNumber ?? null;
    const answerOptionText = parsed.answerOptionText ?? parsed.optionText ?? "";
    const explanation = parsed.explanation ?? parsed.reason ?? "";

    return {
      kind: "answer",
      answerOptionNumber: answerOptionNumber === null ? null : Number(answerOptionNumber),
      answerOptionText: String(answerOptionText),
      explanation: String(explanation),
      confidence: parsed.confidence ? String(parsed.confidence) : "medium",
      alternateConsideration: parsed.alternateConsideration ? String(parsed.alternateConsideration) : "",
      rawText: text,
    };
  }

  return { kind: "raw", text };
}

function stripCodeFences(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const firstNewline = trimmed.indexOf("\n");
  const lastFence = trimmed.lastIndexOf("```");
  if (firstNewline === -1 || lastFence === -1 || lastFence <= firstNewline) {
    return trimmed;
  }

  return trimmed.slice(firstNewline + 1, lastFence).trim();
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
