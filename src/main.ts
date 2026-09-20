import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { ConfigError, loadConfig } from "./config/env";
import { APP_VERSION } from "./version";
import { STORE } from "./shared/ports/store.port";
import { SWAGGER_LOGIN_JS } from "./docs/swagger-login";

/** Interactive API docs served by the engine itself at /docs (same-origin, so "Try it out" works). */
function setupDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle("Verdict Engine API")
    .setDescription(
      [
        "Self-hosted fraud & risk decisioning engine.",
        "",
        "**Two ways to authenticate, per endpoint:**",
        "- **Service API key** (`X-API-Key` header) — used only by the two integration endpoints your systems call: `POST /v1/decisions` and `POST /v1/labels/chargeback`.",
        "- **Operator bearer token** (`Authorization: Bearer …`) — used by every dashboard/admin endpoint. Get one from `POST /v1/auth/login`, or use the **Log in** bar above to authorize this page in one click. Some endpoints additionally require an `admin` role.",
        "",
        "Each endpoint's padlock shows which scheme it accepts. Public endpoints (health, auth status/login/register) need neither.",
      ].join("\n"),
    )
    .setVersion(APP_VERSION)
    .addApiKey({ type: "apiKey", name: "X-API-Key", in: "header" }, "apikey")
    .addBearerAuth({ type: "http", scheme: "bearer" }, "bearer")
    .build();
  // Security is declared per-controller/route via @ApiBearerAuth("bearer") / @ApiSecurity("apikey"),
  // so each endpoint shows the header it actually accepts — not a misleading "any of both" globally.
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document, {
    customSiteTitle: "Verdict API",
    customJsStr: SWAGGER_LOGIN_JS,
    swaggerOptions: { persistAuthorization: true, docExpansion: "list" },
  });
}

/**
 * Apply pending schema migrations before serving traffic. Only the Postgres store migrates;
 * the in-memory store (dev/tests) has nothing to create. A migration failure aborts startup.
 */
async function runStartupMigrations(app: INestApplication): Promise<void> {
  const store = app.get<{ migrate?: () => Promise<string[]> }>(STORE, { strict: false });
  if (typeof store?.migrate !== "function") return;
  const applied = await store.migrate();
  if (applied.length > 0) console.log(`verdict-engine applied migrations: ${applied.join(", ")}`);
}

/* eslint-disable no-console */
async function bootstrap(): Promise<void> {
  let config;
  try {
    const result = loadConfig();
    config = result.config;
    for (const w of result.warnings) console.warn(`  ⚠ ${w}`);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.pretty());
      process.exit(1);
    }
    throw e;
  }

  const app = await NestFactory.create(AppModule);
  // Trust only the configured proxy hops, so req.ip (used for per-IP rate limits) is the real
  // client and cannot be spoofed via X-Forwarded-For. Default false = ignore XFF entirely.
  app.getHttpAdapter().getInstance().set("trust proxy", config.trustProxy);
  await runStartupMigrations(app);
  setupDocs(app);
  await app.listen(config.port);
  const shared = config.redisUrl ? "redis (shared)" : "in-memory (single replica)";
  console.log(`verdict-engine listening on :${config.port} · persistence: ${config.persistence} · velocity/idempotency/limits: ${shared}`);
}

void bootstrap();
