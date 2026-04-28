import { schedules, logger } from "@trigger.dev/sdk";
import { getSupabaseClient } from "../lib/supabase.js";

export const supabaseKeepAlive = schedules.task({
  id: "supabase-keep-alive",
  cron: "0 8 * * *", // Daily at 08:00 UTC
  run: async () => {
    const supabase = getSupabaseClient();

    // Step 1: Simple read query
    const { count, error: readError } = await supabase
      .from("properties")
      .select("*", { count: "exact", head: true });

    if (readError) {
      logger.error("Keep-alive read failed", { error: readError.message });
      throw readError;
    }

    logger.info("Keep-alive read complete", { propertyCount: count });

    // Step 2: Write + delete to simulate write activity
    // Use urgency_categories (no FK constraints) for a clean write cycle
    const { data: inserted, error: writeError } = await supabase
      .from("urgency_categories")
      .insert({
        level: "keep-alive",
        description: "keep-alive",
        examples: "keep-alive",
        response_time: "keep-alive",
      })
      .select("id")
      .single();

    if (writeError) {
      logger.warn("Keep-alive write failed", { error: writeError.message });
    } else if (inserted) {
      await supabase.from("urgency_categories").delete().eq("id", inserted.id);
      logger.info("Keep-alive write+delete complete");
    }

    // Step 3: Log success
    logger.info("Supabase keep-alive ping complete");
    return { status: "ok", propertyCount: count };
  },
});
