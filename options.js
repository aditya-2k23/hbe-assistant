const input = document.getElementById("apiKey");
const modelSelect = document.getElementById("model");
const status = document.getElementById("status");

const DEFAULT_MODEL = "gemini-3.5-flash-lite";

// Load any existing key on page open
browser.storage.local.get(["geminiApiKey", "geminiModel"]).then(({ geminiApiKey, geminiModel }) => {
  if (geminiApiKey) input.value = geminiApiKey;
  modelSelect.value = geminiModel || DEFAULT_MODEL;
});

document.getElementById("save").addEventListener("click", async () => {
  const value = input.value.trim();
  const model = modelSelect.value || DEFAULT_MODEL;
  await browser.storage.local.set({ geminiApiKey: value, geminiModel: model });
  status.textContent = "Saved ✓";
  setTimeout(() => (status.textContent = ""), 2000);
});
