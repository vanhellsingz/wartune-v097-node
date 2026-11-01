'use strict';

const fs = require('fs');
const path = require('path');
let originalPb = null;
try {
  originalPb = require('./original-protobuf');
} catch (e) {}

const BASE_DIR = path.join(__dirname, 'logs da compilação', 'captura de packets');
const SESSIONS_DIR = path.join(BASE_DIR, 'sessoes');
const CONFIG_PATH = path.join(BASE_DIR, 'CONFIGURACAO_CAPTURA.json');

// Mapa de opcodes conhecidos e seus tipos Protobuf correspondentes
const PROTOBUF_MAP = {
  // C2S
  5005: { name: 'C_BAG_MOVE', type: 'item.ItemReqMsg', category: 'inventory' },
  54: { name: 'C_BAG_MOVE', type: 'item.ItemReqMsg', category: 'inventory' },
  5007: { name: 'U_C_BAG_SELL', type: 'item.ItemSellReqMsg', category: 'inventory' },
  8624: { name: 'U_C_BAG_SELL', type: 'item.ItemSellReqMsg', category: 'inventory' },
  5125: { name: 'U_C_CAMPAIGN_ARRIVE', type: 'campaign.CampaignReqMsg', category: 'campaign' },
  9: { name: 'U_C_CAMPAIGN_ARRIVE', type: 'campaign.CampaignArriveReqMsg', category: 'campaign' },
  5032: { name: 'U_C_CAMPAIGN_CALLBACK', type: 'campaign.CallBackReqMsg', category: 'campaign' },
  31: { name: 'U_C_CAMPAIGN_CALLBACK', type: 'campaign.CampaignCallBackMsg', category: 'campaign' },
  5012: { name: 'U_C_QUEST_ADD', type: 'quest.QuestAddedMsg', category: 'quest' },
  5014: { name: 'U_C_QUEST_FINISH', type: 'quest.QuestFinishedReqMsg', category: 'quest' },
  5017: { name: 'U_C_PLAYER_NOVICE', type: 'novice.NoviceReqMsgMsg', category: 'tutorial' },
  1: { name: 'U_C_PLAYER_NOVICE', type: 'novice.NoviceReqMsgMsg', category: 'tutorial' },
  5127: { name: 'U_C_CAMPAIGN_TRAINING', type: 'novice.NoviceReqMsgMsg', category: 'tutorial' },
  5124: { name: 'U_C_CAMPAIGN_SYNCPOS', type: 'campaign.CampaignSyncPosMsg', category: 'movement' },
  10: { name: 'U_C_CAMPAIGN_SYNCPOS', type: 'campaign.CampaignSyncPosMsg', category: 'movement' },
  8254: { name: 'C_USER_RUN_WAY', type: 'scene.UserRunWayMsg', category: 'movement' },
  8224: { name: 'C_LONIG_LOAD_REQ', type: null, category: 'scene' },
  20001: { name: 'G_LOGIN_GATEWAY', type: null, category: 'hero' },
  5015: { name: 'U_C_RES_UPDATE', type: null, category: 'castle' },
  8281: { name: 'C_BUILDING_INIT', type: null, category: 'castle' },
  134: { name: 'U_C_CAMPAIGN_FINISH', type: null, category: 'campaign' },
  5180: { name: 'U_C_CAMPAIGN_FINISH', type: null, category: 'campaign' },

  // S2C
  115: { name: 'U_C_BAG_MOVE_UPDATE', type: 'item.ItemMovedListMsg', category: 'inventory' },
  128: { name: 'U_C_CAMPAIGN_NODE_UPDATE', type: 'campaign.CampaignNodeUpdateMsg', category: 'campaign' },
  125: { name: 'U_C_CAMPAIGN_CREATE', type: 'room.RoomCreatedMsg', category: 'campaign' },
  21: { name: 'U_C_CAMPAIGN_ENTER', type: 'room.RoomEnterMsg', category: 'campaign' },
  127: { name: 'U_C_CAMPAIGN_NODE_LIST', type: 'campaign.CampaignNodeListMsg', category: 'campaign' },
  537: { name: 'U_C_SYSTEMOPEN_ALLREADY', type: 'systemopen.SystemOpenHashOpenList', category: 'tutorial' },
  112: { name: 'U_C_QUEST_UPDAT', type: 'quest.QuestUpdatedRspMsg', category: 'quest' },
  52: { name: 'U_C_QUEST_FINISH_RSP', type: 'quest.QuestFinishedRspMsg', category: 'quest' },
  3: { name: 'PlayerMsg', type: 'player.PlayerMsg', category: 'hero' },
  6: { name: 'LoginStateMsg', type: 'player.LoginStateMsg', category: 'scene' },
  150: { name: 'SerialArmyMsg', type: null, category: 'hero' },
  169: { name: 'ArmyUpdatedGridMsg', type: null, category: 'hero' },
  301: { name: 'FashionInfoMsg', type: null, category: 'hero' },
  3841: { name: 'G_LOGIN_GATEWAY_RSP', type: null, category: 'hero' },
  4177: { name: 'PlayerKeyRspMsg', type: null, category: 'hero' },
  4234: { name: 'SynchronizedTimeMsg', type: null, category: 'hero' }
};

class PacketRecorder {
  constructor() {
    this.mode = 'DESLIGADO';
    this.sessionId = null;
    this.sessionFile = null;
    this.stream = null;
    this.config = null;
    this.movementSummary = { count: 0, lastOpcode: null, errors: 0 };
    this.stats = { totalRecorded: 0, byCategory: {}, errors: 0 };
    this.reloadConfig();
  }

  reloadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        this.config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        this.mode = this.config.modo || 'DESLIGADO';
        if (this.config.sessao_atual && !this.sessionId) {
          this.startSession(this.config.sessao_atual, this.mode);
        }
      } else {
        this.mode = 'DESLIGADO';
      }
    } catch (err) {
      this.mode = 'DESLIGADO';
    }
  }

  startSession(sessionId, mode = 'DIAGNOSTICO') {
    this.endSession();
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    this.sessionId = sessionId || ('sessao_' + Date.now());
    this.mode = mode;
    this.sessionFile = path.join(SESSIONS_DIR, `${this.sessionId}.jsonl`);
    this.stats = { totalRecorded: 0, byCategory: {}, errors: 0 };
    this.movementSummary = { count: 0, lastOpcode: null, errors: 0 };

    this.writeEntry({
      type: 'SESSION_START',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      mode: this.mode
    });
    return this.sessionId;
  }

  endSession() {
    if (this.sessionId && this.sessionFile) {
      if (this.movementSummary.count > 0) {
        this.writeEntry({
          type: 'MOVEMENT_SUMMARY',
          timestamp: new Date().toISOString(),
          sessionId: this.sessionId,
          summary: this.movementSummary
        });
      }
      this.writeEntry({
        type: 'SESSION_END',
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        stats: this.stats
      });
    }
    const ended = this.sessionId;
    this.sessionId = null;
    this.sessionFile = null;
    return ended;
  }

  isActive() {
    return this.mode !== 'DESLIGADO' && this.sessionId !== null && this.sessionFile !== null;
  }

  writeEntry(entry) {
    if (!this.sessionFile) return;
    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.sessionFile, line, 'utf8');
      this.stats.totalRecorded++;
      if (entry.category) {
        this.stats.byCategory[entry.category] = (this.stats.byCategory[entry.category] || 0) + 1;
      }
    } catch (err) {
      this.stats.errors++;
    }
  }

  maskSensitive(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const sensitiveKeys = ['password', 'pwd', 'token', 'sessionKey', 'cookie', 'key', 'sign', 'secret'];
    const copy = Array.isArray(obj) ? [] : {};
    for (const k of Object.keys(obj)) {
      if (sensitiveKeys.some(sk => k.toLowerCase().includes(sk))) {
        copy[k] = '[MASCARADO]';
      } else if (typeof obj[k] === 'object' && obj[k] !== null) {
        copy[k] = this.maskSensitive(obj[k]);
      } else {
        copy[k] = obj[k];
      }
    }
    return copy;
  }

  // CAMADA A: Eventos do Cliente (Interface / Ações de UI)
  recordUIEvent(data) {
    if (!this.isActive()) return;
    const entry = {
      layer: 'A_CLIENT_UI',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      category: data.category || 'ui',
      event: data.action || 'click',
      component: data.component || null,
      window: data.window || null,
      targetId: data.targetId !== undefined ? data.targetId : null,
      visualOutcome: data.visualOutcome || 'observed'
    };
    this.writeEntry(entry);
  }

  // CAMADA B: Mensagens de Rede (Cliente <-> Servidor)
  recordPacket(direction, opcode, rawBody, metadata = {}) {
    if (!this.isActive()) return;

    const info = PROTOBUF_MAP[opcode] || { name: 'UNKNOWN', type: null, category: 'unknown' };

    // Regra especial de movimento rotineiro (opcodes 5124, 10, 8254)
    const isRoutineMove = [5124, 10, 8254].includes(opcode);
    if (isRoutineMove && this.mode !== 'MOVIMENTO') {
      this.movementSummary.count++;
      this.movementSummary.lastOpcode = opcode;
      return; // Descartado do log detalhado para evitar centenas de linhas rotineiras
    }

    let decoded = null;
    let decodeError = null;

    if (info.type && originalPb && rawBody && rawBody.length > 0) {
      try {
        decoded = originalPb.decode(info.type, rawBody);
        decoded = this.maskSensitive(decoded);
      } catch (err) {
        decodeError = err.message;
      }
    }

    // Amostra segura para pacotes desconhecidos (máximo 64 bytes hex)
    let sampleHex = null;
    if (info.name === 'UNKNOWN' && rawBody && rawBody.length > 0) {
      const maxLen = Math.min(rawBody.length, 64);
      sampleHex = rawBody.subarray(0, maxLen).toString('hex');
    }

    const entry = {
      layer: 'B_NETWORK',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      direction: direction, // 'C2S' ou 'S2C'
      opcode: opcode,
      messageName: info.name,
      category: info.category,
      length: rawBody ? rawBody.length : 0,
      decoded: this.mode === 'RESUMIDO' ? null : decoded,
      decodeError: decodeError,
      sampleHex: sampleHex,
      clientId: metadata.clientId || metadata.characterId || null,
      isInteractiveNode: metadata.isInteractiveNode || false
    };

    this.writeEntry(entry);
  }

  // CAMADA C: Resultado do Servidor (Handlers, Persistência no MariaDB, Respostas)
  recordServerOutcome(data) {
    if (!this.isActive()) return;
    const entry = {
      layer: 'C_SERVER_OUTCOME',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      category: data.category || 'server',
      handler: data.handler || 'unknownHandler',
      validations: data.validations || 'passed',
      persistentChanges: this.maskSensitive(data.persistentChanges || null),
      responseOpcode: data.responseOpcode || null,
      error: data.error || null,
      finalState: data.finalState || 'OK'
    };
    this.writeEntry(entry);
  }

  // Registro de pacotes malformados
  recordMalformedPacket(direction, rawBytes, errorMsg) {
    if (!this.isActive()) return;
    const maxLen = Math.min(rawBytes ? rawBytes.length : 0, 64);
    const sampleHex = rawBytes ? rawBytes.subarray(0, maxLen).toString('hex') : '';
    const entry = {
      layer: 'B_NETWORK',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      direction: direction,
      opcode: -1,
      messageName: 'MALFORMED_FRAME',
      category: 'error',
      length: rawBytes ? rawBytes.length : 0,
      sampleHex: sampleHex,
      error: errorMsg
    };
    this.writeEntry(entry);
    this.stats.errors++;
  }
}

const recorderInstance = new PacketRecorder();
module.exports = recorderInstance;
