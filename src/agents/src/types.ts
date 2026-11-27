export type Message = {
  role: "user" | "assistant" | "error";
  content: string;
  image?: string;
};

export type Chat = {
  id: string;
  title: string;
  messages: Message[];
  coderHistory?: string[];
  reasonerHistory?: string[];
  followerHistory?: string[];
};
