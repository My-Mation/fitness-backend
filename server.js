import express from "express";
import cors from "cors";
import fetch from "node-fetch";

// dotenv is NOT needed on Railway; remove it for production
// import dotenv from "dotenv";
// dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => res.send("✅ Gemini Backend is running!"));

// Quick test endpoint to verify GEMINI_API_KEY is loaded
app.get("/test-key", (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).send("❌ GEMINI_API_KEY not found in environment");
  }
  res.send(`✅ GEMINI_API_KEY loaded: ${process.env.GEMINI_API_KEY.slice(0,5)}…`);
});

// Fetch available models
async function getModels() {
  const url = `https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
    const data = await res.json();
    console.log("Available models:", data.models || []);
    return data.models || [];
  } catch (err) {
    console.error("Error fetching models:", err);
    return [];
  }
}

// Analyze endpoint
app.post("/analyze", async (req, res) => {
  const { userData, exerciseData } = req.body;

  if (!userData || !exerciseData)
    return res.status(400).json({ error: "Missing userData or exerciseData" });

  try {
    const models = await getModels();

    // Pick any model that supports text generation
    const suitableModel = models.find((m) =>
      m.supportedGenerationMethods?.some((method) =>
        ["generateContent", "generateText"].includes(method)
      )
    );

    if (!suitableModel) {
      return res.status(500).json({ error: "No suitable Gemini model found" });
    }

    const promptText = `Analyze the following user data and provide actionable fitness advice.
Respond ONLY in JSON with a single key "analysis".

User Data: ${JSON.stringify(userData)}
Exercise Data: ${JSON.stringify(exerciseData)}

Example output:
{
  "analysis": "Your detailed fitness advice here."
}`;

    // Use generateContent if available, else generateText
    const methodName = suitableModel.supportedGenerationMethods.includes("generateContent")
      ? "generateContent"
      : "generateText";

    const url = `https://generativelanguage.googleapis.com/v1/${suitableModel.name}:${methodName}?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
    });

    const text = await response.text();

    if (!response.ok) {
      console.error("Gemini API Error:", text);
      return res.status(response.status).json({ error: "Gemini API returned an error", details: text });
    }

    let aiAnswer = "No response from AI";
    try {
      const data = JSON.parse(text);
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const cleaned = rawText.replace(/```json\s*|```/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      aiAnswer = jsonMatch ? JSON.parse(jsonMatch[0]).analysis || cleaned : cleaned;
    } catch (e) {
      console.error("Error parsing Gemini response:", e);
      aiAnswer = text;
    }

    console.log("✅ Gemini AI response:", aiAnswer);
    res.json({ aiAnswer });
  } catch (err) {
    console.error("Error calling Gemini API:", err);
    res.status(500).json({ error: "Failed to analyze data" });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
