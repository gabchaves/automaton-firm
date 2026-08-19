import type { PalcoSnapshot } from "../types";
import { NumberTicker } from "../components/NumberTicker";

interface SobreTabProps {
  snapshot: PalcoSnapshot | null;
}

/** Fixed, editorial-page copy (v3.1 plan) — "quem constrói" + "o projeto".
 * Every string below is verbatim per the plan's exact-copy ruling; only
 * the three fact-strip numbers pull from the live snapshot. Written in
 * normal/mixed case, same convention as every other `.label`/`.chip` on
 * this site (e.g. App.tsx's nav kicker) — the CSS class itself
 * text-transforms to uppercase, so the source string doesn't need to be. */

const ROLE_CHIP = "Legal Operations · Automação · IA";

const BIO =
  "Analista em Legal Operations na Reasset Capital (São José dos Campos, SP). Formação jurídica, aprovado na OAB, pós em Compliance Contratual em andamento — e uma obsessão por transformar processos em software. Atuo como ponte entre negócio e times técnicos: mapeio dores, valido POCs e entrego automação com valor mensurável. Este projeto é o meu laboratório: agentes de IA, evolução e honestidade estatística num só lugar.";

const SKILLS = ["Claude API", "MCP", "Prompt Engineering", "Python", "n8n", "Make", "RPA", "Power BI", "AWS", "Scrum"];

const PROJECT_LEAD =
  "Uma firma de trading onde ninguém é humano. Traders nascem de um genoma, operam dinheiro de papel em dados reais da Binance, são avaliados por um RH que só demite com evidência — e quando a geração morre, a próxima herda os melhores genes.";

const PROJECT_PARAGRAPHS = [
  "O Motor roda 24/7: barras de 5 minutos de BTC, ETH e SOL, decisões determinísticas, tudo gravado num log de eventos que esta página lê ao vivo. Ao lado da firma evoluída corre um controle aleatório com os mesmos limites — o espelho honesto que impede a gente de se enganar.",
  "A regra de ouro é pré-registrada: dinheiro real só entra em discussão se a linhagem evoluída vencer o controle aleatório E o não-fazer-nada por três meses de dados nunca vistos, fora da banda de ruído. Até lá, é ciência com cara de pregão.",
  "Stack: TypeScript, SQLite, React, SSE — e nenhuma chamada de LLM no caminho crítico. Pesquisa anterior do projeto mediu e descartou 'edges' ilusórios; este front existe pra tornar o experimento assistível.",
];

const FOOTER_CHIP = "status: procurando o primeiro recorde honesto";

export function SobreTab({ snapshot }: SobreTabProps) {
  const virginDays = snapshot?.cards.virginDays;
  const gensEvolved = snapshot?.cards.gensEvolved;

  return (
    <div className="sobre-page">
      <section className="sobre-section">
        <h2 className="section-title">Quem constrói</h2>
        <h3 className="sobre-name">Gabriel Ernesto Chaves</h3>
        <span className="label sobre-role-chip">{ROLE_CHIP}</span>
        <p className="sobre-bio">{BIO}</p>
        <div className="genome-chips">
          {SKILLS.map((skill) => (
            <span className="chip" key={skill}>
              {skill}
            </span>
          ))}
        </div>
        <p className="sobre-contact">
          <a href="mailto:gabchaves2@gmail.com">gabchaves2@gmail.com</a> · LinkedIn
        </p>
      </section>

      <hr className="rule" />

      <section className="sobre-section">
        <h2 className="section-title">O projeto</h2>
        <p className="sobre-lead">{PROJECT_LEAD}</p>

        <div className="sobre-facts">
          <span className="sobre-fact">
            {virginDays !== undefined ? (
              <NumberTicker value={virginDays} format={(n) => `${n.toFixed(1)} dias de dados virgens`} />
            ) : (
              "– dias de dados virgens"
            )}
          </span>
          <span className="sobre-fact">
            {gensEvolved !== undefined ? (
              <NumberTicker value={gensEvolved} format={(n) => `geração ${Math.round(n)} no ar`} />
            ) : (
              "geração – no ar"
            )}
          </span>
          <span className="sobre-fact">$100 por geração, sempre</span>
        </div>

        {PROJECT_PARAGRAPHS.map((paragraph, index) => (
          <p key={`sobre-p-${index}`} className="sobre-paragraph">
            {paragraph}
          </p>
        ))}

        <span className="label sobre-footer-chip">{FOOTER_CHIP}</span>
      </section>
    </div>
  );
}
