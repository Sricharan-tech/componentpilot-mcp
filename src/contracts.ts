import * as z from "zod/v4";

export const CitationSchema = z.object({ source_url: z.string().url(), retrieved_at: z.string().datetime(), verification: z.literal("source_retrieved") });
export const ComponentSchema = z.object({ name: z.string(), url: z.string().url(), summary: z.string().nullable(), source: CitationSchema });
export const ImplementationLinkSchema = z.object({ label: z.string(), url: z.string().url() });
export const ExampleSchema = z.object({ name: z.string(), url: z.string().url(), links: z.array(ImplementationLinkSchema).min(1), technologies: z.array(z.string()), tags: z.array(z.string()), source: CitationSchema });
/** Pagination metadata for a complete normalized source result set. */
export const ExamplePaginationSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(30),
  offset: z.number().int().nonnegative(),
  has_more: z.boolean(),
  next_offset: z.number().int().nonnegative().nullable(),
  results_complete: z.boolean(),
});
export const ComponentExamplesResultSchema = z.object({
  status: z.enum(["ok", "no_results"]),
  component: z.string(),
  examples: z.array(ExampleSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(30),
  offset: z.number().int().nonnegative(),
  has_more: z.boolean(),
  next_offset: z.number().int().nonnegative().nullable(),
  results_complete: z.boolean(),
});
export const DesignSystemSchema = z.object({ name: z.string(), url: z.string().url(), summary: z.string().nullable(), technologies: z.array(z.string()), source: CitationSchema });
export const ResultStatusSchema = z.enum(["ok", "no_match", "no_results", "published", "not_published"]);
export const AccessibilityVerificationSchema = z.object({ status: z.enum(["verified", "unverified", "conflict"]), authority: CitationSchema.optional(), detail: z.string() });
export const GuidanceSchema = z.object({ component: z.string(), status: z.enum(["published", "not_published"]), guidance: z.array(z.string()), sections: z.array(z.string()), source: CitationSchema, verification: AccessibilityVerificationSchema });
export const ErrorSchema = z.object({ error: z.object({ code: z.string().regex(/^[A-Z0-9_]+$/), message: z.string(), retryable: z.boolean(), details: z.record(z.string(), z.unknown()).optional() }) });

export const ComponentQuerySchema = z.string().trim().min(2).max(120);
export const SourceIdSchema = z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/i);

export const DemoCheckSchema = z.enum(["tab_click", "accordion_toggle", "combobox_type", "keyboard_navigation"]);
export const DemoCheckObservationSchema = z.object({
  check: DemoCheckSchema,
  status: z.enum(["observed", "not_observed", "not_tested"]),
  observation: z.string().min(1).max(1_000),
});
export const ComponentDemoResultSchema = z.object({
  // The component is resolved from the live configured catalogue before an
  // Agent is allowed to run; it is intentionally not a hard-coded dropdown.
  component: ComponentQuerySchema,
  implementation: z.object({ name: z.string(), url: z.string().url() }),
  demo_status: z.enum(["found", "not_found", "inaccessible", "unsupported"]),
  requested_checks: z.array(DemoCheckObservationSchema).min(1).max(4),
  source_url: z.string().url(),
  tested_url: z.string().url().nullable(),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime(),
  evidence: z.object({ source: CitationSchema, agent_run_id: z.string().nullable(), steps: z.number().int().nonnegative().nullable() }),
  uncertainty: z.array(z.string().min(1).max(500)).max(8),
});
/** Immediate acknowledgement for a queued TinyFish Agent inspection. */
export const ComponentDemoStartedSchema = z.object({
  status: z.literal("queued"),
  run_id: z.string().min(1),
  queued_at: z.string().datetime(),
  component: ComponentQuerySchema,
  implementation: z.object({ name: z.string(), url: z.string().url() }),
  source_url: z.string().url(),
  next_tool: z.literal("get_component_demo_run"),
});
/** Recoverable state for an Agent run already queued by this server process. */
export const ComponentDemoRunSchema = z.object({
  run_id: z.string().min(1),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]),
  inspection: z.object({
    demo_status: z.enum(["found", "not_found", "inaccessible", "unsupported"]),
    tested_url: z.string().url().nullable(),
    checks: z.array(DemoCheckObservationSchema).max(4),
    uncertainty: z.array(z.string().min(1).max(500)).max(8),
    run_id: z.string().nullable(),
    started_at: z.string().datetime(),
    finished_at: z.string().datetime(),
    steps: z.number().int().nonnegative().nullable(),
  }).nullable(),
});
