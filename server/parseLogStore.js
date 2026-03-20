import postgres from 'postgres';

const connectionString = String(process.env.BABEL_PARSE_LOG_DATABASE_URL || '').trim();

const getConnectionDiagnostics = () => {
  if (!connectionString) {
    return {
      configured: false,
      looksLikeApiUrl: false,
      hasPlaceholderPassword: false,
      host: null
    };
  }

  const looksLikeApiUrl = /^https?:\/\//i.test(connectionString);
  const hasPlaceholderPassword = /YOUR[-_ ]?PASSWORD/i.test(connectionString);

  let host = null;
  try {
    const parsed = new URL(connectionString);
    host = parsed.hostname || null;
  } catch {
    host = null;
  }

  return {
    configured: true,
    looksLikeApiUrl,
    hasPlaceholderPassword,
    host
  };
};

let db = null;
let schemaReadyPromise = null;

const getDb = () => {
  if (!connectionString) return null;
  if (!db) {
    db = postgres(connectionString, {
      max: 1,
      ssl: 'require',
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 20
    });
  }
  return db;
};

const ensureParseLogSchema = async () => {
  const client = getDb();
  if (!client) return false;

  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await client`
        create table if not exists parse_events (
          id bigserial primary key,
          created_at timestamptz not null default now(),
          sentence text not null,
          framework text not null,
          model_route text not null,
          model_used text,
          analysis_count integer not null default 0,
          parse_bundle jsonb not null
        )
      `;
      await client`
        create index if not exists parse_events_created_at_idx
        on parse_events (created_at desc)
      `;
      await client`
        create index if not exists parse_events_framework_route_idx
        on parse_events (framework, model_route)
      `;
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
  return true;
};

export const recordParseEvent = async ({ sentence, framework, modelRoute, result }) => {
  if (!connectionString) return false;

  try {
    await ensureParseLogSchema();
    const client = getDb();
    if (!client) return false;

    await client`
      insert into parse_events (
        sentence,
        framework,
        model_route,
        model_used,
        analysis_count,
        parse_bundle
      ) values (
        ${sentence},
        ${framework},
        ${modelRoute},
        ${String(result?.modelUsed || '') || null},
        ${Array.isArray(result?.analyses) ? result.analyses.length : 0},
        ${client.json(result)}
      )
    `;

    return true;
  } catch (error) {
    const diagnostics = getConnectionDiagnostics();
    console.error(
      `[parse-log] host=${diagnostics.host || 'unknown'} api_url=${diagnostics.looksLikeApiUrl} placeholder_password=${diagnostics.hasPlaceholderPassword} err=${error?.message || String(error)}`
    );
    return false;
  }
};
