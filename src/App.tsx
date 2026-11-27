import { useState, useEffect, useRef } from "react";
import "./App.css";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  readTextFile,
  writeTextFile,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NOVIL_SYSTEM_PROMPT } from "./prompts/novilSystemPrompt";
import { NovilIcon } from "./components/NovilIcon";
import { IconImage } from "./components/IconImage";
import { invoke } from "@tauri-apps/api/core";
import { Message, Chat } from "./types";

//AGENTS
import { runBabyNovil } from "./agents/babyNovil";
import { runNovilCoder } from "./agents/novilCoder";
import { runNovilSmart } from "./agents/novilSmart";

const HISTORY_FILE = "history.json";

function createChatId(): string {
  return crypto.randomUUID();
}

function getChatTitle(messages: Message[]): string {
  const firstMessage = messages.find((message) => message.role === "user");

  if (!firstMessage) return "New conversation";

  const title = firstMessage.content.replace(/\s+/g, " ").trim();

  return title.length > 36 ? `${title.slice(0, 36)}...` : title;
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;

  const item = value as Record<string, unknown>;

  return (
    ["user", "assistant", "error"].includes(String(item.role)) &&
    typeof item.content === "string"
  );
}

async function saveHistory(chats: Chat[]): Promise<void> {
  try {
    await writeTextFile(HISTORY_FILE, JSON.stringify(chats, null, 2), {
      baseDir: BaseDirectory.AppLocalData,
    });
  } catch (error) {
    console.error("Failed to save chat history:", error);
  }
}

async function loadHistory(): Promise<Chat[]> {
  try {
    const text = await readTextFile(HISTORY_FILE, {
      baseDir: BaseDirectory.AppLocalData,
    });

    const parsed: unknown = JSON.parse(text);

    if (!Array.isArray(parsed)) return [];

    if (parsed.every(isMessage)) {
      if (parsed.length === 0) return [];

      const messages = parsed as Message[];

      return [
        {
          id: createChatId(),
          title: getChatTitle(messages),
          messages,
        },
      ];
    }

    return parsed.filter((item): item is Chat => {
      if (!item || typeof item !== "object") return false;

      const chat = item as Record<string, unknown>;

      return (
        typeof chat.id === "string" &&
        typeof chat.title === "string" &&
        Array.isArray(chat.messages) &&
        chat.messages.every(isMessage)
      );
    });
  } catch {
    return [];
  }
}

async function generateSummary(conversation: Message[]): Promise<string> {
  const textToSummarize = conversation
    .map(
      (m) =>
        `${m.role}: ${m.content.replace(/```[\s\S]*?```/g, "[Code Block]")}`,
    )
    .join("\n");

  const res = await fetch("http://localhost:11435/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5:3b",
      prompt: `Summarize the following conversation into a concise paragraph. Focus on what the user asked for, the design choices made, and the overall goal of the project:\n\n${textToSummarize}`,
      stream: false,
      think: false,
      options: { num_ctx: 8192, num_predict: 250, temperature: 0.2 },
    }),
  });
  const data = await res.json();
  return data.response || "";
}

function App() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("qwen2.5-coder:1.5b");
  const [historyReady, setHistoryReady] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [menuChatId, setMenuChatId] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isModelReady, setIsModelReady] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState(
    "Checking local models...",
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLElement>(null);
  const isUserScrolling = useRef(false);
  const [knowledgeChunks, setKnowledgeChunks] = useState<string[]>([]);
  const [kbName, setKbName] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isImageAnalysis, setIsImageAnalysis] = useState(false);
  const [showRamWarning, setShowRamWarning] = useState(false);
  const [pendingRamModel, setPendingRamModel] = useState<string | null>(null);

  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const messages = activeChat?.messages ?? [];

  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [isDownloadingOnDemand, setIsDownloadingOnDemand] = useState(false);

  const [isModelLoading, setIsModelLoading] = useState(false);
  const [lastUsedModel] = useState<string | null>(null);
  const scrollTickRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const renameChat = (chatId: string) => {
    const title = editTitle.trim();
    if (!title) return;

    setChats((previous) =>
      previous.map((chat) => (chat.id === chatId ? { ...chat, title } : chat)),
    );

    setEditingChatId(null);
    setEditTitle("");
    setMenuChatId(null);
  };

  const copyChat = (chat: Chat) => {
    const duplicate: Chat = {
      ...chat,
      id: crypto.randomUUID(),
      title: `${chat.title} (Copy)`,
      messages: chat.messages.map((message) => ({ ...message })),
    };

    setChats((previous) => [...previous, duplicate]);
    setActiveChatId(duplicate.id);
    setMenuChatId(null);
    setInput("");
  };

  const deleteChat = (chatId: string) => {
    setChats((previous) => {
      const remaining = previous.filter((chat) => chat.id !== chatId);

      if (activeChatId === chatId) {
        setActiveChatId(
          remaining.length > 0 ? remaining[remaining.length - 1].id : null,
        );
      }

      return remaining;
    });

    setMenuChatId(null);
    setEditingChatId(null);
    setInput("");
  };

  const [availableRam, setAvailableRam] = useState<number>(0);

  useEffect(() => {
    invoke("get_available_ram").then((ram: any) => setAvailableRam(ram));
  }, []);

  const continueModelChange = async (newModel: string) => {
    const isModelHealthy = async (name: string) => {
      try {
        const tagsRes = await fetch("http://localhost:11435/api/tags");
        const tagsData = await tagsRes.json();
        const installedModels = tagsData.models.map((m: any) => m.name);
        if (!installedModels.some((m: string) => m === name)) return false;
        const res = await fetch("http://localhost:11435/api/show", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        return res.ok;
      } catch {
        return false;
      }
    };

    const hasRouter3B = await isModelHealthy("qwen2.5:3b");
    const hasVision2B = await isModelHealthy("qwen3.5:2b");
    const hasCoder4B = await isModelHealthy("qwen3.5:4b");

    if (hasRouter3B && hasVision2B && hasCoder4B) {
      setModel(newModel);
    } else {
      setPendingModel(newModel);
      setShowDownloadModal(true);
    }
  };

  const handleModelChange = async (newModel: string) => {
    if (newModel === "qwen2.5-coder:1.5b") {
      setModel(newModel);
      return;
    }

    if (newModel === "qwen3.5:4b" && availableRam < 8) {
      setPendingRamModel(newModel);
      setShowRamWarning(true);
      return;
    }

    await continueModelChange(newModel);
  };

  const handleConfirmDownload = async () => {
    if (!pendingModel) return;
    setShowDownloadModal(false);
    setIsDownloadingOnDemand(true);

    const downloadModel = async (name: string, label: string) => {
      setDownloadStatus(`Downloading ${label}...`);
      setDownloadProgress(0);
      try {
        const pullRes = await fetch("http://localhost:11435/api/pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const reader = pullRes.body?.getReader();
        const decoder = new TextDecoder();
        if (reader) {
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const data = JSON.parse(line);
                if (data.status)
                  setDownloadStatus(`Downloading ${label}: ${data.status}...`);
                if (data.total && data.completed) {
                  const percent = Math.round(
                    (data.completed / data.total) * 100,
                  );
                  setDownloadProgress(Math.min(100, Math.max(0, percent)));
                }
              } catch (e) {}
            }
          }
        }
      } catch (err) {
        console.error("Download failed:", err);
      }
    };

    await downloadModel("qwen2.5:3b", "Frontal Lobe 1/3");
    await downloadModel("qwen3.5:2b", "Vision Reasoner 2/3");
    await downloadModel("qwen3.5:4b", "Cerebellum 3/3");

    setIsDownloadingOnDemand(false);
    setModel(pendingModel);
    setPendingModel(null);
  };

  useEffect(() => {
    let active = true;

    loadHistory().then((history) => {
      if (!active) return;

      setChats(history);
      setActiveChatId(
        history.length > 0 ? history[history.length - 1].id : null,
      );
      setHistoryReady(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    void saveHistory(chats);
  }, [chats, historyReady]);

  useEffect(() => {
    const checkAndPullModels = async () => {
      try {
        const isModelHealthy = async (name: string) => {
          try {
            const tagsRes = await fetch("http://localhost:11435/api/tags");
            const tagsData = await tagsRes.json();
            const installedModels = tagsData.models.map((m: any) => m.name);
            if (!installedModels.some((m: string) => m === name)) return false;
            const res = await fetch("http://localhost:11435/api/show", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name }),
            });
            return res.ok;
          } catch {
            return false;
          }
        };

        const downloadModel = async (
          name: string,
          label: string,
          retries = 3,
        ): Promise<void> => {
          setDownloadStatus(`Downloading ${label}...`);
          setDownloadProgress(0);
          try {
            const pullRes = await fetch("http://localhost:11435/api/pull", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name }),
            });
            if (!pullRes.ok)
              throw new Error(`Failed to start download for ${name}`);
            const reader = pullRes.body?.getReader();
            const decoder = new TextDecoder();
            if (reader) {
              let buffer = "";
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const data = JSON.parse(line);
                    if (data.status)
                      setDownloadStatus(
                        `Downloading ${label}: ${data.status}...`,
                      );
                    if (data.total && data.completed) {
                      const percent = Math.round(
                        (data.completed / data.total) * 100,
                      );
                      setDownloadProgress(Math.min(100, Math.max(0, percent)));
                    }
                  } catch (e) {}
                }
              }
            }
          } catch (err) {
            if (retries > 0) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              return downloadModel(name, label, retries - 1);
            } else {
              throw new Error(`Could not download ${name}.`);
            }
          }
        };

        const hasBaby = await isModelHealthy("qwen2.5-coder:1.5b");

        if (hasBaby) {
          setIsModelReady(true);
          return;
        }

        setDownloadStatus("Downloading Baby Novil (1.6 GB)...");
        await downloadModel("qwen2.5-coder:1.5b", "Baby Novil");
        setIsModelReady(true);
      } catch (err) {
        console.error(err);
        setDownloadStatus("Download failed. Please restart the app.");
      }
    };

    checkAndPullModels();
  }, []);

  useEffect(() => {
    const checkFullscreen = async () => {
      const fullscreen = await getCurrentWindow().isFullscreen();
      setIsFullscreen(fullscreen);
    };

    const unlisten = getCurrentWindow().onResized(() => {
      checkFullscreen();
    });

    checkFullscreen();

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      if (loading && messages[messages.length - 1]?.content === "") {
        scrollTickRef.current = 0;
      }

      if (scrollTickRef.current < 5) {
        chatContainerRef.current.scrollTop =
          chatContainerRef.current.scrollHeight;
        scrollTickRef.current += 1;
      }
    }
  }, [messages, loading, isModelLoading]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        isUserScrolling.current = true;
      } else if (e.deltaY > 0) {
        if (
          container.scrollHeight -
            container.scrollTop -
            container.clientHeight <
          100
        ) {
          isUserScrolling.current = false;
        }
      }
    };

    container.addEventListener("wheel", handleWheel);
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        getCurrentWindow().setFullscreen(!isFullscreen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  const generateTitle = async (chatId: string, firstMessage: string) => {
    try {
      const res = await fetch("http://localhost:11435/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen2.5-coder:1.5b",
          prompt: `Generate a 3-word title for this message: "${firstMessage}". Output ONLY the title. No quotes. No punctuation. Example: React Hook Debugging`,
          stream: false,
          think: false,
          options: { num_predict: 10, temperature: 0.1 },
        }),
      });

      const data = await res.json();
      const newTitle = data.response.trim().replace(/["'\n]/g, "");

      if (newTitle) {
        setChats((previous) =>
          previous.map((chat) =>
            chat.id === chatId ? { ...chat, title: newTitle } : chat,
          ),
        );
      }
    } catch (e) {
      console.error("Failed to generate title", e);
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setIsModelLoading(false);
  };

  const handleDocumentUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const chunks = text.match(/[\s\S]{1,500}/g) || [];

    setKnowledgeChunks(chunks);
    setKbName(file.name);
    alert(`Loaded ${chunks.length} chunks from ${file.name}`);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(",")[1];
      setSelectedImage(base64String);
    };
    reader.readAsDataURL(file);
  };

  const getRelevantContext = (query: string) => {
    if (knowledgeChunks.length === 0) return "";

    const queryWords = query.toLowerCase().split(" ");
    const scoredChunks = knowledgeChunks.map((chunk) => {
      let score = 0;
      const chunkLower = chunk.toLowerCase();
      queryWords.forEach((word) => {
        if (word.length > 3 && chunkLower.includes(word)) score++;
      });
      return { chunk, score };
    });

    scoredChunks.sort((a, b) => b.score - a.score);

    const topChunks = scoredChunks
      .filter((c) => c.score > 0)
      .slice(0, 2)
      .map((c) => c.chunk)
      .join("\n\n---\n\n");

    return topChunks;
  };

  const sendMessage = async (overridePrompt?: string) => {
    const currentImage = selectedImage;
    setSelectedImage(null);

    setIsImageAnalysis(!!currentImage);

    const prompt = overridePrompt || input.trim();
    if ((!prompt && !currentImage) || loading) return;

    const finalPrompt = prompt || "Analyze this image.";

    const chatId = activeChatId ?? createChatId();
    const existingChat = chats.find((chat) => chat.id === chatId);

    if (!existingChat) {
      generateTitle(chatId, prompt);
    }

    const isColdStart = lastUsedModel !== model;

    const userMessage: Message = {
      role: "user",
      content: finalPrompt,
      image: currentImage || undefined,
    };

    const conversation = [...(existingChat?.messages ?? []), userMessage];

    const updatedChat: Chat = {
      id: chatId,
      title: existingChat ? existingChat.title : "New Chat...",
      messages: conversation,
      coderHistory: existingChat?.coderHistory || [],
    };

    setChats((previous) =>
      existingChat
        ? previous.map((chat) => (chat.id === chatId ? updatedChat : chat))
        : [...previous, updatedChat],
    );

    setLoading(true);

    setActiveChatId(chatId);
    setInput("");
    setLoading(true);

    isUserScrolling.current = false;

    if (isColdStart) {
      setIsModelLoading(true);
    }

    try {
      const tagsRes = await fetch("http://localhost:11435/api/tags");
      const tagsData = await tagsRes.json();
      const modelExists = tagsData.models.some((m: any) =>
        m.name.includes(model.split(":")[0]),
      );

      if (!modelExists) {
        setIsModelReady(false);
        setDownloadStatus(`Downloading model (This may take a while)...`);

        const pullRes = await fetch("http://localhost:11435/api/pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model }),
        });

        const reader = pullRes.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const data = JSON.parse(line);
                if (data.total && data.completed) {
                  setDownloadProgress(
                    Math.round((data.completed / data.total) * 100),
                  );
                }
              } catch (e) {}
            }
          }
        }

        setDownloadProgress(0);
        setIsModelReady(true);
      }

      const initialAssistantMessage: Message = {
        role: "assistant",
        content: "",
      };
      setChats((previous) =>
        previous.map((chat) =>
          chat.id === chatId
            ? { ...chat, messages: [...chat.messages, initialAssistantMessage] }
            : chat,
        ),
      );

      abortControllerRef.current = new AbortController();

      const context = getRelevantContext(finalPrompt);
      const finalSystemPrompt = context
        ? `${NOVIL_SYSTEM_PROMPT}\n\n# RELEVANT KNOWLEDGE BASE:\n${context}`
        : NOVIL_SYSTEM_PROMPT;

      let finalResponseText = "";

      if (model === "qwen2.5-coder:1.5b") {
        finalResponseText = await runBabyNovil(
          conversation,
          finalSystemPrompt,
          setDownloadStatus,
        );
      } else if (model === "qwen3.5:4b") {
        let currentSummary = existingChat?.summary;

        if (conversation.length > 8) {
          const toSummarize = conversation.slice(0, -4);
          setDownloadStatus("Organizing memory...");
          currentSummary = await generateSummary(toSummarize);

          setChats((prev) =>
            prev.map((c) =>
              c.id === chatId ? { ...c, summary: currentSummary } : c,
            ),
          );
        }

        const result = await runNovilCoder(
          model,
          finalPrompt,
          currentImage,
          conversation,
          existingChat?.coderHistory || [],
          currentSummary,
          setDownloadStatus,
        );

        setChats((previous) =>
          previous.map((chat) => {
            if (chat.id !== chatId) return chat;
            return {
              ...chat,
              coderHistory: [
                ...(chat.coderHistory || []),
                result.newCoderEntry,
              ],
            };
          }),
        );

        const reasoningBlock = result.plan
          ? `### 🧠 Architecture Plan\n\n${result.plan}\n\n---\n\n`
          : "";

        finalResponseText = `${result.intro}\n\n${reasoningBlock}${result.code}`;
      } else {
        finalResponseText = await runNovilSmart(
          model,
          finalPrompt,
          currentImage,
          conversation,
          setDownloadStatus,
        );
      }
      const words = finalResponseText.split(" ");
      let currentText = "";

      for (let i = 0; i < words.length; i++) {
        currentText += words[i] + " ";
        setChats((previous) =>
          previous.map((chat) => {
            if (chat.id !== chatId) return chat;
            const newMessages = [...chat.messages];
            newMessages[newMessages.length - 1] = {
              role: "assistant",
              content: currentText,
            };
            return { ...chat, messages: newMessages };
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      setChats((previous) =>
        previous.map((chat) => {
          if (chat.id !== chatId) return chat;
          const newMessages = [...chat.messages];
          newMessages[newMessages.length - 1] = {
            role: "assistant",
            content: finalResponseText,
          };
          return { ...chat, messages: newMessages };
        }),
      );
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("Generation stopped by user.");
      } else {
        console.error("Ollama request failed:", error);
        setChats((previous) =>
          previous.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: [
                    ...chat.messages,
                    {
                      role: "error",
                      content:
                        "Could not connect to Ollama. Check that it is running.",
                    },
                  ],
                }
              : chat,
          ),
        );
      }
    } finally {
      setLoading(false);
      setIsModelLoading(false);
      setIsImageAnalysis(false);
      abortControllerRef.current = null;
    }
  };

  const regenerateResponse = () => {
    if (loading) return;

    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUserMessage) return;

    setChats((previous) =>
      previous.map((chat) => {
        if (chat.id !== activeChatId) return chat;
        return {
          ...chat,
          messages: chat.messages.slice(0, -1),
        };
      }),
    );

    setTimeout(() => {
      sendMessage(lastUserMessage.content);
    }, 100);
  };

  const newChat = () => {
    if (loading) return;

    setActiveChatId(null);
    setInput("");
  };

  if (!isModelReady || isDownloadingOnDemand) {
    return (
      <div className="splash-screen cyber-splash-container">
        <div className="bg-glow-grid" />
        <div className="bg-scanlines" />

        <div className="splash-content cyber-glass holographic-container">
          <div className="bubble-tick tl" />
          <div className="bubble-tick tr" />
          <div className="bubble-tick bl" />
          <div className="bubble-tick br" />

          <div className="splash-brand">
            <svg
              width="32"
              height="32"
              viewBox="0 0 500 500"
              className="synapse-logo cyber-logo-glow"
            >
              <defs>
                <linearGradient
                  id="synapse-splash-grad"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#c084fc" />
                  <stop offset="50%" stopColor="#ec4899" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>

              <path
                d="M150 250 C100 175 50 200 50 250 C50 300 100 325 150 250 C220 150 280 350 350 250 C400 175 450 200 450 250 C450 300 400 325 350 250 C280 150 220 350 150 250 Z"
                fill="none"
                stroke="url(#synapse-splash-grad)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              <g transform="translate(250, 250)">
                <circle cx="0" cy="0" r="28" fill="url(#synapse-splash-grad)" />
                <circle cx="0" cy="0" r="12" fill="#ffffff" />
                <path
                  d="M0 -60 L0 -90 M0 60 L0 90 M-60 0 L-90 0 M60 0 L90 0 M-42 -42 L-70 -70 M42 42 L70 70 M-42 42 L-70 70 M42 -42 L70 -70"
                  stroke="#06b6d4"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </g>
            </svg>
            <span className="splash-brand-name brand-title-glow">SYNAPSE</span>
          </div>

          <h1 className="splash-title cyber-glow-text">WELCOME TO NOVIL</h1>
          <p className="splash-subtitle">{downloadStatus}</p>

          {downloadProgress > 0 && (
            <div className="splash-progress-wrapper">
              <div className="splash-progress-track">
                <div
                  className="splash-progress-fill"
                  style={{ width: `${downloadProgress}%` }}
                />
                <div className="splash-progress-scan-glow" />
              </div>
              <p className="splash-progress-text">
                <span className="neon-cyan-text">{downloadProgress}%</span>{" "}
                NEURAL MODEL DOWNLOADED
              </p>
            </div>
          )}

          <div className="splash-footer">
            <span>POWERED BY SYNAPSE</span>
            <span className="footer-dot">•</span>
            <span>100% OFFLINE</span>
            <span className="footer-dot">•</span>
            <span>ZERO LOGS</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app cyber-theme">
      <div className="bg-glow-grid" />
      <div className="bg-scanlines" />
      {!isFullscreen && (
        <header
          className="custom-titlebar cyber-glass-header"
          data-tauri-drag-region
        >
          <div className="titlebar-brand" data-tauri-drag-region>
            <svg
              width="28"
              height="28"
              viewBox="0 0 500 500"
              className="synapse-logo cyber-logo-glow"
              data-tauri-drag-region
            >
              <defs>
                <linearGradient
                  id="synapse-grad"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#c084fc" />
                  <stop offset="50%" stopColor="#ec4899" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>

              <path
                d="M150 250 C100 175 50 200 50 250 C50 300 100 325 150 250 C220 150 280 350 350 250 C400 175 450 200 450 250 C450 300 400 325 350 250 C280 150 220 350 150 250 Z"
                fill="none"
                stroke="url(#synapse-grad)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              <g transform="translate(250, 250)">
                <circle cx="0" cy="0" r="28" fill="url(#synapse-grad)" />
                <circle cx="0" cy="0" r="12" fill="#ffffff" />
                <path
                  d="M0 -60 L0 -90 M0 60 L0 90 M-60 0 L-90 0 M60 0 L90 0 M-42 -42 L-70 -70 M42 42 L70 70 M-42 42 L-70 70 M42 -42 L70 -70"
                  stroke="#06b6d4"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </g>
            </svg>
            <span className="brand-title-text">SN</span>
          </div>
          <div className="window-controls">
            <button
              className="window-btn"
              onClick={async () => {
                const window = getCurrentWindow();
                const isFull = await window.isFullscreen();
                await window.setFullscreen(!isFull);
              }}
              title="Fullscreen"
            >
              ⛶
            </button>
            <button
              className="window-btn minimize-btn"
              onClick={() => getCurrentWindow().minimize()}
              title="Minimize"
            >
              ─
            </button>
            <button
              className="window-btn maximize-btn"
              onClick={() => getCurrentWindow().toggleMaximize()}
              title="Maximize"
            >
              □
            </button>
            <button
              className="window-btn close-btn"
              onClick={() => getCurrentWindow().close()}
              title="Close"
            >
              ✕
            </button>
          </div>
        </header>
      )}

      <div className="app-body">
        <aside className="sidebar cyber-glass">
          <div className="brand">
            <div
              className="brand-icon glow-pulse cyber-alive-icon"
              style={{ background: "transparent", border: "none", padding: 0 }}
            >
              <NovilIcon size={32} blink={true} />
            </div>
            <span className="brand-title-glow">Novil</span>
          </div>

          <button className="new-chat cyber-button" onClick={newChat}>
            <span className="btn-icon">＋</span> INITIALIZE CHAT
          </button>

          <input
            type="file"
            id="doc-upload"
            accept=".txt,.md"
            style={{ display: "none" }}
            onChange={(e) => handleDocumentUpload(e)}
          />
          <button
            className="new-chat cyber-button"
            style={{ marginTop: 10, fontSize: 12 }}
            onClick={() => document.getElementById("doc-upload")?.click()}
          >
            📄 Load Knowledge Base
          </button>

          {kbName && (
            <div
              style={{
                fontSize: 10,
                color: "#06b6d4",
                marginTop: 5,
                textAlign: "center",
                fontFamily: "monospace",
              }}
            >
              ACTIVE KB: {kbName}
            </div>
          )}

          <div className="sidebar-label">
            <span>WORKSPACE</span>
            <span className="live-indicator" />
          </div>

          <div className="conversation-list custom-scrollbar">
            {[...chats].reverse().map((chat) => (
              <div
                key={chat.id}
                className={`conversation-card ${
                  activeChatId === chat.id ? "active" : ""
                }`}
              >
                {editingChatId === chat.id ? (
                  <form
                    className="conversation-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      renameChat(chat.id);
                    }}
                  >
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setEditingChatId(null);
                          setEditTitle("");
                        }
                      }}
                      aria-label="Conversation name"
                      className="cyber-textarea"
                      style={{
                        padding: "8px 10px",
                        background: "rgba(0, 0, 0, 0.4)",
                        border: "1px solid #06b6d4",
                        borderRadius: "6px",
                        color: "#fff",
                        fontSize: "12px",
                        width: "100%",
                        outline: "none",
                        boxShadow: "0 0 8px rgba(6, 182, 212, 0.2)",
                      }}
                    />
                    <button
                      type="submit"
                      title="Save name"
                      className="cyber-button"
                      style={{
                        padding: "6px 10px",
                        background: "rgba(6, 182, 212, 0.1)",
                        borderColor: "#06b6d4",
                        color: "#06b6d4",
                      }}
                    >
                      ✓
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="conversation-card-main"
                      onClick={() => {
                        if (loading) return;
                        setActiveChatId(chat.id);
                        setInput("");
                        setMenuChatId(null);
                      }}
                      title={chat.title}
                      disabled={loading}
                    >
                      <span className="conversation-card-icon">◈</span>
                      <span className="conversation-card-title">
                        {chat.title}
                      </span>
                    </button>

                    <button
                      className="conversation-menu-trigger"
                      title="Conversation options"
                      aria-label={`Options for ${chat.title}`}
                      onClick={() =>
                        setMenuChatId((current) =>
                          current === chat.id ? null : chat.id,
                        )
                      }
                    >
                      ⋯
                    </button>

                    {menuChatId === chat.id && (
                      <div className="conversation-menu cyber-dropdown">
                        <button
                          onClick={() => {
                            setEditingChatId(chat.id);
                            setEditTitle(chat.title);
                            setMenuChatId(null);
                          }}
                        >
                          <span>✎</span> Edit
                        </button>

                        <button onClick={() => copyChat(chat)}>
                          <span>▢</span> Copy
                        </button>

                        <button
                          className="conversation-menu-delete"
                          onClick={() => deleteChat(chat.id)}
                        >
                          <span>♲</span> Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="sidebar-bottom">
            <div className="sidebar-bottom">
              <div className="system-status">
                <span className="status-dot online" /> SYSTEM: OPTIMAL
              </div>
              <button
                className="report-issue-btn"
                onClick={() => {
                  const subject = encodeURIComponent("Novil AI - Issue Report");
                  const body = encodeURIComponent(
                    "Please describe the issue you encountered with the AI:\n\n",
                  );
                  window.location.href = `mailto:synapse79@outlook.com?subject=${subject}&body=${body}`;
                }}
              >
                ⚠ Report an Issue
              </button>
              <small>Novil AI · Zero-Log Offline Core</small>
            </div>
          </div>
        </aside>

        <main className="main cyber-main-area">
          <header className="topbar cyber-glass" data-tauri-drag-region>
            <div className="mobile-brand" data-tauri-drag-region>
              Novil
            </div>

            <div className="model-picker cyber-badge">
              <span className="model-dot pulse-cyan" />
              <select
                value={model}
                onChange={(e) => {
                  handleModelChange(e.target.value);
                  setSelectedImage(null);
                }}
                disabled={loading}
              >
                <option value="qwen2.5-coder:1.5b">Baby Novil</option>

                <option value="qwen3.5:4b">Novil Coder</option>

                <option value="qwen3-vl:8b" disabled={true}>
                  Novil Smart (Under training)
                </option>
              </select>
              <span className="local-label">LOCAL EXECUTION</span>
            </div>
          </header>

          <section
            className="chat-area custom-scrollbar"
            ref={chatContainerRef}
          >
            {messages.length === 0 ? (
              <div className="welcome holographic-container">
                <div
                  style={{
                    width: "30px",
                    height: "30px",
                    minWidth: "30px",
                    minHeight: "30px",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: "12px",
                    background: "transparent",
                  }}
                >
                  <NovilIcon size={30} />
                </div>
                <h1 className="cyber-glow-text">SYSTEM READY</h1>
                <p>Neural engine active. What will we compute today?</p>

                <div className="suggestions">
                  <button
                    className="suggestion-card cyber-card"
                    onClick={() => setInput("Help me build a React component")}
                  >
                    <span className="card-symbol">⌘</span>
                    <div>
                      <strong>Architect Component</strong>
                      <br></br>
                      <small>Generate modular React code</small>
                    </div>
                  </button>

                  <button
                    className="suggestion-card cyber-card"
                    onClick={() => setInput("Help me debug my TypeScript code")}
                  >
                    <span className="card-symbol">⌕</span>
                    <div>
                      <strong>Neural Debugger</strong>
                      <br></br>
                      <small>Diagnose & resolve TS code issues</small>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              <div className="messages cyber-message-feed">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`message-row cyber-row ${message.role}`}
                  >
                    {message.role !== "user" && (
                      <div className="assistant-avatar">
                        {message.role === "error" ? (
                          "!"
                        ) : (
                          <NovilIcon size={30} />
                        )}
                      </div>
                    )}

                    <div
                      className={`message-content cyber-bubble ${message.role === "user" ? "user-bubble" : "ai-bubble"}`}
                    >
                      <div className="bubble-tick tl" />
                      <div className="bubble-tick tr" />
                      <div className="bubble-tick bl" />
                      <div className="bubble-tick br" />

                      <div className="message-header-meta">
                        <span className="meta-tag">
                          {message.role === "user"
                            ? "USER_DIRECTIVE"
                            : "NOVIL_CORE"}
                        </span>
                        <span className="meta-timestamp">
                          {new Date().toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </div>

                      <div className="message-body-content">
                        {message.image && (
                          <img
                            src={`data:image/jpeg;base64,${message.image}`}
                            alt="User upload"
                            className="chat-image-preview"
                          />
                        )}

                        {message.role === "assistant" ? (
                          <MarkdownRenderer content={message.content} />
                        ) : (
                          message.content
                        )}
                      </div>

                      {message.role === "assistant" && !loading && (
                        <div className="message-actions">
                          <button
                            className="action-btn"
                            title="Regenerate Response"
                            onClick={regenerateResponse}
                          >
                            ↻ Refresh
                          </button>

                          <button
                            className="action-btn"
                            title="Copy to clipboard"
                            onClick={() => {
                              navigator.clipboard.writeText(message.content);
                            }}
                          >
                            ⧉ Copy
                          </button>

                          <button
                            className="action-btn"
                            title="Download as .md"
                            onClick={() => {
                              const blob = new Blob([message.content], {
                                type: "text/markdown",
                              });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `novil-response-${Date.now()}.md`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                          >
                            ↓ Export
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {loading && messages[messages.length - 1]?.content === "" && (
                  <div className="message-row cyber-row assistant loading-row">
                    <div
                      style={{
                        width: "30px",
                        height: "30px",
                        minWidth: "30px",
                        minHeight: "30px",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: "12px",
                      }}
                    >
                      <NovilIcon size={30} />
                    </div>
                    <div className="thinking cyber-thinking-hologram">
                      <div className="quantum-loader-bar">
                        <div className="quantum-scan-line" />
                      </div>
                      <small className="thinking-text">
                        {isImageAnalysis
                          ? "ANALYZING IMAGE (CPU)..."
                          : downloadStatus}
                      </small>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </section>

          <footer className="composer-area">
            <form
              className="composer cyber-input-wrapper futuristic-terminal"
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
            >
              <div className="terminal-bracket tl" />
              <div className="terminal-bracket tr" />
              <div className="terminal-bracket bl" />
              <div className="terminal-bracket br" />

              {selectedImage && (
                <div className="image-preview-container">
                  <img
                    src={`data:image/jpeg;base64,${selectedImage}`}
                    alt="Preview"
                    className="image-preview-thumb"
                  />
                  <button
                    type="button"
                    className="remove-image-btn"
                    onClick={() => setSelectedImage(null)}
                  >
                    ✕
                  </button>
                </div>
              )}

              <textarea
                className="cyber-textarea"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="Type neural directive..."
                rows={2}
                disabled={loading}
              />

              <div className="composer-bottom">
                <span className="composer-hint">
                  <kbd className="cyber-kbd">ENTER</kbd> TRANSMIT{" "}
                  <span className="hint-divider">/</span>{" "}
                  <kbd className="cyber-kbd">SHIFT+ENTER</kbd> NEWLINE
                </span>

                <input
                  type="file"
                  id="image-upload"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => handleImageUpload(e)}
                />
                <button
                  type="button"
                  className="action-btn"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#06b6d4",
                    cursor: "pointer",
                    padding: "4px",
                  }}
                  onClick={() =>
                    document.getElementById("image-upload")?.click()
                  }
                  title="Upload Image"
                >
                  <IconImage size={18} />
                </button>

                <button
                  type={loading ? "button" : "submit"}
                  className={`send-button cyber-send ${loading ? "stop-btn" : ""}`}
                  onClick={loading ? stopGeneration : undefined}
                  disabled={!loading && !input.trim() && !selectedImage}
                  aria-label={loading ? "Stop generating" : "Send message"}
                >
                  <span className="send-icon-pulse">{loading ? "■" : "▲"}</span>
                </button>
              </div>
            </form>

            <p className="disclaimer futuristic-disclaimer">
              <span className="secure-pulse"></span> OFFLINE NEURAL ENGINE
            </p>
          </footer>
        </main>
      </div>

      {showDownloadModal && (
        <div className="modal-overlay">
          <div className="modal-content cyber-glass holographic-container">
            <h2 className="cyber-glow-text" style={{ marginTop: 0 }}>
              INITIALIZE CODER MODULE
            </h2>
            <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>
              To use <strong>Novil Coder</strong>, the app requires downloading
              the neural weights.
              <br />
              <br />
              <span style={{ color: "#06b6d4", fontWeight: "bold" }}>
                Estimated size: ~6 GB
              </span>
              <br />
              <br />
              This is a one-time download. Once complete, you can code 100%
              offline forever.
            </p>

            <div
              style={{
                display: "flex",
                gap: 12,
                marginTop: 24,
                justifyContent: "flex-end",
              }}
            >
              <button
                className="cyber-button"
                style={{
                  background: "transparent",
                  border: "1px solid #30363d",
                  color: "#94a3b8",
                }}
                onClick={() => {
                  setShowDownloadModal(false);
                  setPendingModel(null);
                }}
              >
                Cancel
              </button>
              <button
                className="cyber-button"
                style={{
                  background: "linear-gradient(90deg, #06b6d4, #c084fc)",
                  color: "#000",
                  fontWeight: "bold",
                  border: "none",
                }}
                onClick={handleConfirmDownload}
              >
                Download Now
              </button>
            </div>
          </div>
        </div>
      )}

      {showRamWarning && (
        <div className="modal-overlay">
          <div
            className="modal-content cyber-glass holographic-container"
            style={{ borderColor: "#fbbf24" }}
          >
            <div
              className="bubble-tick tl"
              style={{ borderColor: "#fbbf24" }}
            />
            <div
              className="bubble-tick tr"
              style={{ borderColor: "#fbbf24" }}
            />
            <div
              className="bubble-tick bl"
              style={{ borderColor: "#fbbf24" }}
            />
            <div
              className="bubble-tick br"
              style={{ borderColor: "#fbbf24" }}
            />

            <h2
              className="cyber-glow-text"
              style={{
                marginTop: 0,
                color: "#fbbf24",
                textShadow: "0 0 10px rgba(251, 191, 36, 0.4)",
              }}
            >
              ⚠ SYSTEM WARNING
            </h2>
            <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>
              <strong>Novil Coder (4B)</strong> requires at least 8GB of free
              RAM for optimal performance.
              <br />
              <br />
              Your system currently reports only{" "}
              <strong style={{ color: "#fbbf24" }}>
                {availableRam}GB
              </strong>{" "}
              available.
              <br />
              <br />
              It will still run, but you may experience severe slowdowns or
              system freezing.
            </p>

            <div
              style={{
                display: "flex",
                gap: 12,
                marginTop: 24,
                justifyContent: "flex-end",
              }}
            >
              <button
                className="cyber-button"
                style={{
                  background: "transparent",
                  border: "1px solid #30363d",
                  color: "#94a3b8",
                }}
                onClick={() => {
                  setShowRamWarning(false);
                  setPendingRamModel(null);
                  setModel("qwen2.5-coder:1.5b");
                }}
              >
                Cancel
              </button>
              <button
                className="cyber-button"
                style={{
                  background: "linear-gradient(90deg, #fbbf24, #f59e0b)",
                  color: "#000",
                  fontWeight: "bold",
                  border: "none",
                }}
                onClick={async () => {
                  setShowRamWarning(false);
                  if (pendingRamModel) {
                    await continueModelChange(pendingRamModel);
                  }
                  setPendingRamModel(null);
                }}
              >
                Proceed Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
