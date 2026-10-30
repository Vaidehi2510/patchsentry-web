import { authConfig, createAuth, type Auth, type AuthConfig } from "./auth";
import { createDatabase, type Database } from "./database";
import type { CatalogModel } from "../contracts";

export interface Runtime {
  defer?: (work:()=>Promise<unknown>)=>void;
  hosted?: import("./hosted").HostedAdapter;
  hostedLookup?: typeof import("node:dns/promises").lookup;
  database: Database;
  auth: Auth;
  config: AuthConfig;
  catalog?: () => Promise<{ models: CatalogModel[]; fetchedAt: string }>;
  connectionFetch?: typeof fetch;
  inferenceFetch?: typeof fetch;
  repositoryFetch?: typeof fetch;
  slackFetch?: typeof fetch;
  domainResolve?: (name:string)=>Promise<string[][]>;
}
let current: Promise<Runtime | null> | undefined;

export function getRuntime(): Promise<Runtime | null> {
  if (!current)
    current = (async () => {
      const config = authConfig();
      if (!config) return null;
      const database = await createDatabase();
      return { database, auth: createAuth(database, config), config };
    })().catch((error) => {
      current = undefined;
      throw error;
    });
  return current;
}
