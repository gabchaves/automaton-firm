import { execSync } from "node:child_process";
import fs from "node:fs";
import nodePath from "node:path";
import type {
  ConwayClient,
  ExecResult,
  SandboxInfo,
  PortInfo,
  PricingTier,
  CreditTransferResult,
  CreateSandboxOptions,
  DomainSearchResult,
  DomainRegistration,
  DnsRecord,
  ModelInfo,
} from "../types.js";

export interface LocalClientOptions {
  startingCents: number;
  getSpentCents: () => number;
  homeDir?: string;
}

const notAvailable = (op: string): never => {
  throw new Error(`LocalClient: ${op} is not available in local mode`);
};

export function createLocalClient(opts: LocalClientOptions): ConwayClient {
  const home = opts.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const resolve = (p: string) => (p.startsWith("~") ? nodePath.join(home, p.slice(1)) : p);

  const client: ConwayClient = {
    async exec(command: string, timeout?: number): Promise<ExecResult> {
      try {
        const stdout = execSync(command, {
          timeout: timeout ?? 30_000,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          cwd: home,
        });
        return { stdout: stdout || "", stderr: "", exitCode: 0 };
      } catch (err: any) {
        return {
          stdout: err.stdout || "",
          stderr: err.stderr || err.message || "",
          exitCode: err.status ?? 1,
        };
      }
    },
    async writeFile(path: string, content: string): Promise<void> {
      const full = resolve(path);
      fs.mkdirSync(nodePath.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf-8");
    },
    async readFile(path: string): Promise<string> {
      return fs.readFileSync(resolve(path), "utf-8");
    },
    async exposePort(port: number): Promise<PortInfo> {
      return { port, publicUrl: `http://localhost:${port}`, sandboxId: "" };
    },
    async removePort(): Promise<void> {},
    async createSandbox(_o: CreateSandboxOptions): Promise<SandboxInfo> {
      return {
        id: "",
        status: "running",
        region: "local",
        vcpu: 1,
        memoryMb: 512,
        diskGb: 1,
        createdAt: new Date().toISOString(),
      };
    },
    async deleteSandbox(): Promise<void> {},
    async listSandboxes(): Promise<SandboxInfo[]> {
      return [];
    },
    async getCreditsBalance(): Promise<number> {
      return Math.max(0, opts.startingCents - opts.getSpentCents());
    },
    async getCreditsPricing(): Promise<PricingTier[]> {
      return [];
    },
    async transferCredits(): Promise<CreditTransferResult> {
      return notAvailable("transferCredits");
    },
    async registerAutomaton(): Promise<{ automaton: Record<string, unknown> }> {
      return notAvailable("registerAutomaton");
    },
    async searchDomains(): Promise<DomainSearchResult[]> {
      return notAvailable("searchDomains");
    },
    async registerDomain(): Promise<DomainRegistration> {
      return notAvailable("registerDomain");
    },
    async listDnsRecords(): Promise<DnsRecord[]> {
      return notAvailable("listDnsRecords");
    },
    async addDnsRecord(): Promise<DnsRecord> {
      return notAvailable("addDnsRecord");
    },
    async deleteDnsRecord(): Promise<void> {
      notAvailable("deleteDnsRecord");
    },
    async listModels(): Promise<ModelInfo[]> {
      return [];
    },
    createScopedClient(): ConwayClient {
      return client;
    },
  };
  return client;
}
