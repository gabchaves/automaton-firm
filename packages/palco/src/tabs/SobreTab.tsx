import type { ReactNode } from "react";
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";
import { initials, avatarBackground } from "../avatar";

interface SobreTabProps {
  snapshot: PalcoSnapshot | null;
}

/** Editorial about page (v3.3): projeto primeiro, autor depois, humor no
 * texto. v4 Task B3 restructures both halves for hierarchy — the fact
 * strip becomes real `.hero-card` stat-cards, "O projeto" splits into
 * short labeled subsections instead of a wall of paragraphs, a compact
 * "Motor → RH → Recorde" chip strip visualizes the loop, and the author
 * gets a big initials avatar (avatar.ts) instead of a bare text block. The
 * "regra de ouro" mora aqui desde a rodada anterior e o banner azul fica
 * como está — já resolvido. Só os números do fact-strip são vivos. */

const PROJECT_LEAD =
  "Uma firma de trading onde ninguém é humano. Traders nascem de um genoma, operam dinheiro de papel em dados reais da Binance, são avaliados por um RH que só demite com evidência — e quando a geração quebra, a próxima herda os melhores genes. É darwinismo com CNPJ imaginário.";

const COMO_FUNCIONA_1 =
  "O Motor roda 24/7 sem tomar café: barras de 5 minutos de BTC, ETH e SOL, decisões 100% determinísticas, tudo gravado num log de eventos que esta página lê ao vivo. Ao lado da firma evoluída corre um controle aleatório com os mesmos limites — cinco traders que decidem na moeda e existem só pra nos impedir de contar vantagem. Spoiler: às vezes é constrangedoramente difícil vencê-los.";

const STACK_TEXT =
  "TypeScript, SQLite, React, SSE — e nenhuma chamada de IA no caminho crítico, porque evolução que precisa de ajuda não é evolução. A pesquisa anterior do projeto mediu e enterrou vários 'edges' ilusórios; este front existe pra tornar o velório assistível. E bonito.";

/** The "Como funciona" governance paragraph names the per-generation seed
 * amount ("... novinhos"), so unlike the other subsections it's built
 * fresh each render from `seedMc` instead of living as a fixed string. */
function comoFuncionaGoverno(seedMc: number): string {
  return `Se um trader vai mal, o RH demite (com relatório). Se vai bem, ganha um título e um post no mural. Se a geração inteira zera, ninguém chora: anota-se o recorde, mistura-se os melhores genomas e nasce a próxima com ${usd(seedMc)} novinhos. O gráfico de recordes é o eletrocardiograma do experimento — reto até segunda ordem.`;
}

const GOLDEN_RULE =
  "Dinheiro real só entra em discussão se a linhagem evoluída vencer o controle aleatório E o não-fazer-nada por ≥ 3 meses de dados virgens ao vivo, fora da banda de ruído.";

const FOOTER_CHIP = "status: procurando o primeiro recorde honesto";

const ROLE_CHIP = "Legal Operations · Automação · IA";

const AUTHOR_NAME = "Gabriel Ernesto Chaves";

const LINKEDIN_URL = "https://www.linkedin.com/in/gabriel-chaves2/";

const BIO =
  "Analista em Legal Operations na Reasset Capital (São José dos Campos, SP). Formação jurídica, aprovado na OAB, pós em Compliance Contratual em andamento — e uma obsessão por transformar processo em software. De dia, traduzo dores de negócio em automação com ROI de verdade; de noite, administro uma firma de robôs que me deixam orgulhoso e falido em dinheiro de mentira. Este projeto é o meu laboratório: agentes de IA, evolução e honestidade estatística no mesmo pregão.";

const SKILLS = ["Claude API", "MCP", "Prompt Engineering", "Python", "n8n", "Make", "RPA", "Power BI", "AWS", "Scrum"];

/** One short, mini-titled chunk of "O projeto" — the v4 Task B3 fix for
 * the old "wall of text" (3 long, untitled paragraphs back to back). Reuses
 * the same `.label` chip + subtitle margin pattern EmpresaDrawer's profile
 * sections already established ("Papel na firma", "Genoma", etc.), instead
 * of inventing a new heading style. */
function SobreSubsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sobre-subsection">
      <h3 className="sobre-subsection-title label">{title}</h3>
      {children}
    </div>
  );
}

/** Compact "Motor → RH → Recorde" flow strip (v4 Task B3) — the same
 * chip/arrow visual language as the genome chips elsewhere (`.genome-chips
 * .chip`/`.chip-desk`, reused as-is, no new chip style), just three labeled
 * beats instead of gene tags. Purely illustrative: the same loop the
 * "Como funciona" prose above it already describes in full sentences. */
function SobreFlowStrip() {
  return (
    <div className="genome-chips sobre-flow-strip" aria-label="Como funciona, em 3 passos: Motor, RH, Recorde">
      <span className="chip chip-desk">Motor</span>
      <span className="sobre-flow-arrow" aria-hidden="true">
        →
      </span>
      <span className="chip chip-desk">RH</span>
      <span className="sobre-flow-arrow" aria-hidden="true">
        →
      </span>
      <span className="chip chip-desk">Recorde</span>
    </div>
  );
}

export function SobreTab({ snapshot }: SobreTabProps) {
  // Sane fallback while there's no snapshot yet; every real render derives
  // from cards.genStartMc instead, so a bankroll scale change never
  // touches this file again.
  const seedMc = snapshot?.cards.genStartMc ?? 100_000_000;

  return (
    <div className="sobre-page">
      <section className="sobre-section">
        <h2 className="section-title">O projeto</h2>

        {/* v4.2: the fact-cards row (dias virgens / geração / seed) was
            removed — it duplicated the global hero strip at the top of
            every tab, and reads as clutter right under the page title. */}

        <SobreSubsection title="O que é">
          <p className="sobre-lead">{PROJECT_LEAD}</p>
        </SobreSubsection>

        <SobreSubsection title="Como funciona">
          <p className="sobre-paragraph">{COMO_FUNCIONA_1}</p>
          <SobreFlowStrip />
          <p className="sobre-paragraph">{comoFuncionaGoverno(seedMc)}</p>
        </SobreSubsection>

        <SobreSubsection title="Stack">
          <p className="sobre-paragraph">{STACK_TEXT}</p>
        </SobreSubsection>

        <aside className="sobre-golden-rule">
          <span className="label">A regra de ouro</span>
          <p>{GOLDEN_RULE}</p>
        </aside>

        <span className="label sobre-footer-chip">{FOOTER_CHIP}</span>
      </section>

      <hr className="rule" />

      <section className="sobre-section">
        <h2 className="section-title">Quem constrói</h2>
        <div className="sobre-author-header">
          <div className="sobre-author-avatar" style={{ background: avatarBackground(AUTHOR_NAME) }}>
            {initials(AUTHOR_NAME)}
          </div>
          <div>
            <h3 className="sobre-name">{AUTHOR_NAME}</h3>
            <span className="label sobre-role-chip">{ROLE_CHIP}</span>
          </div>
        </div>
        <p className="sobre-bio">{BIO}</p>
        <div className="genome-chips">
          {SKILLS.map((skill) => (
            <span className="chip" key={skill}>
              {skill}
            </span>
          ))}
        </div>
        <p className="sobre-contact">
          <a href="mailto:gabchaves2@gmail.com">gabchaves2@gmail.com</a> ·{" "}
          <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer">
            LinkedIn
          </a>
        </p>
      </section>
    </div>
  );
}
