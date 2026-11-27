import { Message } from "../types";
import { NOVIL_CODER_SYSTEM } from "../prompts/novilCoderSystem";

export async function runNovilCoder(
  _model: string,
  finalPrompt: string,
  currentImage: string | null,
  conversation: Message[],
  coderHistory: string[],
  chatSummary: string | undefined,
  setDownloadStatus: (status: string) => void,
): Promise<{
  intro: string;
  plan: string;
  code: string;
  newCoderEntry: string;
}> {
  const recentHistory = conversation
    .slice(-4)
    .map((m) => {
      const textOnly = m.content.replace(
        /```[\s\S]*?```/g,
        "[Code Block Output Omitted for Brevity]",
      );
      return `${m.role}: ${textOnly}`;
    })
    .join("\n");

  const contextHistory = chatSummary
    ? `[SUMMARY OF PREVIOUS CHAT]:\n${chatSummary}\n\n[RECENT CHAT]:\n${recentHistory}`
    : recentHistory;

  let route = "[REASON]";

  function getLastCodeOnly(history: string[]): string {
    if (history.length === 0) return "";

    const lastEntry = history[history.length - 1];

    const match = lastEntry.match(/```[\s\S]*?```/);

    return match ? match[0] : lastEntry;
  }

  if (!currentImage) {
    setDownloadStatus("Responding...");
    const routerRes = await fetch("http://localhost:11435/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:3b",
        system: `${NOVIL_CODER_SYSTEM}\n\nYou are acting as the Router. You classify intent.`,
        prompt: `Recent chat:\n${contextHistory}\n\nUser's latest request: "${finalPrompt}"\n\nClassify the user's intent based on their latest request:\n- [CHAT]: Greetings, casual conversation, or short replies.\n- [REASON]: Questions, explanations, debugging help, or asking what existing code does.\n- [CODE]: Explicit requests to write, build, create, modify, or fix code.\n\nReply ONLY with [CHAT], [REASON], or [CODE].`,
        stream: false,
        think: false,
        options: { num_ctx: 8192, num_predict: 10, temperature: 0.1 },
      }),
    });
    const routerData = await routerRes.json();
    if (routerData?.response) {
      const raw = routerData.response.trim().toUpperCase();
      if (raw === "[CHAT]") {
        const chatRes = await fetch("http://localhost:11435/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "qwen2.5:3b",
            system: `${NOVIL_CODER_SYSTEM}\n\nYou are acting as the Voice. Reply in one friendly sentence.`,
            prompt: `Recent chat:\n${contextHistory}\n\nUser said: "${finalPrompt}".`,
            stream: false,
            think: false,
            options: { num_ctx: 8192, num_predict: 50, temperature: 0.7 },
          }),
        });
        const chatData = await chatRes.json();
        return {
          intro: chatData.response || "Hello!",
          plan: "",
          code: "",
          newCoderEntry: "",
        };
      } else if (raw.includes("[CODE]")) {
        route = "[CODE]";
      }
    }
  } else {
    route = "[CODE]";
  }

  if (route === "[CODE]") {
    // 2. THE REASONER
    setDownloadStatus("Planning the code...");
    const reasonerModel = currentImage ? "qwen3.5:2b" : "qwen2.5:3b";
    const reasonerRes = await fetch("http://localhost:11435/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: reasonerModel,
        system: `${NOVIL_CODER_SYSTEM}\n\nYou are currently acting as the Reasoner. Write a brief plan for the Coder.`,
        prompt: `You are the Parietal Lobe of the Novil AI system. 
Here is the recent chat history:\n${contextHistory}\n\nUser's latest request: "${finalPrompt}".

Write a VERY brief plan (under 3 bullet points) for the Coder. 
CRITICAL: The user is currently asking for code. Ignore any previous images or topics. Focus ONLY on the latest request.
If the user is asking to change the style of the previous code (e.g., "make it cute"), tell the Coder exactly what to change.
If the user is asking for new code, describe the layout.
Do NOT write code. Just the plan.`,
        stream: false,
        images: currentImage ? [currentImage] : undefined,
        options: { num_ctx: 8192, num_predict: 1000, temperature: 0.3 },
      }),
    });
    const reasonerData = await reasonerRes.json();
    const plan =
      reasonerData.response?.trim() || "Write the code based on the request.";

    // 3. THE CODER
    setDownloadStatus("Writing the code...");
    const coderRes = await fetch("http://localhost:11435/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.5:4b",
        system: `${NOVIL_CODER_SYSTEM}\n\nYou are currently acting as the Coder. You do NOT write tutorials. You ONLY output code.`,
        prompt: `You are the Cerebellum of the Novil AI system. You are a strict code execution engine.
You do NOT write tutorials. You do NOT explain. You ONLY output code.

Here is your code history:\n${coderHistory.slice(-2).join("\n\n")}

Here is your previous code:\n${getLastCodeOnly(coderHistory)}\n\n
The Parietal Lobe has given you this plan:
"${plan}"

Your job:
If the user is asking to modify the previous code (e.g., "change it to cute style"), find the LAST code block you wrote in the history, and rewrite it with the new changes.
If the user is asking for brand new code, write it from scratch based on the plan.

CRITICAL RULE 1: Output ONLY the markdown code block. No intro, no outro, no explanation. Start with \`\`\` and end with \`\`\`.
CRITICAL RULE 2: If you are running out of tokens, CLOSE ALL HTML TAGS IMMEDIATELY and output \`\`\` to end the code block. Never leave a tag or attribute unfinished.`,
        stream: false,
        think: false,
        options: { num_ctx: 16384, num_predict: 6000, temperature: 0.1 },
      }),
    });
    const coderData = await coderRes.json();
    let code = coderData.response || "```\n// Code generation failed.\n```";
    if (code.startsWith("```") && !code.trim().endsWith("```")) {
      code += "\n```";
    }

    setDownloadStatus("Reviewing code for errors...");

    const reviewerRes = await fetch("http://localhost:11435/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.5:4b",
        system: `${NOVIL_CODER_SYSTEM}\n\nYou are currently acting as the Code Reviewer. You do NOT write tutorials. You ONLY output code.`,
        prompt: `You are the Code Reviewer for the Novil AI system.
The Coder just generated this code based on the plan:
"${plan}"

Here is the Coder's draft:
${code}

Your job:
1. Mentally trace the execution of the code. 
2. Check for scope errors (e.g., using a variable like 'crud' inside a class where it isn't defined).
3. Check for "lazy" shortcuts like "// TODO: Implement logic". If you see a TODO, write the actual implementation using a simple in-memory data structure (like a HashMap or ArrayList).
4. Ensure all braces and imports are correct.

CRITICAL RULE 1: Output ONLY the corrected markdown code block. No intro, no outro, no explanation. Start with \`\`\` and end with \`\`\`.
CRITICAL RULE 2: If you are running out of tokens, CLOSE ALL TAGS IMMEDIATELY and output \`\`\` to end the code block.`,
        stream: false,
        think: false,
        options: { num_ctx: 16384, num_predict: 6000, temperature: 0.1 },
      }),
    });

    const reviewerData = await reviewerRes.json();
    let finalCode = reviewerData.response || code;

    if (finalCode.startsWith("```") && !finalCode.trim().endsWith("```")) {
      finalCode += "\n```";
    }

    setDownloadStatus("Formatting response...");
    const followerRes = await fetch("http://localhost:11435/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:3b",
        system: `${NOVIL_CODER_SYSTEM}\n\nYou are currently acting as the Follower. Write ONE sentence to introduce the code.`,
        prompt: `You are the Follower. Here is the recent chat history:\n${contextHistory}\n\nUser: "${finalPrompt}". 
Write exactly ONE short sentence to introduce the code. 
Do NOT write "Step 1". Do NOT explain the code.`,
        stream: false,
        think: false,
        options: { num_ctx: 8192, num_predict: 100, temperature: 0.3 },
      }),
    });

    const followerData = await followerRes.json();
    const intro = followerData.response?.trim() || "Here is your updated code.";

    return {
      intro: intro,
      plan: plan,
      code: finalCode,
      newCoderEntry: `User: ${finalPrompt}\nCoder: ${finalCode}`,
    };
  } else {
    // [REASON] block
    setDownloadStatus("Thinking...");
    const reasonerModel = currentImage ? "qwen3.5:2b" : "qwen2.5:3b";
    const reasonerRes = await fetch("http://localhost:11435/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: reasonerModel,
        system: `${NOVIL_CODER_SYSTEM}\n\nYou are currently acting as the Reasoner. Analyze the image and answer the user.`,
        prompt: currentImage
          ? `You are the Parietal Lobe of the Novil AI system. 
The user has uploaded an image and said: "${finalPrompt}".

1. First, describe the image in detail. What is in it?
2. If the user asks for code to solve a problem in the image, write a brief plan for the Coder.
3. If the user just wants to know what the image is, just describe it.

Do NOT write code. Be descriptive and helpful.`
          : `You are the Parietal Lobe of the Novil AI system. 
Recent chat:\n${contextHistory}\n\nUser's latest request: "${finalPrompt}".

Answer the user's request directly. Do NOT hallucinate an image. If the user is not asking about an image, do not mention one.`,
        stream: false,
        think: false,
        images: currentImage ? [currentImage] : undefined,
        options: { num_ctx: 8192, num_predict: 1500, temperature: 0.4 },
      }),
    });
    const reasonerData = await reasonerRes.json();
    const answer = reasonerData.response || "I couldn't generate a response.";

    return {
      intro: answer,
      plan: "",
      code: "",
      newCoderEntry: "",
    };
  }
}
