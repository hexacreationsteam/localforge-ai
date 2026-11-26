export type ProviderId = 'gemini' | 'gpt' | 'grok' | 'claude' | 'ollama' | 'forge';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  modelId?: string;
  sources?: { title: string; url: string }[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  modelId?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderId;
  description?: string;
  available?: boolean;
}

export interface StreamMeta {
  type: 'meta';
  runtime?: string;
  backendModel?: string;
  notice?: string;
}

export interface StreamDelta {
  type: 'delta';
  text: string;
}

export interface StreamSources {
  type: 'sources';
  sources: { title: string; url: string }[];
}

export interface StreamDone {
  type: 'done';
}

export interface StreamError {
  type: 'error';
  message: string;
}

export type StreamEvent = StreamMeta | StreamDelta | StreamSources | StreamDone | StreamError;

export interface ModelsStatus {
  unifiedAvailable: boolean;
  unifiedModel: string;
  providers: {
    gemini: boolean;
    openai: boolean;
    xai: boolean;
    claude: boolean;
  };
  ollama: {
    connected: boolean;
    url: string;
    models: string[];
  };
}
