import { z } from "zod";

const KVSchema = z.object({
  key: z.string(),
  value: z.string(),
});

const TimelineEventSchema = z.object({
  occurred_at: z.string().nullable(),
  date_precision: z.enum(["day", "month", "year"]).nullable(),
  title: z.string(),
  event_type: z.string().nullable(),
  category: z.string().nullable(),
  source: z.string().nullable(),
  summary: z.string().nullable(),

  // always present, use [] if none
  tags: z.array(z.string()),

  // always present, use [] if none
  data_kv: z.array(KVSchema),
});

export const DocumentFactsSchema = z.object({
  document_id: z.string(),
  title: z.string().nullable(),
  key_facts: z.object({
    blood_type: z.string().nullable(),
    allergies: z.array(z.object({
      substance: z.string(),
      reaction: z.string().nullable(),
      severity: z.enum(["low", "medium", "high", "unknown"]),
    })),
    medications: z.array(z.object({
      name: z.string(),
      dose: z.string().nullable(),
      frequency: z.string().nullable(),
      notes: z.string().nullable(),
    })),
    conditions: z.array(z.object({
      name: z.string(),
      status: z.string().nullable(),
      notes: z.string().nullable(),
    })),
    surgeries_procedures: z.array(z.object({
      name: z.string(),
      when: z.string().nullable(),
      notes: z.string().nullable(),
    })),
    implants_devices: z.array(z.string()),
    key_labs_vitals: z.array(z.object({
      name: z.string(),
      value: z.string().nullable(),
      when: z.string().nullable(),
    })),
    extra_notes: z.array(z.string()),
  }),

  timeline_events: z.array(TimelineEventSchema),
  confidence_0_to_1: z.number().min(0).max(1),
});

export type DocumentFacts = z.infer<typeof DocumentFactsSchema>;


export const RecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  details: z.string().optional(),
  full_title: z.string().optional(),
  full_body: z.string().optional(),
  category: z.enum([
    "follow_up",
    "missing_info",
    "monitoring",
    "lifestyle",
    "safety",
    "medication",
    "preventive",
  ]),
  priority: z.enum(["high", "medium", "low"]),
  source: z.string(),
  action_label: z.string().optional(),
  action_type: z.string().optional(),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

export const HealthEvaluationSchema = z.object({
  score_0_to_100: z.number().int().min(0).max(100),
  score_label: z.string(),
  overview: z.string(),
  highlights: z.array(z.string()),
  risk_flags: z.array(z.string()),
  missing_info: z.array(z.string()),
  suggested_next_steps: z.array(z.string()),
  recommendations: z.array(RecommendationSchema).optional(),

  three_by_five_card: z.object({
    blood_type: z.string().nullable(),
    major_conditions: z.array(z.string()),
    major_surgeries: z.array(z.string()),
    current_meds: z.array(z.string()),
    allergies: z.array(z.string()),
    implants_devices: z.array(z.string()),
    anticoagulants: z.array(z.string()),
    anesthesia_notes: z.array(z.string()),
    emergency_contact: z.object({
      name: z.string().nullable(),
      phone: z.string().nullable()
    }),
    one_line_summary: z.string()
  }),

  apple_health_snapshot: z.object({
    steps_avg_7d: z.number().nullable(),
    sleep_avg_min_7d: z.number().nullable(),
    resting_hr_recent: z.number().nullable()
  }),

  full_summary_markdown: z.string(),

  disclaimer: z.string()
});

export type HealthEvaluation = z.infer<typeof HealthEvaluationSchema>;
