import fs from "node:fs";
import path from "node:path";

export function loadStrategySkill(name: string | null, homeDir?: string): string {
  if (!name) return "";
  const home = homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const candidates = [
    path.join(home, ".automaton", "skills", name, "SKILL.md"),
    path.join(process.cwd(), "skills", name, "SKILL.md"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    } catch {
      // try next candidate
    }
  }
  return "";
}
