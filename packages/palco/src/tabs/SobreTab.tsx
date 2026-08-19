import type { PalcoSnapshot } from "../types";
import { NumberTicker } from "../components/NumberTicker";

interface SobreTabProps {
  snapshot: PalcoSnapshot | null;
}

/** Editorial about page (v3.3): projeto primeiro, autor depois, humor no
 * texto. A "regra de ouro" mora aqui agora — saiu do rodapé global a pedido
 * do dono da firma. Só os números do fact-strip são vivos. */

const PROJECT_LEAD =
  "Uma firma de trading onde ninguém é humano. Traders nascem de um genoma, operam dinheiro de papel em dados reais da Binance, são avaliados por um RH que só demite com evidência — e quando a geração quebra, a próxima herda os melhores genes. É darwinismo com CNPJ imaginário.";

const PROJECT_PARAGRAPHS = [
  "O Motor roda 24/7 sem tomar café: barras de 5 minutos de BTC, ETH e SOL, decisões 100% determinísticas, tudo gravado num log de eventos que esta página lê ao vivo. Ao lado da firma evoluída corre um controle aleatório com os mesmos limites — cinco traders que decidem na moeda e existem só pra nos impedir de contar vantagem. Spoiler: às vezes é constrangedoramente difícil vencê-los.",
  "Se um trader vai mal, o RH demite (com relatório). Se vai bem, ganha um título e um post no mural. Se a geração inteira zera, ninguém chora: anota-se o recorde, mistura-se os melhores genomas e nasce a próxima com $100 novinhos. O gráfico de recordes é o eletrocardiograma do experimento — reto até segunda ordem.",
  "Stack: TypeScript, SQLite, React, SSE — e nenhuma chamada de IA no caminho crítico, porque evolução que precisa de ajuda não é evolução. A pesquisa anterior do projeto mediu e enterrou vários 'edges' ilusórios; este front existe pra tornar o velório assistível. E bonito.",
];

const GOLDEN_RULE =
  "Dinheiro real só entra em discussão se a linhagem evoluída vencer o controle aleatório E o não-fazer-nada por ≥ 3 meses de dados virgens ao vivo, fora da banda de ruído.";

const FOOTER_CHIP = "status: procurando o primeiro recorde honesto";

const ROLE_CHIP = "Legal Operations · Automação · IA";

const BIO =
  "Analista em Legal Operations na Reasset Capital (São José dos Campos, SP). Formação jurídica, aprovado na OAB, pós em Compliance Contratual em andamento — e uma obsessão por transformar processo em software. De dia, traduzo dores de negócio em automação com ROI de verdade; de noite, administro uma firma de robôs que me deixam orgulhoso e falido em dinheiro de mentira. Este projeto é o meu laboratório: agentes de IA, evolução e honestidade estatística no mesmo pregão.";

const SKILLS = ["Claude API", "MCP", "Prompt Engineering", "Python", "n8n", "Make", "RPA", "Power BI", "AWS", "Scrum"];

export function SobreTab({ snapshot }: SobreTabProps) {
  const virginDays = snapshot?.cards.virginDays;
  const gensEvolved = snapshot?.cards.gensEvolved;

  return (
    <div className="sobre-page">
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

        <aside className="sobre-golden-rule">
          <span className="label">A regra de ouro</span>
          <p>{GOLDEN_RULE}</p>
        </aside>

        <span className="label sobre-footer-chip">{FOOTER_CHIP}</span>
      </section>

      <hr className="rule" />

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
    </div>
  );
}
