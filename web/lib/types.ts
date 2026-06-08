export interface User {
  id: string;
  email: string;
  is_email_verified: boolean;
  date_joined: string;
}

export interface HealthProfile {
  score: number;
  score_label: string;
  summary_json: {
    overview?: string;
    highlights?: string[];
    risk_flags?: string[];
    recommendations?: Recommendation[];
    full_summary_markdown?: string;
    disclaimer?: string;
  };
  card_json: Record<string, any>;
  updated_at: string;
}

export interface Recommendation {
  id: string;
  title: string;
  body: string;
  category: string;
  priority: string;
}

export interface Document {
  id: string;
  title: string;
  status: string;
  source_type: string;
  processing_error: string;
  created_at: string;
}

export interface TimelineEvent {
  id: string;
  title: string;
  occurred_at: string | null;
  summary: string;
  source: string;
  document_title: string | null;
}

export interface Paginated<T> {
  count: number;
  results: T[];
}
