// background.js
// Talks to the Gemini API. This is the only place the API key is read,
// and the only place the system prompt is defined — keeping the
// "never give the answer" rule in one spot.

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MODEL_LABELS = {
  "gemini-3.5-flash-lite": "Fast",
  "gemini-3.6-flash": "Accurate",
};

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
  return handleGetHint(message.question, message.retry === true);
});

async function handleGetHint(questionPayload, isRetry = false) {
  const { geminiApiKey, geminiModel } = await browser.storage.local.get([
    "geminiApiKey",
    "geminiModel",
  ]);

  if (!geminiApiKey) {
    return {
      error:
        "No Gemini API key set yet. Go to extension's settings (Gear icon) → Manage Extension → Three Dots -> Options to add your key.",
    };
  }

  try {
    const hint = await callGemini(geminiApiKey, questionPayload, isRetry, geminiModel);
    return { hint };
  } catch (err) {
    return { error: err.message };
  }
}

async function callGemini(apiKey, questionPayload, isRetry = false, selectedModel) {
  const models = buildModelChain(selectedModel);
  let lastError = null;

  for (const model of models) {
    try {
      const hint = await callGeminiModel(apiKey, questionPayload, isRetry, model);
      if (hint) {
        return hint;
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Gemini did not return a usable answer.");
}

function buildModelChain(selectedModel) {
  const normalized = normalizeModelName(selectedModel);
  if (normalized === "gemini-3.6-flash") {
    return ["gemini-3.6-flash", DEFAULT_MODEL];
  }

  return [DEFAULT_MODEL, "gemini-3.6-flash"];
}

function normalizeModelName(modelName) {
  return Object.prototype.hasOwnProperty.call(MODEL_LABELS, modelName) ? modelName : DEFAULT_MODEL;
}

async function callGeminiModel(apiKey, questionPayload, isRetry, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const contentParts = buildContentParts(questionPayload, isRetry);

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
    throw new Error(`Gemini model ${model} did not return an answer.`);
  }

  return parseGeminiHint(text);
}

function buildContentParts(questionPayload, isRetry = false) {
  const payload = normalizeQuestionPayload(questionPayload);
  const parts = [];

  parts.push({
    text: `${isRetry ? "This is a retry because the previous pass may have incorrectly classified a real question as not a question. Re-evaluate carefully. If there is any plausible question stem, answer options, diagram, chart, code screenshot, or image-based prompt, treat it as a real question and provide the best hint." : "Here is the scraped question content:"}\n\n"""${payload.text}"""\n\nUse any attached images as part of the question. If image content is unreadable or unavailable, rely on the text and still provide the best possible hint. Return only the JSON object requested in the system instructions.`,
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
  const parsed = parseModelJson(text);

  if (parsed && typeof parsed === "object") {
    if (parsed.kind === "not_question") {
      return {
        kind: "not_question",
        message: String(parsed.message || "The extracted text does not look like a question."),
      };
    }

    if (parsed.kind === "answer" || parsed.kind === "hint") {
      const answerOptionNumber = parsed.answerOptionNumber ?? parsed.optionNumber ?? null;
      const answerOptionText = parsed.answerOptionText ?? parsed.optionText ?? "";
      const explanation = parsed.explanation ?? parsed.reason ?? parsed.text ?? "";

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

function parseModelJson(text) {
  const candidates = [text, stripCodeFences(text), extractJsonBlock(text)];

  for (const candidate of candidates) {
    const parsed = safeParseJson(candidate);
    if (!parsed) continue;

    if (typeof parsed === "string") {
      const innerParsed = safeParseJson(stripCodeFences(parsed));
      if (innerParsed) return innerParsed;
      continue;
    }

    return parsed;
  }

  return null;
}

function extractJsonBlock(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return text;
  }

  return text.slice(firstBrace, lastBrace + 1).trim();
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
