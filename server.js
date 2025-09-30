import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check route
app.get("/", (req, res) => {
  res.send("✅ Gemini Backend is running!");
});

// Fetch available Gemini models
async function getModels() {
  const url = `https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
    const data = await res.json();
    return data.models || [];
  } catch (err) {
    console.error("Error fetching models:", err.message);
    return [];
  }
}

// Analyze endpoint
app.post("/analyze", async (req, res) => {
  const { userData, exerciseData } = req.body;

  if (!userData || !exerciseData) {
    return res.status(400).json({ error: "Missing userData or exerciseData" });
  }

  try {
    const models = await getModels();

    // Pick a model that supports text generation
    const suitableModel = models.find((m) =>
      m.supportedGenerationMethods?.includes("generateContent")
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

    const url = `https://generativelanguage.googleapis.com/v1/${suitableModel.name}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      console.error("❌ Gemini API Error:", text);
      return res.status(response.status).json({
        error: "Gemini API returned an error",
        details: text,
      });
    }

    let aiAnswer = "No response from Gemini";

    try {
      const data = JSON.parse(text);
      let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Remove ```json or ``` wrappers if AI adds them
      rawText = rawText.replace(/```json\s*|```/g, "").trim();

      // Extract JSON from response
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        aiAnswer = parsed.analysis || rawText;
      } else {
        aiAnswer = rawText; // fallback
      }
    } catch (e) {
      console.error("❌ Error parsing Gemini response:", e.message);
      aiAnswer = text; // fallback to raw
    }

    console.log("✅ Gemini AI Response:", aiAnswer);
    res.json({ aiAnswer });
  } catch (err) {
    console.error("❌ Error in /analyze route:", err.message);
    res.status(500).json({ error: "Failed to analyze data" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
