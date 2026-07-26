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
      <div id="hbe-output" class="hbe-empty"></div>
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

    let container = visibleInputs[0];
    for (let depth = 0; depth < 8; depth++) {
      if (!container.parentElement) break;
      container = container.parentElement;
      const containsAllVisible = visibleInputs.every((el) => container.contains(el));
      if (containsAllVisible) break;
    }

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
      output.classList.remove("hbe-empty", "hbe-error");
      output.textContent = cached;
    } else {
      statusEl.textContent = "Not explained yet";
      statusEl.className = "hbe-status-new";
      askBtn.textContent = "Answer this question";
      output.className = "hbe-empty";
      output.textContent = "";
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
      output.classList.remove("hbe-empty", "hbe-error");
      output.textContent = stored[key];
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
        output.classList.add("hbe-error");
        output.textContent = response.error;
      } else {
        output.textContent = response.hint;
        await browser.storage.local.set({ [key]: response.hint });
        statusEl.textContent = "✓ Already explained";
        statusEl.className = "hbe-status-cached";
        askBtn.textContent = "Show saved hint";
      }
    } catch (err) {
      output.classList.add("hbe-error");
      output.textContent = "Something went wrong talking to the extension: " + err.message;
    } finally {
      askBtn.disabled = false;
    }
  });
})();