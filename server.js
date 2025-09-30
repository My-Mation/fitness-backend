import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Middleware =====
app.use(cors());
app.use(express.json());

// ===== Startup Failsafe =====
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is missing! Set it in Railway service variables.");
  process.exit(1);
}

// ===== Health Check =====
app.get("/", (req, res) => res.send("✅ Gemini Backend is running!"));

// ===== Test Key Endpoint =====
app.get("/test-key", (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).send("❌ GEMINI_API_KEY missing");
  res.send(`✅ GEMINI_API_KEY loaded: ${key.slice(0, 5)}…`);
});

// ===== Helper: Fetch Models =====
async function getModels() {
  const url = `https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch models: ${res.status} ${res.statusText} | ${text}`);
    }

    const data = await res.json();
    if (!data.models || !Array.isArray(data.models)) {
      throw new Error("Models response invalid or empty");
    }

    console.log("✅ Models fetched:", data.models.map(m => m.name));
    return data.models;
  } catch (err) {
    console.error("❌ Error fetching models:", err);
    return [];
  }
}

// ===== Analyze Endpoint =====
app.post("/analyze", async (req, res) => {
  const { userData, exerciseData } = req.body;

  if (!userData || !exerciseData) {
    return res.status(400).json({ error: "Missing userData or exerciseData" });
  }

  try {
    const models = await getModels();
    if (!models.length) {
      return res.status(500).json({ error: "No models available from Gemini API" });
    }

    // Pick suitable model
    const suitableModel = models.find((m) =>
      m.supportedGenerationMethods?.some((method) =>
        ["generateContent", "generateText"].includes(method)
      )
    );

    if (!suitableModel) {
      return res.status(500).json({ error: "No suitable Gemini model found" });
    }

    const methodName = suitableModel.supportedGenerationMethods.includes("generateContent")
      ? "generateContent"
      : "generateText";

    const promptText = `Analyze the following user data and provide actionable fitness advice.
Respond ONLY in JSON with a single key "analysis".

User Data: ${JSON.stringify(userData)}
Exercise Data: ${JSON.stringify(exerciseData)}

Example output:
{
  "analysis": "Your detailed fitness advice here."
}`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1/${suitableModel.name}:${methodName}?key=${process.env.GEMINI_API_KEY}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await response.text();

    if (!response.ok) {
      console.error("❌ Gemini API Error:", text);
      return res.status(response.status).json({ error: "Gemini API returned an error", details: text });
    }

    let aiAnswer = "No response from AI";
    try {
      const data = JSON.parse(text);
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const cleaned = rawText.replace(/```json\s*|```/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      aiAnswer = jsonMatch ? JSON.parse(jsonMatch[0]).analysis || cleaned : cleaned;
    } catch (err) {
      console.warn("⚠️ Failed parsing Gemini response, returning raw text", err);
      aiAnswer = text;
    }

    console.log("✅ AI response:", aiAnswer);
    res.json({ aiAnswer });

  } catch (err) {
    if (err.name === "AbortError") {
      console.error("❌ Request to Gemini API timed out");
      return res.status(504).json({ error: "Gemini API request timed out" });
    }
    console.error("❌ Unexpected error:", err);
    res.status(500).json({ error: "Failed to analyze data", details: err.message });
  }
});

// ===== Start Server =====
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
