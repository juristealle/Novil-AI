import { Message } from "../types";

export async function runNovilSmart(
  _model: string,
  finalPrompt: string,
  currentImage: string | null,
  conversation: Message[],
  setDownloadStatus: (status: string) => void,
): Promise<string> {
  setDownloadStatus("Thinking deeply (8B)...");

  const recentHistory = conversation
    .slice(-4)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  try {
    const res = await fetch("http://localhost:11435/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3-vl:8b",
        system: "You are Novil, an offline AI coding assistant.",
        prompt: `Recent chat:\n${recentHistory}\n\nUser: "${finalPrompt}". Answer the user.`,
        stream: false,
        think: false,
        images: currentImage ? [currentImage] : undefined,
        options: { num_ctx: 16384, num_predict: 4000, temperature: 0.3 },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }

    const data = await res.json();
    console.log("NOVIL SMART RAW:", data);

    return data.response || "The 8B model returned an empty response.";
  } catch (err) {
    console.error("Novil Smart failed:", err);
    return "The 8B model crashed. You might not have enough RAM.";
  }
}
