// Pure types — safe to import from client components.

export interface AssessAttachment {
  path: string;
  mime_type: string;
  kind: "lab_report" | "food_journal";
}

export interface AssessInput {
  client_id: string;
  symptoms: string[];
  topics: string[];
  complaints: string;
  attachments?: AssessAttachment[];
  dry_run?: boolean;
}

export interface AssessUsage {
  model?: string;
  stop_reason?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface AssessResult {
  ok: boolean;
  session_id?: string;
  suggestions?: Record<string, unknown>;
  usage?: AssessUsage;
  subgraph_size_bytes?: number;
  error?: string | null;
}

export interface GenerateDraftInput {
  client_id: string;
  session_id: string;
  picks: Record<string, boolean>;
}

export interface GenerateDraftResult {
  ok: boolean;
  slug?: string;
  path?: string;
  error?: string | null;
}
