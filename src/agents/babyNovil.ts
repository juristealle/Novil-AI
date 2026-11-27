import { Message } from "../types";

export async function runBabyNovil(
  conversation: Message[],
  systemPrompt: string,
  setDownloadStatus: (status: string) => void,
): Promise<string> {
  setDownloadStatus("Replying...");

  const chatMessages = [
    { role: "system", content: systemPrompt },
    ...conversation
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.content && m.content.trim() !== "")
      .map((m) => {
        if (m.image) {
          return { role: m.role, content: m.content, images: [m.image] };
        }
        return { role: m.role, content: m.content };
      }),
  ];

  try {
    const chatRes = await fetch("http://localhost:11435/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5-coder:1.5b",
        messages: chatMessages,
        stream: false,
        options: { num_predict: 1024, temperature: 0.3 },
      }),
    });

    if (!chatRes.ok) {
      throw new Error(`Ollama returned ${chatRes.status}`);
    }

    const chatData = await chatRes.json();

    const content = chatData.message?.content || chatData.response;

    if (!content) {
      console.error("Empty response from Ollama:", chatData);
      return "I couldn't generate a response. Try asking again.";
    }

    return content;
  } catch (error) {
    console.error("Baby Novil failed:", error);
    return "I couldn't connect to the AI model. Please try again.";
  }
}
