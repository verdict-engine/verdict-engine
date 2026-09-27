/**
 * OpenAPI documentation models.
 *
 * These classes exist ONLY so @nestjs/swagger can render request/response schemas at /docs —
 * they are never instantiated and never used for runtime validation. The real parsing and
 * validation still happens in the domain normalizers (e.g. IngestService.normalize) and the
 * controllers keep taking `unknown`/typed bodies. Keep these in sync with the domain types they
 * mirror; they are descriptive, not authoritative.
 */
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const EVENT_TYPES = [
  "card.authorize",
  "card.capture",
  "card.refund",
  "payment.authorize",
  "wallet.withdraw",
  "account.login",
  "order.place",
] as const;

const VERDICTS = ["allow", "challenge", "review", "deny"] as const;

// ---------------------------------------------------------------------------
// POST /v1/decisions
// ---------------------------------------------------------------------------

export class SubjectDto {
  @ApiProperty({ description: "Stable identifier of the acting user/account. The only required subject field.", example: "user_9f2a" })
  userId!: string;

  @ApiPropertyOptional({ description: "Stable device/client id, if available.", example: "dev_ab12" })
  deviceId?: string;

  @ApiPropertyOptional({ description: "Client-computed device fingerprint hash (browser/app signals). Drives device-reuse and fingerprint↔device-mismatch signals.", example: "fp_9c1e77a2b4" })
  fingerprint?: string;

  @ApiPropertyOptional({ description: "Client IP address for geolocation, impossible-travel and velocity signals.", example: "196.188.120.4" })
  ip?: string;

  @ApiPropertyOptional({ description: "MSISDN for mobile-money / telecom rails. A linkable graph entity and SIM-box signal.", example: "+251911223344" })
  phone?: string;

  @ApiPropertyOptional({ description: "Origin rail.", example: "telebirr" })
  channel?: string;
}

export class InstrumentDto {
  @ApiProperty({ enum: ["card", "wallet", "bank"], description: "Payment instrument family." })
  kind!: "card" | "wallet" | "bank";

  @ApiPropertyOptional({ description: "Card BIN — first 6-8 digits only. Never send a full PAN.", example: "451234" })
  bin?: string;

  @ApiPropertyOptional({ description: "ISO country of the issuer.", example: "ET" })
  issuerCountry?: string;

  @ApiPropertyOptional({ description: "Whether 3-D Secure was completed.", example: true })
  threeDS?: boolean;
}

export class DecisionEventDto {
  @ApiProperty({ enum: EVENT_TYPES, description: "The kind of event being scored. Determines which ruleset applies." })
  type!: (typeof EVENT_TYPES)[number];

  @ApiProperty({ type: SubjectDto, description: "Who the event is about." })
  subject!: SubjectDto;

  @ApiPropertyOptional({ description: "Caller-supplied event id. Generated if omitted. Also used for later chargeback labelling.", example: "evt_0R7..." })
  id?: string;

  @ApiPropertyOptional({ description: "ISO-8601 time the event occurred. Defaults to now.", example: "2026-09-18T10:30:00.000Z" })
  occurredAt?: string;

  @ApiPropertyOptional({ description: "Transaction amount. Required together with currency; must be a non-negative number.", example: 4200.5 })
  amount?: number;

  @ApiPropertyOptional({ description: "3-letter ISO currency code. Required together with amount.", example: "ETB" })
  currency?: string;

  @ApiPropertyOptional({ type: InstrumentDto, description: "Payment instrument details." })
  instrument?: InstrumentDto;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description: "Free-form scalar attributes (string/number/boolean) usable by rule conditions.",
    example: { orderCount24h: 3, isNewDevice: true, promoCode: "WELCOME" },
  })
  attributes?: Record<string, string | number | boolean>;
}

export class BatchDecisionDto {
  @ApiProperty({ type: [DecisionEventDto], description: "1–100 events to score. Each is scored independently; the response preserves order." })
  events!: DecisionEventDto[];
}

export class DecisionReasonDto {
  @ApiProperty({ description: "Rule tag that fired.", example: "velocity.high" })
  tag!: string;

  @ApiProperty({ description: "Points this reason contributed to the score.", example: 25 })
  points!: number;
}

export class DecisionDto {
  @ApiProperty({ example: "vrd_0R7..." })
  id!: string;

  @ApiProperty({ example: "evt_0R7..." })
  eventId!: string;

  @ApiProperty({ enum: VERDICTS, description: "allow · challenge (step-up auth) · review (queued for an operator) · deny." })
  verdict!: (typeof VERDICTS)[number];

  @ApiProperty({ description: "Risk score 0-100.", example: 72 })
  score!: number;

  @ApiProperty({ type: [DecisionReasonDto], description: "Why the verdict was reached — the rules that contributed." })
  reasons!: DecisionReasonDto[];

  @ApiProperty({ example: "default" })
  policyId!: string;

  @ApiProperty({ example: "2026-09-01T00:00:00.000Z" })
  policyVersion!: string;

  @ApiProperty({ example: "2026-09-18T10:30:00.100Z" })
  decidedAt!: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export class CredentialsDto {
  @ApiProperty({ example: "admin@verdict.local" })
  email!: string;

  @ApiProperty({ description: "Minimum 8 characters.", example: "supersecret1" })
  password!: string;
}

export class CreateUserDto {
  @ApiProperty({ example: "analyst@verdict.local" })
  email!: string;

  @ApiProperty({ example: "supersecret1" })
  password!: string;

  @ApiPropertyOptional({ enum: ["admin", "analyst"], description: "Defaults to analyst.", example: "analyst" })
  role?: "admin" | "analyst";
}

export class AuthUserDto {
  @ApiProperty({ example: "admin@verdict.local" })
  email!: string;

  @ApiProperty({ enum: ["admin", "analyst"] })
  role!: "admin" | "analyst";
}

export class AuthResultDto {
  @ApiProperty({ description: "Bearer token — send as `Authorization: Bearer <token>`. Valid for 12h.", example: "eyJ..." })
  token!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class AuthStatusDto {
  @ApiProperty({ description: "True when no users exist yet, so /register bootstraps the first admin.", example: false })
  needsBootstrap!: boolean;
}

// ---------------------------------------------------------------------------
// Feedback / labels & privacy
// ---------------------------------------------------------------------------

export class ChargebackDto {
  @ApiProperty({ description: "The event id of the transaction being disputed — labels it fraudulent and feeds the adaptive model.", example: "evt_0R7..." })
  eventId!: string;
}

export class EraseDto {
  @ApiProperty({ description: "User whose personal data should be erased (GDPR/right-to-erasure).", example: "user_9f2a" })
  userId!: string;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export class ResolveCaseDto {
  @ApiProperty({ enum: ["fraud", "legit", "inconclusive"], description: "Resolution outcome. Drives the feedback loop." })
  outcome!: "fraud" | "legit" | "inconclusive";

  @ApiPropertyOptional({ description: "Free-text analyst note.", example: "Confirmed stolen card via issuer." })
  note?: string;
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export class CreateApiKeyDto {
  @ApiProperty({ description: "Human label for the key, shown in the dashboard.", example: "checkout-service" })
  name!: string;

  @ApiPropertyOptional({
    isArray: true,
    enum: ["decisions", "labels"],
    description: "Scopes to grant. Omit for full access (both).",
  })
  scopes?: string[];

  @ApiPropertyOptional({ description: "Days until the key expires. Omit for a key that never expires.", example: 90 })
  expiresInDays?: number;
}

// ---------------------------------------------------------------------------
// Policies, rules, backtest
// ---------------------------------------------------------------------------

export class BandDto {
  @ApiProperty({ enum: VERDICTS })
  verdict!: (typeof VERDICTS)[number];

  @ApiProperty({ description: "Inclusive lower score bound.", example: 0 })
  min!: number;

  @ApiProperty({ description: "Inclusive upper score bound.", example: 39 })
  max!: number;

  @ApiPropertyOptional({ description: "Queue name for review verdicts.", example: "risk-ops" })
  reviewQueue?: string;
}

export class PolicyDto {
  @ApiProperty({ example: "default" })
  id!: string;

  @ApiProperty({ description: "Version label; a new version is appended on publish.", example: "2026-09-18" })
  version!: string;

  @ApiProperty({ type: [BandDto], description: "Score → verdict bands, evaluated in order." })
  bands!: BandDto[];

  @ApiProperty({ enum: ["fail_open", "fail_closed"], description: "Verdict to fall back to when scoring errors." })
  onError!: "fail_open" | "fail_closed";
}

export class RuleDto {
  @ApiProperty({ example: "r_high_amount" })
  id!: string;

  @ApiProperty({ example: "High amount for new device" })
  name!: string;

  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description:
      "Condition tree. Either a comparison `{ kind:'compare', path, op:'gt|gte|lt|lte|eq|neq', value }` or a boolean group `{ kind:'and', all:[...] }` / `{ kind:'or', any:[...] }`.",
    example: { kind: "compare", path: "money.amount", op: "gt", value: 1000 },
  })
  condition!: Record<string, unknown>;

  @ApiProperty({ description: "Points added to the score when the condition matches (0-100).", example: 25 })
  weight!: number;

  @ApiProperty({ description: "Reason tag surfaced on the decision.", example: "amount.high" })
  tag!: string;
}

export class RulesetDto {
  @ApiProperty({ enum: EVENT_TYPES, description: "Event type this ruleset governs." })
  eventType!: (typeof EVENT_TYPES)[number];

  @ApiProperty({ description: "Version label for this publish.", example: "2026-09-18" })
  version!: string;

  @ApiProperty({ type: [RuleDto] })
  rules!: RuleDto[];
}

export class BacktestPolicyDto {
  @ApiProperty({ type: [BandDto] })
  bands!: BandDto[];

  @ApiPropertyOptional({ enum: ["fail_open", "fail_closed"] })
  onError?: "fail_open" | "fail_closed";
}

export class BacktestDto {
  @ApiProperty({ enum: EVENT_TYPES, description: "Replay historical events of this type." })
  eventType!: (typeof EVENT_TYPES)[number];

  @ApiPropertyOptional({ type: [RuleDto], description: "Candidate rules to replay instead of the live ruleset." })
  rules?: RuleDto[];

  @ApiPropertyOptional({ type: BacktestPolicyDto, description: "Candidate policy bands to replay instead of the live policy." })
  policy?: BacktestPolicyDto;
}

export class RollbackDto {
  @ApiPropertyOptional({ description: "Version to roll back to. Defaults to the previous version.", example: "2026-09-01" })
  toVersion?: string;
}

export class SimulateDto {
  @ApiProperty({ description: "A hypothetical score to run through the policy bands.", example: 55 })
  score!: number;
}

// ---------------------------------------------------------------------------
// Activity log (GET /v1/activity)
// ---------------------------------------------------------------------------

export class ActivityRequestDto {
  @ApiProperty({ enum: EVENT_TYPES })
  type!: (typeof EVENT_TYPES)[number];

  @ApiProperty({ example: "2026-09-18T10:30:00.000Z" })
  occurredAt!: string;

  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description: "Masked subject. Phone and IP are partially masked; userId/deviceId are pseudonymous keys.",
    example: { userId: "user_9f2a", deviceId: "dev_ab12", ip: "196.188.•.•", phone: "+2519•••••44", channel: "telebirr" },
  })
  subject!: Record<string, unknown>;

  @ApiPropertyOptional({ example: 4200.5 })
  amount?: number;

  @ApiPropertyOptional({ example: "ETB" })
  currency?: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true, description: "BIN-only card data.", example: { kind: "card", bin: "451234", issuerCountry: "ET", threeDS: true } })
  instrument?: Record<string, unknown>;

  @ApiProperty({ type: "object", additionalProperties: true, example: { orderCount24h: 3 } })
  attributes!: Record<string, string | number | boolean>;
}

export class ActivityEntryDto {
  @ApiProperty({ example: "vrd_0R7..." })
  id!: string;

  @ApiProperty({ example: "evt_0R7..." })
  eventId!: string;

  @ApiProperty({ enum: EVENT_TYPES })
  eventType!: (typeof EVENT_TYPES)[number];

  @ApiProperty({ type: ActivityRequestDto, description: "The request payload, with personal data masked at write time." })
  request!: ActivityRequestDto;

  @ApiProperty({ enum: VERDICTS })
  verdict!: (typeof VERDICTS)[number];

  @ApiProperty({ example: 72 })
  score!: number;

  @ApiProperty({ type: [DecisionReasonDto] })
  reasons!: DecisionReasonDto[];

  @ApiProperty({ example: "default" })
  policyId!: string;

  @ApiProperty({ example: "2026-09-01" })
  policyVersion!: string;

  @ApiProperty({ example: "2026-09-18T10:30:00.100Z" })
  decidedAt!: string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export class RegisterWebhookDto {
  @ApiProperty({ description: "HTTPS endpoint that will receive signed deliveries.", example: "https://ops.example.com/hooks/verdict" })
  url!: string;

  @ApiPropertyOptional({
    isArray: true,
    enum: ["verdict.reached.v1", "case.resolved.v1", "label.recorded.v1"],
    description: "Event types to subscribe to. Defaults to all.",
  })
  events?: string[];
}

// ---------------------------------------------------------------------------
// Notifications (Slack & alert channels)
// ---------------------------------------------------------------------------

export class RegisterChannelDto {
  @ApiProperty({ enum: ["slack", "webhook", "telegram"], description: "Slack incoming-webhook, a Telegram bot, or a generic HTTPS endpoint." })
  type!: "slack" | "webhook" | "telegram";

  @ApiProperty({ description: "The channel URL. Slack/webhook endpoint, or a Telegram https://api.telegram.org/bot<token>/sendMessage URL. Stored server-side; shown masked afterwards.", example: "https://hooks.slack.com/services/T…/B…/…" })
  url!: string;

  @ApiPropertyOptional({ description: "Telegram chat id — required for the telegram type.", example: "-1001234567890" })
  target?: string;

  @ApiProperty({
    isArray: true,
    enum: ["verdict.reached.v1", "case.resolved.v1", "label.recorded.v1", "alert.dead_letter.v1"],
    description: "Events to alert on.",
  })
  events!: string[];

  @ApiPropertyOptional({ enum: VERDICTS, description: "For verdict.reached: only alert at or above this severity (e.g. deny)." })
  minVerdict?: (typeof VERDICTS)[number];

  @ApiPropertyOptional({ description: "Max alerts delivered to this channel per minute; excess is dropped. Omit for the env default, 0 for unlimited.", example: 60 })
  throttlePerMin?: number;
}

// ---------------------------------------------------------------------------
// Settings (runtime rate limits)
// ---------------------------------------------------------------------------

export class RateLimitConfigDto {
  @ApiPropertyOptional({ description: "Per-API-key budget for POST /v1/decisions. null reverts to the env default.", example: 600 })
  decisionsPerMin?: number | null;

  @ApiPropertyOptional({ description: "Per-IP budget for POST /v1/auth/login. null reverts to the env default.", example: 10 })
  loginPerMin?: number | null;
}

export class AlertConfigDto {
  @ApiPropertyOptional({ description: "Amount z-score at/above which a decision emits alert.anomaly.v1. null reverts to the default (3).", example: 3 })
  anomalyZScore?: number | null;
}

export class RetentionConfigDto {
  @ApiPropertyOptional({ description: "Days to keep the verdict log. 0 = keep forever; null reverts to the env default.", example: 365 })
  verdicts?: number | null;

  @ApiPropertyOptional({ description: "Days to keep the API activity log. 0 = keep forever; null reverts to the env default.", example: 90 })
  activity?: number | null;

  @ApiPropertyOptional({ description: "Days to keep replay samples. 0 = keep forever; null reverts to the env default.", example: 90 })
  replay?: number | null;

  @ApiPropertyOptional({ description: "Days to keep idempotency keys. 0 = keep forever; null reverts to the env default.", example: 7 })
  idempotency?: number | null;

  @ApiPropertyOptional({ description: "Days to keep dead-lettered outbox rows. 0 = keep forever; null reverts to the env default.", example: 30 })
  deadLetter?: number | null;
}
