// content.js
// Runs on the Hitbullseye test page. Draws a small floating panel and,
// on request, grabs the text of the CURRENTLY VISIBLE question and asks
// the background script for a HINT (never the answer). Caches hints
// locally so the same question is never sent to the API twice.

(function () {
  const PANEL_ID = "hbe-hint-panel";
  if (document.getElementById(PANEL_ID)) return; // avoid double-injection

  // ---------- 1. Build the floating panel ----------
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div id="hbe-header">
      <span>💡 Hint Assistant</span>
      <button id="hbe-collapse" title="Collapse">-</button>
    </div>
    <div id="hbe-body">
      <div id="hbe-status" class="hbe-status-new">Not explained yet</div>
      <button id="hbe-ask-btn">Answer this question</button>
      <div id="hbe-output" class="hbe-empty">
        <div class="hbe-output-empty-title">Ask for a structured hint</div>
        <div class="hbe-output-empty-copy">Gemini will return a tight answer card with the option, a short explanation, and a confidence note.</div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const askBtn = panel.querySelector("#hbe-ask-btn");
  const output = panel.querySelector("#hbe-output");
  const statusEl = panel.querySelector("#hbe-status");
  const header = panel.querySelector("#hbe-header");
  const collapseBtn = panel.querySelector("#hbe-collapse");
  const body = panel.querySelector("#hbe-body");

  // Whole header toggles collapse now, not just the small icon.
  header.style.cursor = "pointer";
  header.addEventListener("click", () => {
    const collapsed = body.style.display === "none";
    body.style.display = collapsed ? "block" : "none";
    collapseBtn.textContent = collapsed ? "-" : "+";
  });

  // ---------- 2. Visibility helper ----------
  // An input that's part of a hidden/inactive question typically has
  // no layout box at all (display:none up the tree collapses this to 0).
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  // ---------- 3. Heuristic question extractor (visible question only) ----------
  // Many test platforms pre-render every question in the DOM and just
  // toggle visibility per question, instead of mounting/unmounting them.
  // So we filter to VISIBLE inputs first, then only require the container
  // to hold those visible inputs — not every input anywhere on the page.
  function extractQuestionText() {
    const visibleInputs = Array.from(
      document.querySelectorAll('input[type="radio"], input[type="checkbox"]')
    ).filter((el) => !panel.contains(el) && isVisible(el));

    if (visibleInputs.length === 0) {
      return document.body.innerText.slice(0, 4000);
    }

    // Step 1: minimal container holding all visible inputs. On most of
    // these platforms this ends up being JUST the options wrapper — the
    // question stem/directions live in a sibling block one level up.
    let container = visibleInputs[0];
    for (let depth = 0; depth < 8; depth++) {
      if (!container.parentElement) break;
      container = container.parentElement;
      const containsAllVisible = visibleInputs.every((el) => container.contains(el));
      if (containsAllVisible) break;
    }

    // Step 2: keep climbing a bit further to pick up the stem/directions
    // text sitting alongside the options, but stop before we swallow the
    // page chrome (timer, question palette, legend, submit button, etc).
    const STOP_MARKERS = [
      "Time Left", "Question Palette", "Total Questions", "Max attempts",
      "Submit test", "Legend", "Not Visited", "Marked for Review",
    ];
    let expanded = container;
    for (let i = 0; i < 5; i++) {
      if (!expanded.parentElement) break;
      const candidate = expanded.parentElement;
      const candidateText = candidate.innerText || "";
      const hitsChrome = STOP_MARKERS.some((marker) => candidateText.includes(marker));
      if (hitsChrome) break;
      expanded = candidate;
    }
    container = expanded;

    const text = container.innerText.trim();
    return text.length > 20 ? text.slice(0, 4000) : document.body.innerText.slice(0, 4000);
  }

  // ---------- 4. Cheap deterministic hash (djb2) for cache keys ----------
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  function cacheKeyFor(questionText) {
    const scope = location.hostname + location.pathname;
    return `hint_${scope}_${hashString(questionText)}`;
  }

  // ---------- 5. Track which question is on screen & reflect cache state ----------
  let currentKey = null;

  async function refreshForCurrentQuestion() {
    const questionText = extractQuestionText();
    const key = cacheKeyFor(questionText);
    if (key === currentKey) return; // same question as last check, nothing to do

    currentKey = key;
    askBtn.disabled = false;

    const stored = await browser.storage.local.get(key);
    const cached = stored[key];

    if (cached) {
      statusEl.textContent = "✓ Already explained";
      statusEl.className = "hbe-status-cached";
      askBtn.textContent = "Show saved hint";
      renderOutput(cached);
    } else {
      statusEl.textContent = "Not explained yet";
      statusEl.className = "hbe-status-new";
      askBtn.textContent = "Answer this question";
      renderEmptyState();
    }
  }

  // Poll for question changes — these platforms are usually single-page
  // apps that swap content without a full page reload, so there's no
  // reliable page-load event to hook into.
  setInterval(refreshForCurrentQuestion, 1000);
  refreshForCurrentQuestion();

  // ---------- 6. Ask for a hint (cache-first, API only on a real miss) ----------
  askBtn.addEventListener("click", async () => {
    const questionText = extractQuestionText();
    const key = cacheKeyFor(questionText);

    const stored = await browser.storage.local.get(key);
    if (stored[key]) {
      // Already cached — just show it again, no API call.
      renderOutput(stored[key]);
      return;
    }

    output.classList.remove("hbe-empty", "hbe-error");
    output.textContent = "Thinking of a hint…";
    askBtn.disabled = true;

    try {
      const response = await browser.runtime.sendMessage({
        type: "GET_HINT",
        question: questionText,
      });

      if (response && response.error) {
        renderError(response.error);
      } else {
        renderOutput(response.hint);
        await browser.storage.local.set({ [key]: response.hint });
        statusEl.textContent = "✓ Already explained";
        statusEl.className = "hbe-status-cached";
        askBtn.textContent = "Show saved hint";
      }
    } catch (err) {
      renderError("Something went wrong talking to the extension: " + err.message);
    } finally {
      askBtn.disabled = false;
    }
  });

  function renderEmptyState() {
    output.className = "hbe-empty";
    replaceOutputChildren(
      createTextBlock(
        "hbe-output-empty-title",
        "Ask for a structured hint"
      ),
      createTextBlock(
        "hbe-output-empty-copy",
        "Gemini will return a tight answer card with the option, a short explanation, and a confidence note."
      )
    );
  }

  function renderError(message) {
    output.className = "hbe-error";
    replaceOutputChildren(
      createTextBlock("hbe-error-title", "Could not generate a hint"),
      createTextBlock("hbe-error-copy", message)
    );
  }

  function renderOutput(value) {
    const hint = normalizeHintValue(value);

    if (hint.kind === "not_question") {
      output.className = "hbe-empty";
      replaceOutputChildren(
        createTextBlock("hbe-output-empty-title", "Not a question"),
        createTextBlock(
          "hbe-output-empty-copy",
          hint.message || "The extracted content does not look like a question."
        )
      );
      return;
    }

    if (hint.kind === "raw") {
      output.className = "hbe-raw";
      replaceOutputChildren(createPreBlock("hbe-raw-text", hint.text));
      return;
    }

    output.className = "hbe-answer-card";
    const card = document.createElement("div");
    card.className = "hbe-answer-card";

    const topLine = document.createElement("div");
    topLine.className = "hbe-answer-topline";

    const badge = document.createElement("div");
    badge.className = "hbe-answer-badge";
    badge.textContent = hint.answerOptionNumber ? `Option ${String(hint.answerOptionNumber)}` : "Best option";

    const confidence = document.createElement("div");
    confidence.className = `hbe-answer-confidence confidence-${sanitizeTone(hint.confidence || "medium")}`;
    confidence.textContent = String(hint.confidence || "medium").toUpperCase();

    topLine.append(badge, confidence);

    const option = createTextBlock("hbe-answer-option", hint.answerOptionText || "");
    const explanation = createTextBlock("hbe-answer-explanation", hint.explanation || "");

    card.append(topLine, option, explanation);

    if (hint.alternateConsideration) {
      card.append(createDividerBlock("hbe-answer-alt", hint.alternateConsideration));
    }

    replaceOutputChildren(card);
  }

  function normalizeHintValue(value) {
    if (!value || typeof value !== "object") {
      return { kind: "raw", text: String(value || "") };
    }

    return value;
  }

  function escapeHtml(value) {
    const span = document.createElement("span");
    span.textContent = String(value);
    return span.innerHTML;
  }

  function replaceOutputChildren(...nodes) {
    output.replaceChildren(...nodes.filter(Boolean));
  }

  function createTextBlock(className, text) {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = text;
    return element;
  }

  function createPreBlock(className, text) {
    const element = document.createElement("pre");
    element.className = className;
    element.textContent = text;
    return element;
  }

  function createDividerBlock(className, text) {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = text;
    return element;
  }

  function sanitizeTone(value) {
    const tone = String(value).toLowerCase();
    if (tone === "high" || tone === "medium" || tone === "low") {
      return tone;
    }
    return "medium";
  }
})();
