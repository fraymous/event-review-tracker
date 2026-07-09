import fs from "node:fs";
import path from "node:path";

export function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;

    const [rawKey, inlineValue] = item.slice(2).split("=");
    const next = argv[index + 1];
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      args[rawKey] = next;
      index += 1;
    } else {
      args[rawKey] = true;
    }
  }

  return args;
}

export function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).reduce((env, rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return env;

    const separator = line.indexOf("=");
    if (separator === -1) return env;

    const key = line.slice(0, separator);
    let value = line.slice(separator + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value.replaceAll("\\n", "\n");
    return env;
  }, {});
}

export function projectRefFromUrl(supabaseUrl) {
  if (!supabaseUrl) return "";
  return new URL(supabaseUrl).hostname.split(".")[0];
}

export function loadSupabaseEnv(envFile = ".env.local") {
  const envPath = path.resolve(envFile);
  const fileEnv = parseEnvFile(envPath);
  const env = { ...process.env, ...fileEnv };
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl) {
    throw new Error(`Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in ${envFile}.`);
  }

  if (!serviceRoleKey) {
    throw new Error(`Missing SUPABASE_SERVICE_ROLE_KEY in ${envFile}.`);
  }

  return {
    env,
    envPath,
    supabaseUrl,
    serviceRoleKey,
    projectRef: projectRefFromUrl(supabaseUrl),
    expectedProjectRef: env.EXPECTED_SUPABASE_PROJECT_REF || env.NEXT_PUBLIC_EXPECTED_SUPABASE_PROJECT_REF || "",
  };
}

export function timestampSlug(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}
