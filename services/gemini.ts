import { GoogleGenAI } from "@google/genai";
import { Trade, Trader } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function analyzeTraderStrategy(trader: Trader, trades: Trade[]) {
  const prompt = `
    Analyze the following trading history for a Polymarket user.
    Trader: ${trader.username || trader.address}
    Bio: ${trader.bio || 'No bio provided'}
    
    Recent Trades:
    ${trades.slice(0, 15).map(t => `- ${t.side} on "${t.market_title}" (Outcome: ${t.outcome}) at price ${t.price}c, size $${t.size}`).join('\n')}

    Provide a concise analysis of their strategy. Are they a contrarian? Do they follow trends? What categories do they specialize in?
    Answer in professional financial analyst tone.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        temperature: 0.7,
        topP: 0.95
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Failed to generate AI analysis. Check API logs.";
  }
}