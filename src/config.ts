import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface DNA {
  agent_name: string;
  face: string;
  eyes: string;
  hair: string;
  skin: string;
  body: string;
  default_style: string;
  immutable_traits: string[];
  personality_note?: string; // brief vibe note for scene context
}

export interface ProductReference {
  name: string;
  description: string;
}

export interface AvatarConfig {
  dna: DNA;
  references: Partial<Record<"front" | "side" | "three_quarter" | "neutral", string>>;
  created_at: string;
  updated_at: string;
}

export function getConfigDir(agentName: string): string {
  const dir = join(homedir(), ".agent-avatar", agentName.toLowerCase().replace(/\s+/g, "-"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getRefsDir(agentName: string): string {
  const dir = join(getConfigDir(agentName), "references");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadConfig(agentName: string): AvatarConfig | null {
  const path = join(getConfigDir(agentName), "dna.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AvatarConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: AvatarConfig): void {
  const path = join(getConfigDir(config.dna.agent_name), "dna.json");
  config.updated_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(config, null, 2));
}

export function getActiveAgentName(): string | null {
  const envName = process.env.AGENT_NAME;
  if (envName) return envName;
  // check if there's only one agent configured
  const dir = join(homedir(), ".agent-avatar");
  if (!existsSync(dir)) return null;
  const agents = readdirSync(dir).filter((f: string) =>
    existsSync(join(dir, f, "dna.json"))
  );
  return agents.length === 1 ? agents[0] : null;
}
