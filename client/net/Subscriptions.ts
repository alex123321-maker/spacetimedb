import { tables } from "../module_bindings";

export const CLIENT_SUBSCRIPTIONS = [
  tables.worldState,
  tables.worldConfig,
  tables.player,
  tables.obstacle,
  tables.junk,
  tables.generator,
  tables.line,
  tables.rootNode,
  tables.rootRelocation,
  tables.captureAttempt,
  tables.eventLog,
] as const;
