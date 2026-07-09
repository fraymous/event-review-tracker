import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadSupabaseEnv, parseArgs, timestampSlug } from "./lib/supabase-env.mjs";

const tables = ["organizations", "profiles", "event_reviews", "review_attachments", "share_links"];
const pageSize = 1000;

async function fetchAllRows(supabase, table) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select("*").range(from, to);

    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));

    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function listStorageObjects(supabase, prefix = "") {
  const bucket = supabase.storage.from("review-attachments");
  const { data, error } = await bucket.list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });

  if (error) {
    if (/not found|does not exist/i.test(error.message)) return [];
    throw new Error(`review-attachments storage: ${error.message}`);
  }

  const objects = [];
  for (const item of data || []) {
    const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.metadata) {
      objects.push({ ...item, path: objectPath });
    } else {
      objects.push(...await listStorageObjects(supabase, objectPath));
    }
  }

  return objects;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = args.env || ".env.local";
  const { supabaseUrl, serviceRoleKey, projectRef } = loadSupabaseEnv(envFile);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const exportedTables = {};
  for (const table of tables) {
    exportedTables[table] = await fetchAllRows(supabase, table);
  }

  const storageObjects = await listStorageObjects(supabase);
  const generatedAt = new Date();
  const backup = {
    generatedAt: generatedAt.toISOString(),
    projectRef,
    counts: Object.fromEntries(tables.map((table) => [table, exportedTables[table].length])),
    storage: {
      reviewAttachmentsObjects: storageObjects,
      reviewAttachmentsObjectCount: storageObjects.length,
    },
    tables: exportedTables,
  };

  const outArg = args.out || "backups";
  const outputPath = outArg.endsWith(".json")
    ? path.resolve(outArg)
    : path.resolve(outArg, `supabase-backup-${projectRef}-${timestampSlug(generatedAt)}.json`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(backup, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    outputPath,
    projectRef,
    counts: backup.counts,
    reviewAttachmentsObjectCount: storageObjects.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
