import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function localDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0000_model_briefs.sql", import.meta.url), "utf8"));
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            first: async () => statement.get(...values) ?? null,
            all: async () => ({ results: statement.all(...values) }),
            run: async () => statement.run(...values),
          };
        },
      };
    },
    close() { sqlite.close(); },
  };
}
