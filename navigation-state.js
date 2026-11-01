'use strict';

/**
 * navigation-state.js — Sistema Completo de Aventura de Navegação e Pesca
 *
 * Implementa:
 * - Despacho de Navios (Fleet / Shipping Boats)
 * - Portos e Rotas de Entrega (Ports & Tasks)
 * - Energia / Stamina Marítima (Strength 100/100)
 * - Sistema de Pesca (Fishing Start, Stop, Reward)
 * - Loja de Navegação (Navigation Shop & Currency)
 */

const fs = require('node:fs');
const path = require('node:path');

// Enums oficiais do cliente
const NavigationOp = {
  BOAT_ACTIVATE: 0,
  BOAT_IDLE: 1,
  BOAT_STOPPING: 2,
  BOAT_UPGRADE: 3,
  BOAT_UPGRADE_INVITE_SPEEDU: 4,
  BOAT_UPGRADE_ASSIST_SPEEDUP: 5,
  BOAT_UPGRADE_SPEEDUP: 6,
  BOAT_UPGRADE_FINISHED: 7,
  STREANTH_BUY: 8,
  PORT_REFRESH_TASK: 9,
  PORT_ABORT_TASK: 10,
  PORT_ACCEPT_TASK: 11,
  PORT_NEW_TASK: 12,
  SHOP_MAIN: 13,
  SHOP_BUY_DATA: 14,
  SHOP_REFRESH: 15,
  FISHING_START: 16,
  FISHING_STOP: 17,
  FISHING_REWARD: 18,
  PORT_UPGRADE: 19,
  PAY_BUSINESS: 20,
  ADD_CURRENCY: 21,
  PAY_SHOPBUY_NUM: 22
};

function ensureNavigationState(saved) {
  if (!saved.navigation || typeof saved.navigation !== 'object') {
    saved.navigation = {};
  }
  const nav = saved.navigation;

  if (typeof nav.strength !== 'number' || nav.strength <= 0) {
    nav.strength = 100; // 100/100 energia padrão
  }
  if (typeof nav.currency !== 'number') {
    nav.currency = 50000; // Moeda de navegação
  }
  nav.dayBuyShopNum = Number(nav.dayBuyShopNum) || 0;
  nav.dayPayShopBuyNum = Number(nav.dayPayShopBuyNum) || 0;
  nav.dayBuyStrengthNum = Number(nav.dayBuyStrengthNum) || 0;
  nav.shopRefreshCD = Number(nav.shopRefreshCD) || 0;
  nav.inviteNum = Number(nav.inviteNum) || 0;
  nav.assistNum = Number(nav.assistNum) || 0;
  nav.fishingStartTime = nav.fishingStartTime || '';

  // Frota padrão de navios (Barcos 1..5)
  if (!nav.boats || typeof nav.boats !== 'object') {
    nav.boats = {};
  }
  for (let b = 1; b <= 5; b++) {
    const sid = String(b);
    if (!nav.boats[sid]) {
      nav.boats[sid] = {
        boatId: sid,
        grades: 1,
        state: 1, // 1: IDLE / Disponível para despacho
        upgradeCd: 0
      };
    }
  }

  // Portos padrão (1..6)
  if (!nav.ports || typeof nav.ports !== 'object') {
    nav.ports = {};
  }
  const defaultTasks = [
    [ { taskId: 1, selectedTask: false, taskNum: 1 }, { taskId: 2, selectedTask: false, taskNum: 1 } ],
    [ { taskId: 3, selectedTask: false, taskNum: 1 }, { taskId: 4, selectedTask: false, taskNum: 1 } ],
    [ { taskId: 5, selectedTask: false, taskNum: 1 }, { taskId: 6, selectedTask: false, taskNum: 1 } ],
    [ { taskId: 7, selectedTask: false, taskNum: 1 } ],
    [ { taskId: 8, selectedTask: false, taskNum: 1 } ],
    [ { taskId: 9, selectedTask: false, taskNum: 1 } ]
  ];

  for (let p = 1; p <= 6; p++) {
    const pid = String(p);
    if (!nav.ports[pid]) {
      nav.ports[pid] = {
        portId: pid,
        index: p,
        grades: 1,
        shippingBoatId: '',
        payBusinessNum: 0,
        taskCd: 0,
        tasks: defaultTasks[p - 1] || [ { taskId: 1, selectedTask: false, taskNum: 1 } ]
      };
    }
  }

  // Itens da Loja de Navegação
  if (!Array.isArray(nav.buyData) || nav.buyData.length === 0) {
    nav.buyData = [
      { shopId: 1, index: 1, buy: false },
      { shopId: 2, index: 2, buy: false },
      { shopId: 3, index: 3, buy: false },
      { shopId: 4, index: 4, buy: false },
      { shopId: 5, index: 5, buy: false }
    ];
  }

  if (!Array.isArray(nav.fishRewardList)) {
    nav.fishRewardList = [];
  }

  return nav;
}

function formatNavigationData(saved) {
  const nav = ensureNavigationState(saved);

  const boatsArr = Object.values(nav.boats).map(b => ({
    boatId: String(b.boatId),
    grades: Number(b.grades) || 1,
    state: Number(b.state) || 1,
    upgradeCd: Number(b.upgradeCd) || 0
  }));

  const portsArr = Object.values(nav.ports).map(p => ({
    portId: String(p.portId),
    index: Number(p.index) || 1,
    grades: Number(p.grades) || 1,
    shippingBoatId: String(p.shippingBoatId || ''),
    payBusinessNum: Number(p.payBusinessNum) || 0,
    taskCd: Number(p.taskCd) || 0,
    tasks: (p.tasks || []).map(t => ({
      taskId: Number(t.taskId) || 1,
      selectedTask: Boolean(t.selectedTask),
      taskNum: Number(t.taskNum) || 1
    }))
  }));

  return {
    info: {
      strength: Number(nav.strength) || 100,
      currency: Number(nav.currency) || 50000,
      dayBuyShopNum: Number(nav.dayBuyShopNum) || 0,
      dayPayShopBuyNum: Number(nav.dayPayShopBuyNum) || 0,
      dayBuyStrengthNum: Number(nav.dayBuyStrengthNum) || 0,
      shopRefreshCD: Number(nav.shopRefreshCD) || 0,
      inviteNum: Number(nav.inviteNum) || 0,
      assistNum: Number(nav.assistNum) || 0,
      fishingStartTime: nav.fishingStartTime || ''
    },
    port: portsArr,
    boat: boatsArr,
    buyData: nav.buyData,
    fishingTipsList: nav.fishRewardList || []
  };
}

function handleOperate(saved, op, param1, param2, param3, param4) {
  const nav = ensureNavigationState(saved);
  let result = true;

  switch (Number(op)) {
    case NavigationOp.STREANTH_BUY: // 8: Compra / Recarga de Energia
      nav.strength = Math.min(100, (nav.strength || 0) + 50);
      nav.dayBuyStrengthNum = (nav.dayBuyStrengthNum || 0) + 1;
      break;

    case NavigationOp.PORT_ACCEPT_TASK: // 11: Despachar Navio
      const portId = String(param1 || '1');
      const boatId = String(param2 || '1');
      if (nav.ports[portId] && nav.boats[boatId]) {
        nav.strength = Math.max(0, (nav.strength || 10) - 10);
        nav.boats[boatId].state = 2; // Em trânsito / shipping
        nav.ports[portId].shippingBoatId = boatId;
        nav.ports[portId].taskCd = Date.now() + 180000; // 3 minutos
        nav.currency = (nav.currency || 0) + 500;
      }
      break;

    case NavigationOp.FISHING_START: // 16: Começar Pescaria
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      nav.fishingStartTime = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      break;

    case NavigationOp.FISHING_STOP: // 17: Parar Pescaria
    case NavigationOp.FISHING_REWARD: // 18: Recolher Recompensas de Pesca
      nav.fishingStartTime = '';
      nav.fishRewardList = [
        'Peixe Dourado Mágico obtido!',
        'Moedas de Navegação +500',
        'Pedra de Encantamento Marítima obtida!'
      ];
      nav.currency = (nav.currency || 0) + 1000;
      break;

    case NavigationOp.SHOP_BUY_DATA: // 14: Compra na Loja
      const shopIdx = Number(param1 || 1);
      const target = (nav.buyData || []).find(b => b.index === shopIdx);
      if (target) {
        target.buy = true;
        nav.currency = Math.max(0, (nav.currency || 0) - 800);
      }
      break;

    case NavigationOp.SHOP_REFRESH: // 15: Atualizar Loja
      for (const item of nav.buyData || []) {
        item.buy = false;
      }
      break;

    default:
      break;
  }

  return {
    op: Number(op),
    result,
    data: formatNavigationData(saved)
  };
}

module.exports = {
  NavigationOp,
  ensureNavigationState,
  formatNavigationData,
  handleOperate
};
