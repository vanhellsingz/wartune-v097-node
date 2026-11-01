'use strict';

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, 'logs da compilação', 'captura de packets');
const SESSIONS_DIR = path.join(BASE_DIR, 'sessoes');
const REPORTS_DIR = path.join(BASE_DIR, 'relatorios');

function analyzeSession(sessionId) {
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Arquivo de sessao nao encontrado: ${sessionPath}`);
  }

  const lines = fs.readFileSync(sessionPath, 'utf8').trim().split('\n');
  const entries = lines.map(line => JSON.parse(line));

  const stats = {
    totalEntries: entries.length,
    uiEvents: 0,
    c2sPackets: 0,
    s2cPackets: 0,
    unknownPackets: 0,
    malformedPackets: 0,
    serverOutcomes: 0,
    movementAggregated: 0,
    opcodesSeen: {},
    categories: {}
  };

  const timeline = [];
  const unknownList = [];
  const correlations = [];
  let lastUIEvent = null;
  let lastC2SPacket = null;

  for (const e of entries) {
    if (e.type === 'SESSION_START') {
      timeline.push(`[${e.timestamp}] Início da Sessão: ${e.sessionId} (Modo: ${e.mode})`);
    } else if (e.type === 'SESSION_END') {
      timeline.push(`[${e.timestamp}] Fim da Sessão: ${e.sessionId}`);
    } else if (e.type === 'MOVEMENT_SUMMARY') {
      stats.movementAggregated += e.summary.count;
      timeline.push(`[${e.timestamp}] Movimento Agregado: ${e.summary.count} passos/rotas descartados do log detalhado.`);
    } else if (e.layer === 'A_CLIENT_UI') {
      stats.uiEvents++;
      lastUIEvent = e;
      timeline.push(`[${e.timestamp}] [UI] Janela: ${e.window || 'Geral'} | Componente: ${e.component} | Ação: ${e.event} | Alvo: ${e.targetId}`);
    } else if (e.layer === 'B_NETWORK') {
      const isC2S = e.direction === 'C2S';
      if (isC2S) stats.c2sPackets++;
      else stats.s2cPackets++;

      stats.opcodesSeen[e.opcode] = (stats.opcodesSeen[e.opcode] || 0) + 1;
      stats.categories[e.category] = (stats.categories[e.category] || 0) + 1;

      if (e.messageName === 'UNKNOWN') {
        stats.unknownPackets++;
        unknownList.push({ opcode: e.opcode, length: e.length, timestamp: e.timestamp, sample: e.sampleHex });
      }
      if (e.messageName === 'MALFORMED_FRAME') {
        stats.malformedPackets++;
      }

      timeline.push(`[${e.timestamp}] [REDE ${e.direction}] Opcode: ${e.opcode} (${e.messageName}) | Categoria: ${e.category} | Tam: ${e.length} bytes`);

      if (isC2S) {
        lastC2SPacket = e;
      } else if (lastC2SPacket) {
        // Correlação semântica entre requisição e resposta
        correlations.push({
          ui: lastUIEvent ? `${lastUIEvent.component} (${lastUIEvent.event})` : 'N/A',
          request: `${lastC2SPacket.opcode} (${lastC2SPacket.messageName})`,
          response: `${e.opcode} (${e.messageName})`,
          category: e.category,
          timestamp: e.timestamp
        });
      }
    } else if (e.layer === 'C_SERVER_OUTCOME') {
      stats.serverOutcomes++;
      timeline.push(`[${e.timestamp}] [SERVIDOR] Handler: ${e.handler} | Validação: ${e.validations} | Resposta: ${e.responseOpcode} | Estado: ${e.finalState}`);
    }
  }

  // Gerar relatório consolidado em Markdown
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `RELATORIO_${sessionId}.md`);

  const md = `# RELATÓRIO DE CAPTURA E ANÁLISE — SESSÃO: ${sessionId}
**Data da Análise:** ${new Date().toISOString()}
**Total de Registros:** ${stats.totalEntries}

---

## 1. Estatísticas Gerais

| Métrica | Quantidade |
|---|:---:|
| Eventos de Interface (Camada A) | ${stats.uiEvents} |
| Pacotes Cliente $\\rightarrow$ Servidor (C2S) | ${stats.c2sPackets} |
| Pacotes Servidor $\\rightarrow$ Cliente (S2C) | ${stats.s2cPackets} |
| Respostas / Resultados do Servidor (Camada C) | ${stats.serverOutcomes} |
| Passos de Movimentação Agregados / Suprimidos | ${stats.movementAggregated} |
| Pacotes Desconhecidos (Classificados) | ${stats.unknownPackets} |
| Pacotes Malformados com Erro | ${stats.malformedPackets} |

---

## 2. Correlações Semânticas (UI $\\rightarrow$ Requisição $\\rightarrow$ Resposta)

| Ação de Interface | Pacote Enviado (C2S) | Resposta Recebida (S2C) | Categoria | Timestamp |
|---|---|---|---|---|
${correlations.length > 0 ? correlations.map(c => `| ${c.ui} | ${c.request} | ${c.response} | ${c.category} | ${c.timestamp} |`).join('\n') : '| Nenhuma correlação direta identificada | — | — | — | — |'}

---

## 3. Opcodes Observados na Sessão

| Opcode | Ocorrências | Categoria Estimada |
|---|:---:|---|
${Object.entries(stats.opcodesSeen).map(([op, cnt]) => `| \`${op}\` | ${cnt} | ${PROTO_NAME(op)} |`).join('\n')}

---

## 4. Pacotes Desconhecidos Identificados

${unknownList.length > 0 ? unknownList.map(u => `- **Opcode ${u.opcode}** (${u.length} bytes em ${u.timestamp}) — Amostra segura: \`${u.sample || 'sem corpo'}\``).join('\n') : '*Nenhum pacote desconhecido observado nesta sessão.*'}

---

## 5. Linha do Tempo Técnica da Sessão

\`\`\`text
${timeline.join('\n')}
\`\`\`
`;

  fs.writeFileSync(reportPath, md);
  console.log(`[ANALISADOR] Relatório gerado com sucesso: ${reportPath}`);
  return { stats, reportPath };
}

function PROTO_NAME(op) {
  const map = {
    '5005': 'inventory (C_BAG_MOVE)',
    '115': 'inventory (U_C_BAG_MOVE_UPDATE)',
    '5125': 'campaign (U_C_CAMPAIGN_ARRIVE)',
    '128': 'campaign (U_C_CAMPAIGN_NODE_UPDATE)',
    '5032': 'campaign (U_C_CAMPAIGN_CALLBACK)',
    '125': 'campaign (U_C_CAMPAIGN_CREATE)',
    '21': 'campaign (U_C_CAMPAIGN_ENTER)',
    '127': 'campaign (U_C_CAMPAIGN_NODE_LIST)',
    '5012': 'quest (U_C_QUEST_ADD)',
    '112': 'quest (U_C_QUEST_UPDAT)',
    '5014': 'quest (U_C_QUEST_FINISH)',
    '52': 'quest (U_C_QUEST_FINISH_RSP)',
    '5017': 'tutorial (U_C_PLAYER_NOVICE)',
    '537': 'tutorial (U_C_SYSTEMOPEN_ALLREADY)',
    '3': 'hero (PlayerMsg)',
    '6': 'scene (LoginStateMsg)',
    '20001': 'hero (G_LOGIN_GATEWAY)',
    '3841': 'hero (G_LOGIN_GATEWAY_RSP)',
    '4177': 'hero (PlayerKeyRspMsg)'
  };
  return map[String(op)] || 'unknown';
}

module.exports = { analyzeSession };
