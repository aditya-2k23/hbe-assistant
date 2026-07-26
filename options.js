const input = document.getElementById("apiKey");
const status = document.getElementById("status");

// Load any existing key on page open
browser.storage.local.get("geminiApiKey").then(({ geminiApiKey }) => {
  if (geminiApiKey) input.value = geminiApiKey;
});

document.getElementById("save").addEventListener("click", async () => {
  const value = input.value.trim();
  await browser.storage.local.set({ geminiApiKey: value });
  status.textContent = "Saved ✓";
  setTimeout(() => (status.textContent = ""), 2000);
});
