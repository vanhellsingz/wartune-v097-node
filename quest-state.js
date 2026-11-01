'use strict';

const fs = require('fs');
const path = require('path');
const configRoot = path.resolve(__dirname, '../res/release/config');

function loadCatalog(prefix) {
  try {
    const file = fs.readdirSync(configRoot).find(f => f.startsWith(prefix + '-'));
    if (!file) return [];
    const content = JSON.parse(fs.readFileSync(path.join(configRoot, file), 'utf8'));
    return content[prefix] || [];
  } catch (err) {
    return [];
  }
}

const inventory = require('./inventory-state');
const resource = require('./resource-state');

const questTemplates = new Map(loadCatalog('t_s_questtemplate').map(q => [Number(q.TemplateId), q]));
const questConditions = loadCatalog('t_s_questcondiction');
const questGoods = loadCatalog('t_s_questgood');
const pawnTemplates = new Map(loadCatalog('t_s_pawntemplate').map(p => [Number(p.TemplateId), p]));
const itemTemplates = new Map(loadCatalog('t_s_itemtemplate').map(i => [Number(i.TemplateId), i]));

function getConditions(templateId) {
  return questConditions.filter(c => Number(c.TemplateId) === Number(templateId));
}

function ensureQuestState(savedState) {
  if (typeof savedState === 'string') {
    try { savedState = JSON.parse(savedState); } catch (_) { savedState = {}; }
  }
  if (!savedState || typeof savedState !== 'object') savedState = {};
  if (!savedState.quests || typeof savedState.quests !== 'object') {
    savedState.quests = {
      active: {},
      completed: []
    };
  }
  if (!savedState.quests.active) savedState.quests.active = {};
  if (!Array.isArray(savedState.quests.completed)) savedState.quests.completed = [];
  return savedState;
}

function formatNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function hasAnyGemLevel2OrInlaid(savedState, targetTemplateId = 0) {
  const items = savedState.inventory?.items || [];
  for (const it of items) {
    if (!it) continue;
    const tId = Number(it.templateId);
    if (targetTemplateId > 0 && tId === targetTemplateId) return true;
    for (const h of [1, 2, 3, 4]) {
      const gemId = Number(it['join_' + h] || 0);
      if (targetTemplateId > 0 && gemId === targetTemplateId) return true;
      if (gemId > 0) {
        const gt = itemTemplates.get(gemId);
        if (!targetTemplateId && gt && Number(gt.TransformId || gt.Grades || 2) >= 2) return true;
      }
    }
    const tpl = itemTemplates.get(tId);
    if (tpl && (Number(tpl.MasterType) === 2 || String(tpl.TemplateName_pt || '').toLowerCase().includes('gema'))) {
      if (/nv\.?\s*[2-9]|lv\.?\s*[2-9]/i.test(String(tpl.TemplateName_pt || tpl.TemplateName_en || ''))) {
        return true;
      }
    }
  }
  return false;
}

function evaluateQuest(savedState, quest) {
  if (!quest) return false;
  const qId = Number(quest.templateId);
  const tpl = questTemplates.get(qId);
  const conditions = getConditions(qId);

  if (quest.isComplete) {
    if (conditions && conditions.length > 0) {
      for (let i = 0; i < conditions.length; i++) {
        const c = conditions[i];
        const condKey = `condition_${c.CondictionID || (i + 1)}`;
        const req = Math.max(1, Number(c.Para2 || 1));
        if (Number(quest[condKey] || 0) < req) {
          quest[condKey] = req;
        }
      }
    } else if (Number(quest.condition_1 || 0) < 1) {
      quest.condition_1 = 1;
    }
    return false;
  }
  let newlyCompleted = false;

  if (qId === 45) {
    const won = savedState.tutorial?.wonNodes || [];
    if (won.includes(1000205) || quest.condition_1 >= 1) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 51) {
    const buildings = savedState.castle?.buildings || {};
    const pref = Object.values(buildings).find(b => Number(b.sonType) === 901 || Number(b.buildingId) === 1);
    const grade = pref ? Number(pref.grade || 1) : 1;
    quest.condition_1 = grade;
    if (grade >= 2) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 52) {
    const pawns = savedState.army?.pawns || {};
    const spearmen = pawns[101] || pawns['101'] || pawns[1] || pawns['1'];
    const count = spearmen ? Number(spearmen.ownPawns || 0) : Number(quest.condition_1 || 0);
    quest.condition_1 = Math.max(Number(quest.condition_1 || 0), count);
    if (quest.condition_1 >= 200) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 70) {
    const wonNodes = savedState.campaigns?.wonNodes?.[1001] || [];
    const hasKilledWorg = wonNodes.some(n => [102102, 102103, 102105, 102106].includes(Number(n)));
    if (hasKilledWorg || savedState.campaigns?.completed?.includes(1001) || quest.condition_1 >= 1) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 80) {
    const wonNodes = savedState.campaigns?.wonNodes?.[1001] || [];
    if (wonNodes.includes(102109) || Number(quest.condition_1 || 0) >= 1) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 81) {
    const buildings = savedState.castle?.buildings || {};
    const quartel = Object.values(buildings).find(b => Number(b.sonType) === 402 || Number(b.buildingId) === 5);
    const grade = quartel ? Number(quartel.grade || 1) : 1;
    quest.condition_1 = grade;
    if (grade >= 5) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 82) {
    const buildings = savedState.castle?.buildings || {};
    const cabana = Object.values(buildings).find(b => Number(b.sonType) === 1201 || Number(b.buildingId) === 4);
    const grade = cabana ? Number(cabana.grade || 1) : 1;
    quest.condition_1 = grade;
    if (grade >= 5) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 101) {
    const lancer = savedState.army?.pawns?.[101];
    let level = 1;
    if (lancer && lancer.templateId) {
      const t = pawnTemplates.get(Number(lancer.templateId));
      if (t) level = Number(t.Level || 1);
    }
    quest.condition_1 = level;
    if (level >= 3) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 110) {
    const hunter = savedState.army?.pawns?.[102];
    const own = hunter ? Number(hunter.ownPawns || 0) : 0;
    quest.condition_1 = Math.min(own, 200);
    if (quest.condition_1 >= 200) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 120) {
    const isComp = Array.isArray(savedState.campaigns?.completed) && savedState.campaigns.completed.includes(1002);
    if (isComp) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 130) {
    const wonNodes = savedState.campaigns?.wonNodes?.[1002] || [];
    const isBossDefeated = wonNodes.includes(114206) || (Array.isArray(savedState.campaigns?.completed) && savedState.campaigns.completed.includes(1002));
    if (isBossDefeated) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 944) {
    const eq = savedState.inventory?.equipment || {};
    const items = savedState.inventory?.items || [];
    let hasLv10Equipped = false;
    for (const instId of Object.values(eq)) {
      const it = items.find(i => i.instanceId === instId);
      if (it && it.templateId) {
        const tmpl = itemTemplates.get(Number(it.templateId));
        if (tmpl && Number(tmpl.NeedGrades) >= 10) {
          hasLv10Equipped = true;
          break;
        }
      }
    }
    if (hasLv10Equipped || quest.condition_1 >= 1) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 121) {
    const items = savedState.inventory?.items || [];
    const hasStrengthen3 = items.some(i => Number(i.strengthenGrade || 0) >= 3);
    if (hasStrengthen3 || quest.condition_1 >= 1) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 160) {
    const pawns = Object.values(savedState.army?.pawns || {});
    const hasPositionedPawn = pawns.some(p => Number(p.fightPos || 0) > 0 || Number(p.sites || 0) > 0);
    if (hasPositionedPawn || quest.condition_1 >= 1) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 181) {
    const buildings = savedState.castle?.buildings || {};
    const pref = Object.values(buildings).find(b => Number(b.sonType) === 901 || Number(b.buildingId) === 1);
    const grade = pref ? Number(pref.grade || 1) : 1;
    quest.condition_1 = grade;
    if (grade >= 7) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 182) {
    const buildings = savedState.castle?.buildings || {};
    const cabana = Object.values(buildings).find(b => Number(b.sonType) === 1201 || Number(b.buildingId) === 4);
    const grade = cabana ? Number(cabana.grade || 1) : 1;
    quest.condition_1 = grade;
    if (grade >= 8) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 225) {
    const buildings = savedState.castle?.buildings || {};
    const quartel = Object.values(buildings).find(b => Number(b.sonType) === 402 || Number(b.buildingId) === 5);
    const grade = quartel ? Number(quartel.grade || 1) : 1;
    quest.condition_1 = grade;
    if (grade >= 7) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 265) {
    const buildings = savedState.castle?.buildings || {};
    const quartel = Object.values(buildings).find(b => Number(b.sonType) === 402 || Number(b.buildingId) === 5);
    const grade = quartel ? Number(quartel.grade || 1) : 1;
    quest.condition_1 = grade;
    if (grade >= 10) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 264) {
    const pawns = savedState.army?.pawns || {};
    const spearmen = pawns[101] || pawns['101'] || pawns[1] || pawns['1'];
    let grade = 1;
    if (spearmen) {
      if (spearmen.grade) grade = Number(spearmen.grade);
      else if (spearmen.templateId) {
        const t = pawnTemplates.get(Number(spearmen.templateId));
        if (t) grade = Number(t.Level || 1);
      }
    }
    quest.condition_1 = grade;
    if (grade >= 10) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 210) {
    const wonNodes = savedState.campaigns?.wonNodes?.[1003] || [];
    const isPheoraDefeated = wonNodes.includes(103205) || (Array.isArray(savedState.campaigns?.completed) && savedState.campaigns.completed.includes(1003));
    if (isPheoraDefeated || quest.condition_1 >= 1) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 190) {
    const wonNodes = savedState.campaigns?.wonNodes?.[1003] || [];
    const boneNodes = [103102, 103106, 103202, 103206, 103205];
    const count = wonNodes.filter(n => boneNodes.includes(Number(n))).length;
    quest.condition_1 = Math.max(Number(quest.condition_1 || 0), count);
    if (quest.condition_1 >= 5 || (Array.isArray(savedState.campaigns?.completed) && savedState.campaigns.completed.includes(1003))) {
      quest.condition_1 = 5;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 860 || qId === 263) {
    if (Number(quest.condition_1 || 0) >= 2) {
      quest.condition_1 = 2;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 312) {
    const buildings = savedState.castle?.buildings || {};
    const tesouraria = Object.values(buildings).find(b => Number(b.sonType) === 301 || Number(b.buildingId) === 3);
    const grade = tesouraria ? Number(tesouraria.grade || 1) : 1;
    quest.condition_1 = grade;
    if (grade >= 12) {
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 230) {
    const wonNodes = savedState.campaigns?.wonNodes?.[1004] || [];
    const isIblisDefeated = wonNodes.includes(106109) || (Array.isArray(savedState.campaigns?.completed) && savedState.campaigns.completed.includes(1004));
    if (isIblisDefeated || quest.condition_1 >= 1) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }
  else if (qId === 240) {
    const isComp = Array.isArray(savedState.campaigns?.completed) && savedState.campaigns.completed.includes(1004);
    if (isComp) {
      quest.condition_1 = 4;
      quest.condition_2 = 3;
      quest.condition_3 = 2;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    } else {
      const wonNodes = savedState.campaigns?.wonNodes?.[1004] || [];
      let c1 = 0, c2 = 0, c3 = 0;
      if (wonNodes.includes(106103)) { c1 += 2; c2 += 1; }
      if (wonNodes.includes(106104)) { c2 += 2; c3 += 1; }
      if (wonNodes.includes(106107)) { c1 += 2; c2 += 1; }
      quest.condition_1 = Math.max(Number(quest.condition_1 || 0), Math.min(4, c1));
      quest.condition_2 = Math.max(Number(quest.condition_2 || 0), Math.min(3, c2));
      quest.condition_3 = Math.max(Number(quest.condition_3 || 0), Math.min(2, c3));
      if (quest.condition_1 >= 4 && quest.condition_2 >= 3 && quest.condition_3 >= 2) {
        quest.isComplete = true;
        quest.completedDate = formatNow();
        newlyCompleted = true;
      }
    }
  }
  else if (qId === 250) {
    const isComp = Array.isArray(savedState.campaigns?.completed) && savedState.campaigns.completed.includes(1005);
    if (isComp || quest.condition_1 >= 1) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }

  // Avaliação genérica por t_s_questcondiction
  if (!quest.isComplete) {
    const questTitle = String(tpl?.Title_pt || tpl?.Title_en || '');
    if (conditions.length > 0) {
      let allConditionsMet = true;

      for (let i = 0; i < conditions.length; i++) {
        const c = conditions[i];
        const condKey = `condition_${c.CondictionID || (i + 1)}`;
        const cType = Number(c.CondictionType);
        const p1 = Number(c.Para1 || 0);
        const p2 = Math.max(1, Number(c.Para2 || 1));
        const condTitle = String(c.CondictionTitle_pt || c.CondictionTitle_en || '');
        let isMet = false;

        if (cType === 2) {
          const buildings = savedState.castle?.buildings || {};
          const b = Object.values(buildings).find(build => Number(build.sonType) === p1 || Number(build.buildingId) === p1);
          const grade = b ? Number(b.grade || 1) : 1;
          quest[condKey] = grade;
          if (grade >= p2) isMet = true;
        }
        else if (cType === 3) {
          const pawns = savedState.army?.pawns || {};
          const pSon = p1 === 1 ? 101 : (p1 === 2 ? 102 : (p1 === 3 ? 103 : p1));
          const p = pawns[pSon] || pawns[String(pSon)];
          const count = p ? Number(p.ownPawns || 0) : Number(quest[condKey] || 0);
          quest[condKey] = Math.max(Number(quest[condKey] || 0), count);
          if (quest[condKey] >= p2) isMet = true;
        }
        else if (cType === 4) {
          const eq = savedState.inventory?.equipment || {};
          const items = savedState.inventory?.items || [];
          let count = 0;
          for (const instId of Object.values(eq)) {
            const it = items.find(item => item.instanceId === instId);
            if (it && it.templateId) {
              const tmpl = itemTemplates.get(Number(it.templateId));
              if (tmpl && Number(tmpl.NeedGrades || 0) >= p1) count++;
            }
          }
          quest[condKey] = count;
          if (count >= p2) isMet = true;
        }
        else if (cType === 10) {
          const pawns = savedState.army?.pawns || {};
          const pSon = p1 === 1 ? 101 : (p1 === 2 ? 102 : (p1 === 3 ? 103 : p1));
          const p = pawns[pSon] || pawns[String(pSon)];
          let lvl = 1;
          if (p && p.templateId) {
            const t = pawnTemplates.get(Number(p.templateId));
            if (t) lvl = Number(t.Level || 1);
          }
          quest[condKey] = lvl;
          if (lvl >= p2) isMet = true;
        }
        else if (cType === 14) {
          const completedCamps = savedState.campaigns?.completed || [];
          if (completedCamps.includes(p1) || Number(quest[condKey] || 0) >= p2) {
            quest[condKey] = p2;
            isMet = true;
          }
        }
        else if (cType === 17) {
          const items = savedState.inventory?.items || [];
          const hasEnchant = items.some(it => Number(it.strengthenGrade || 0) >= (p1 || 1));
          if (hasEnchant || Number(quest[condKey] || 0) >= p2) {
            quest[condKey] = p2;
            isMet = true;
          }
        }
        else if (cType === 18) {
          const items = savedState.inventory?.items || [];
          const hasGem = items.some(it =>
            Number(it.join_1) > 0 || Number(it.join_2) > 0 || Number(it.join_3) > 0 || Number(it.join_4) > 0 ||
            (Array.isArray(it.holes) && it.holes.some(h => Number(h) > 0))
          );
          if (hasGem || Number(quest[condKey] || 0) >= p2) {
            quest[condKey] = p2;
            isMet = true;
          }
        }
        else if (
          cType === 19 || cType === 16 || cType === 20 || cType === 5 ||
          /sintetiz|compor|compose|gema|gem/i.test(condTitle) ||
          /síntese de gemas|sintese de gemas/i.test(questTitle)
        ) {
          if (hasAnyGemLevel2OrInlaid(savedState, p1) || Number(quest[condKey] || 0) >= p2) {
            quest[condKey] = p2;
            isMet = true;
          } else {
            // Garante conclusão para missões de síntese de gemas já realizadas
            quest[condKey] = p2;
            isMet = true;
          }
        }
        else if (
          cType === 1 ||
          /falar com|converse com|talk to|fazer um amigo|add a friend|socializ|bênção|sacerdote|guarda|apresentação/i.test(condTitle) ||
          /bênçãos de deus|carta de apresentação|socializando/i.test(questTitle)
        ) {
          quest[condKey] = p2;
          isMet = true;
        }
        else if (cType === 34) {
          const pawns = Object.values(savedState.army?.pawns || {});
          const hasPos = pawns.some(p => Number(p.fightPos || 0) > 0 || Number(p.sites || 0) > 0);
          if (hasPos || Number(quest[condKey] || 0) >= p2) {
            quest[condKey] = p2;
            isMet = true;
          }
        }
        else if (cType === 58) {
          const jewelLvl = Number(savedState.jewelGrades || 0);
          quest[condKey] = jewelLvl;
          if (jewelLvl >= p2) isMet = true;
        }
        else if (cType === 71 || cType === 203) {
          const mountLvl = Number(savedState.mounts?.levelMax || 1);
          quest[condKey] = mountLvl;
          if (mountLvl >= p2) isMet = true;
        }
        else if (condTitle.includes('Alcance Nv.')) {
          const targetLvl = Number(condTitle.replace(/[^0-9]/g, '')) || p1 || p2;
          const currentLvl = Number(savedState.progression?.grade || savedState.grade || 1);
          quest[condKey] = currentLvl;
          if (currentLvl >= targetLvl) isMet = true;
        }
        else if (cType === 25 || cType === 26) {
          if (Number(quest[condKey] || 0) >= p2) isMet = true;
        }
        else {
          if (Number(quest[condKey] || 0) >= p2) isMet = true;
        }

        if (!isMet) allConditionsMet = false;
      }

      if (allConditionsMet) {
        quest.isComplete = true;
        quest.completedDate = formatNow();
        newlyCompleted = true;
      }
    } else {
      quest.condition_1 = Math.max(1, Number(quest.condition_1 || 0));
      quest.isComplete = true;
      quest.completedDate = formatNow();
      newlyCompleted = true;
    }
  }

  return newlyCompleted;
}

function syncAutoQuests(savedState, playerGrade = 5) {
  const state = ensureQuestState(savedState);
  const grade = Number(playerGrade || savedState.grade || 5);
  const active = state.quests.active;
  const comp = state.quests.completed;
  const compSet = new Set((comp || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0));

  for (const qIdStr of Object.keys(active)) {
    const qId = Number(qIdStr);
    if (compSet.has(qId)) {
      delete active[qIdStr];
    }
  }

  const autoChain = [
    { id: 45, pre: 0, minLvl: 1 },
    { id: 51, pre: 45, minLvl: 5 },
    { id: 52, pre: 51, minLvl: 5 },
    { id: 70, pre: 52, minLvl: 5 },
    { id: 80, pre: 70, minLvl: 5 },
    { id: 81, pre: 80, minLvl: 7 },
    { id: 82, pre: 81, minLvl: 7 },
    { id: 101, pre: 82, minLvl: 8 },
    { id: 120, pre: 101, minLvl: 8 },
    { id: 130, pre: 120, minLvl: 9 },
    { id: 944, pre: 130, minLvl: 10 },
    { id: 121, pre: 944, minLvl: 10 },
    { id: 160, pre: 121, minLvl: 10 },
    { id: 181, pre: 160, minLvl: 10 },
    { id: 182, pre: 181, minLvl: 10 },
    { id: 225, pre: 182, minLvl: 10 },
    { id: 265, pre: 225, minLvl: 11 },
    { id: 264, pre: 265, minLvl: 11 },
    { id: 210, pre: 264, minLvl: 11 },
    { id: 190, pre: 210, minLvl: 11 },
    { id: 312, pre: 190, minLvl: 12 },
    { id: 230, pre: 312, minLvl: 12 },
    { id: 240, pre: 230, minLvl: 13 },
    { id: 250, pre: 240, minLvl: 14 }
  ];

  let canonicalMainStep = null;
  for (const step of autoChain) {
    if (!compSet.has(step.id)) {
      const preOk = (step.pre === 0) || compSet.has(step.pre);
      if (preOk) {
        canonicalMainStep = step;
      }
      break;
    }
  }

  let anyNew = false;

  if (canonicalMainStep && !active[canonicalMainStep.id]) {
    const newQuest = {
      templateId: canonicalMainStep.id,
      isComplete: false,
      condition_1: 0,
      condition_2: 0,
      condition_3: 0,
      condition_4: 0,
      isSelect: false,
      addDate: formatNow(),
      completedDate: '2000-01-01 00:00:00'
    };
    evaluateQuest(state, newQuest);
    active[canonicalMainStep.id] = newQuest;
    anyNew = true;
  }

  // Se já concluiu toda a cadeia inicial até a 250, desbloqueia automaticamente missões seguintes pelo PreQuestId do catálogo
  if (!canonicalMainStep && compSet.has(250)) {
    for (const tpl of questTemplates.values()) {
      const qId = Number(tpl.TemplateId);
      if (compSet.has(qId) || active[qId]) continue;
      const minLvl = Number(tpl.NeedMinLevel || 1);
      if (grade < minLvl) continue;
      const preIds = String(tpl.PreQuestId || '').split(',').map(s => Number(s.trim())).filter(n => n > 0);
      if (preIds.length > 0 && preIds.every(pid => compSet.has(pid))) {
        if (Boolean(tpl.IsAutoAccept) || Number(tpl.TemplateType) === 0) {
          const nextQ = {
            templateId: qId,
            isComplete: false,
            condition_1: 0,
            condition_2: 0,
            condition_3: 0,
            condition_4: 0,
            isSelect: false,
            addDate: formatNow(),
            completedDate: '2000-01-01 00:00:00'
          };
          evaluateQuest(state, nextQ);
          active[qId] = nextQ;
          anyNew = true;
        }
      }
    }
  }

  for (const q of Object.values(active)) {
    evaluateQuest(state, q);
  }

  return anyNew;
}

function acceptQuest(savedState, templateId, playerGrade = 5) {
  const state = ensureQuestState(savedState);
  const tId = Number(templateId);
  const template = questTemplates.get(tId);
  if (!template) {
    throw new Error(`Template de missao ${tId} nao existe no catalogo`);
  }

  const compSet = new Set((state.quests.completed || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0));

  if (compSet.has(tId)) {
    return { state, quest: null, changed: false, alreadyCompleted: true };
  }

  if (state.quests.active[tId]) {
    evaluateQuest(state, state.quests.active[tId]);
    return { state, quest: state.quests.active[tId], changed: true, alreadyActive: true };
  }

  const newQuest = {
    templateId: tId,
    isComplete: false,
    condition_1: 0,
    condition_2: 0,
    condition_3: 0,
    condition_4: 0,
    isSelect: false,
    addDate: formatNow(),
    completedDate: '2000-01-01 00:00:00'
  };

  evaluateQuest(state, newQuest);
  state.quests.active[tId] = newQuest;
  syncAutoQuests(state, playerGrade);
  return { state, quest: newQuest, changed: true };
}

function onItemCompose(savedState, composedTemplateId, composeNum = 1, playerGrade = 5) {
  const state = ensureQuestState(savedState);
  const updatedQuests = [];
  let changed = false;

  for (const quest of Object.values(state.quests.active)) {
    const qId = Number(quest.templateId);
    const tpl = questTemplates.get(qId);
    const questTitle = String(tpl?.Title_pt || tpl?.Title_en || '');
    const conditions = getConditions(qId);
    let qChanged = false;

    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i];
      const condKey = `condition_${c.CondictionID || (i + 1)}`;
      const cType = Number(c.CondictionType);
      const p1 = Number(c.Para1 || 0);
      const p2 = Math.max(1, Number(c.Para2 || 1));
      const condTitle = String(c.CondictionTitle_pt || c.CondictionTitle_en || '');

      if (
        p1 === Number(composedTemplateId) ||
        cType === 19 || cType === 16 || cType === 20 || cType === 5 ||
        /sintetiz|compor|compose|gema|gem/i.test(condTitle) ||
        /síntese de gemas|sintese de gemas/i.test(questTitle)
      ) {
        quest[condKey] = Math.min(p2, Number(quest[condKey] || 0) + Number(composeNum || 1));
        qChanged = true;
      }
    }

    if (evaluateQuest(state, quest) || qChanged) {
      updatedQuests.push(formatQuestProtocol(quest));
      changed = true;
    }
  }

  return { state, updatedQuests, changed };
}

function onNpcInteract(savedState, npcId, playerGrade = 5) {
  const state = ensureQuestState(savedState);
  const updatedQuests = [];
  let changed = false;

  for (const quest of Object.values(state.quests.active)) {
    if (evaluateQuest(state, quest) || quest.isComplete) {
      updatedQuests.push(formatQuestProtocol(quest));
      changed = true;
    }
  }

  return { state, updatedQuests, changed };
}

function onCombatVictory(savedState, nodeId, playerGrade = 5, context = {}) {
  const state = ensureQuestState(savedState);
  const nId = Number(nodeId);
  const updatedQuests = [];
  let changed = false;

  syncAutoQuests(state, playerGrade);

  const defeatedMonsterIds = Array.isArray(context.defeatedMonsterIds)
    ? context.defeatedMonsterIds.map(Number)
    : [];
  const mapId = Number(context.mapId || 0);
  const campaignId = Number(context.campaignId || 0);

  for (const qIdStr of Object.keys(state.quests.active)) {
    const qId = Number(qIdStr);
    const quest = state.quests.active[qIdStr];
    if (quest.isComplete) continue;

    const conditions = getConditions(qId);
    let questChanged = false;

    if (qId === 45 && nId === 1000205) {
      quest.condition_1 = 1;
      questChanged = true;
    }
    else if (qId === 80 && (nId === 102109 || defeatedMonsterIds.includes(1011))) {
      quest.condition_1 = 1;
      questChanged = true;
    }

    if (conditions && conditions.length > 0) {
      for (let i = 0; i < conditions.length; i++) {
        const c = conditions[i];
        const condKey = `condition_${c.CondictionID || (i + 1)}`;
        const cType = Number(c.CondictionType);
        const p1Raw = String(c.Para1 || '');
        const targetIds = p1Raw.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
        const requiredCount = Number(c.Para2 || 1);
        const condMap = Number(c.Para3 || 0);

        const mapMatch = (condMap === 0) || (mapId === condMap) || (campaignId === condMap);

        if (cType === 25 && mapMatch) {
          let matchedKills = 0;
          if (defeatedMonsterIds.length > 0) {
            for (const dId of defeatedMonsterIds) {
              if (targetIds.includes(dId) || (targetIds.length === 1 && targetIds[0] === 0)) {
                matchedKills++;
              }
            }
          } else if (targetIds.includes(nId)) {
            matchedKills = 1;
          }
          if (matchedKills > 0) {
            const currentVal = Number(quest[condKey] || 0);
            const newVal = Math.min(requiredCount, currentVal + matchedKills);
            if (newVal !== currentVal) {
              quest[condKey] = newVal;
              questChanged = true;
            }
          }
        }
        else if (cType === 26 && mapMatch) {
          if (defeatedMonsterIds.some(dId => targetIds.includes(dId)) || targetIds.includes(nId)) {
            const currentVal = Number(quest[condKey] || 0);
            if (currentVal < requiredCount) {
              quest[condKey] = requiredCount;
              questChanged = true;
            }
          }
        }
      }
    }

    if (evaluateQuest(state, quest) || questChanged) {
      updatedQuests.push({ ...quest });
      changed = true;
    }
  }

  return { state, updatedQuests, changed };
}

function onBuildingUpgrade(savedState, buildingType, newGrade, playerGrade = 5) {
  const state = ensureQuestState(savedState);
  const updatedQuests = [];
  let changed = false;

  syncAutoQuests(state, playerGrade);

  for (const qId of Object.keys(state.quests.active)) {
    const quest = state.quests.active[qId];
    const before = quest.isComplete;
    const beforeC1 = quest.condition_1;
    evaluateQuest(state, quest);
    if (quest.isComplete !== before || quest.condition_1 !== beforeC1) {
      updatedQuests.push({ ...quest });
      changed = true;
    }
  }

  return { state, updatedQuests, changed };
}

function formatQuestProtocol(q) {
  return {
    templateId: Number(q.templateId),
    isComplete: Boolean(q.isComplete),
    condition_1: Number(q.condition_1 || 0),
    condition_2: Number(q.condition_2 || 0),
    condition_3: Number(q.condition_3 || 0),
    condition_4: Number(q.condition_4 || 0),
    isSelect: Boolean(q.isSelect || false),
    addDate: q.addDate || formatNow(),
    completedDate: q.completedDate || '2000-01-01 00:00:00'
  };
}

function onRecruitPawn(savedState, pawnType, count, totalOwn, playerGrade = 5) {
  const state = ensureQuestState(savedState);
  syncAutoQuests(state, playerGrade);
  const pType = Number(pawnType);
  const updatedQuests = [];
  let changed = false;

  for (const qId of Object.keys(state.quests.active)) {
    const quest = state.quests.active[qId];

    if (Number(qId) === 52 && (pType === 101 || pType === 1)) {
      const currentVal = Number(quest.condition_1) || 0;
      const targetVal = Math.min(Math.max(currentVal + Number(count), Number(totalOwn) || 0), 200);
      quest.condition_1 = targetVal;
      if (quest.condition_1 >= 200) {
        quest.isComplete = true;
        quest.completedDate = formatNow();
      }
      updatedQuests.push(formatQuestProtocol(quest));
      changed = true;
    }
    else if (Number(qId) === 110 && (pType === 102 || pType === 2)) {
      const currentVal = Number(quest.condition_1) || 0;
      const targetVal = Math.min(Math.max(currentVal + Number(count), Number(totalOwn) || 0), 200);
      quest.condition_1 = targetVal;
      if (quest.condition_1 >= 200) {
        quest.isComplete = true;
        quest.completedDate = formatNow();
      }
      updatedQuests.push(formatQuestProtocol(quest));
      changed = true;
    }
  }

  syncAutoQuests(state, playerGrade);

  return { state, updatedQuests, changed };
}

function onPositionPawn(savedState, playerGrade = 5) {
  const state = ensureQuestState(savedState);
  syncAutoQuests(state, playerGrade);
  const updatedQuests = [];
  let changed = false;

  for (const qId of Object.keys(state.quests.active)) {
    const quest = state.quests.active[qId];
    if (Number(qId) === 160) {
      quest.condition_1 = 1;
      quest.isComplete = true;
      quest.completedDate = formatNow();
      updatedQuests.push(formatQuestProtocol(quest));
      changed = true;
    }
  }

  syncAutoQuests(state, playerGrade);
  return { state, updatedQuests, changed };
}

function onPawnUpgrade(savedState, pawnType, newLevel, newTemplateId, playerGrade = 5) {
  const state = ensureQuestState(savedState);
  syncAutoQuests(state, playerGrade);
  const pType = Number(pawnType);
  const level = Number(newLevel);
  const updatedQuests = [];
  let changed = false;

  for (const qId of Object.keys(state.quests.active)) {
    const quest = state.quests.active[qId];
    if (Number(qId) === 101 && (pType === 101 || pType === 1)) {
      quest.condition_1 = level;
      if (level >= 3) {
        quest.isComplete = true;
        quest.completedDate = formatNow();
      }
      updatedQuests.push(formatQuestProtocol(quest));
      changed = true;
    }
    else if (Number(qId) === 264 && (pType === 101 || pType === 1)) {
      quest.condition_1 = level;
      if (level >= 10) {
        quest.isComplete = true;
        quest.completedDate = formatNow();
      }
      updatedQuests.push(formatQuestProtocol(quest));
      changed = true;
    }
  }

  syncAutoQuests(state, playerGrade);

  return { state, updatedQuests, changed };
}

function onCampaignVictory(savedState, campaignId, playerGrade = 5) {
  const state = ensureQuestState(savedState);
  const cId = Number(campaignId);
  const updatedQuests = [];
  let changed = false;

  for (const qIdStr of Object.keys(state.quests.active)) {
    const qId = Number(qIdStr);
    const quest = state.quests.active[qIdStr];
    const conditions = getConditions(qId);
    let questChanged = false;

    if (conditions && conditions.length > 0) {
      for (let i = 0; i < conditions.length; i++) {
        const c = conditions[i];
        const condKey = `condition_${c.CondictionID || (i + 1)}`;
        const cType = Number(c.CondictionType);
        const requiredCount = Number(c.Para2 || 1);

        if (cType === 14 && Number(c.Para1) === cId) {
          const currentVal = Number(quest[condKey] || 0);
          if (currentVal < requiredCount) {
            quest[condKey] = requiredCount;
            questChanged = true;
          }
        }
      }
    }

    if (evaluateQuest(state, quest) || questChanged) {
      updatedQuests.push({ ...quest });
      changed = true;
    }
  }

  syncAutoQuests(state, playerGrade);

  return { state, updatedQuests, changed };
}

function onHarvestCrop(savedState, isOwnFarm = true, harvestCount = 1) {
  const state = ensureQuestState(savedState);
  const updatedQuests = [];
  let changed = false;

  for (const quest of Object.values(state.quests.active)) {
    const qId = Number(quest.templateId);
    if ((qId === 860 || qId === 263) && isOwnFarm) {
      quest.condition_1 = Math.min(2, Number(quest.condition_1 || 0) + Number(harvestCount || 1));
      if (quest.condition_1 >= 2) {
        quest.isComplete = true;
        quest.completedDate = formatNow();
      }
      updatedQuests.push({ ...quest });
      changed = true;
    }
  }

  return { state, updatedQuests, changed };
}

function finishQuest(savedState, templateId, playerGrade = 5, playerJob = 0) {
  const state = ensureQuestState(savedState);
  const tId = Number(templateId);
  const template = questTemplates.get(tId);
  if (!template) {
    throw new Error(`Template de missao ${tId} nao encontrado`);
  }

  if (state.quests.completed.includes(tId)) {
    const currentGrade = Number(playerGrade || 5);
    return {
      success: true,
      state,
      rewards: {
        gold: 0,
        xp: 0,
        totalGold: state.wallet?.gold || 0,
        totalXp: state.progression?.totalXp || 0,
        addedItems: [],
        newGrade: currentGrade,
        leveledUp: false
      },
      changed: false
    };
  }

  if (!state.quests.active[tId]) {
    state.quests.active[tId] = {
      templateId: tId,
      isComplete: false,
      condition_1: 0,
      condition_2: 0,
      condition_3: 0,
      condition_4: 0,
      isSelect: false,
      addDate: formatNow(),
      completedDate: '2000-01-01 00:00:00'
    };
  }

  const quest = state.quests.active[tId];
  evaluateQuest(state, quest);

  // Quando o cliente envia 5014 (C_QUEST_FINISH), garante o preenchimento das condições (missões de diálogo com NPC, UI, etc.)
  if (!quest.isComplete) {
    const conditions = getConditions(tId);
    if (conditions && conditions.length > 0) {
      for (let i = 0; i < conditions.length; i++) {
        const c = conditions[i];
        const condKey = `condition_${c.CondictionID || (i + 1)}`;
        quest[condKey] = Math.max(1, Number(c.Para2 || 1));
      }
    } else {
      quest.condition_1 = 1;
    }
    quest.isComplete = true;
    quest.completedDate = formatNow();
  }

  delete state.quests.active[tId];
  state.quests.completed.push(tId);

  const rewardGold = Number(template.RewardGold || 0);
  const rewardXp = Number(template.RewardPlayGP || 0);

  if (!state.wallet) state.wallet = { gold: 0, balens: 0, boundBalens: 0 };
  state.wallet.gold = (Number(state.wallet.gold) || 0) + rewardGold;

  if (!state.progression) state.progression = { totalXp: 0 };
  state.progression.totalXp = (Number(state.progression.totalXp) || 0) + rewardXp;

  const addedItems = [];
  const goods = questGoods.filter(g => Number(g.TemplateId) === tId);
  for (const good of goods) {
    const toJob = Number(good.ToJob || 0);
    if (toJob === 0 || toJob === Number(playerJob)) {
      try {
        const addRes = inventory.addItem(state, Number(good.RewardItemID), Number(good.RewardItemCount || 1));
        if (addRes && addRes.item) addedItems.push(addRes.item);
      } catch (err) {
        console.error(`[QUEST GOODS ERROR] Falha ao adicionar item ${good.RewardItemID}:`, err.message);
      }
    }
  }

  const currentGrade = Number(playerGrade || 5);
  const newGrade = resource.calcGradeFromXp(state.progression.totalXp, currentGrade);
  const atLevel = resource.totalAtLevel(newGrade);
  state.progression.currentXp = Math.max(0, state.progression.totalXp - atLevel);

  // Libera próximas missões que tinham esta missão como PreQuestId
  const compSet = new Set(state.quests.completed.map(Number));
  for (const nextTpl of questTemplates.values()) {
    const nextId = Number(nextTpl.TemplateId);
    if (compSet.has(nextId) || state.quests.active[nextId]) continue;
    const preIds = String(nextTpl.PreQuestId || '').split(',').map(s => Number(s.trim())).filter(n => n > 0);
    if (preIds.includes(tId) && preIds.every(pid => compSet.has(pid)) && Number(nextTpl.NeedMinLevel || 1) <= newGrade) {
      const nextQuest = {
        templateId: nextId,
        isComplete: false,
        condition_1: 0,
        condition_2: 0,
        condition_3: 0,
        condition_4: 0,
        isSelect: false,
        addDate: formatNow(),
        completedDate: '2000-01-01 00:00:00'
      };
      evaluateQuest(state, nextQuest);
      state.quests.active[nextId] = nextQuest;
    }
  }

  syncAutoQuests(state, newGrade);

  return {
    success: true,
    state,
    rewards: {
      gold: rewardGold,
      xp: rewardXp,
      totalGold: state.wallet.gold,
      totalXp: state.progression.totalXp,
      addedItems,
      newGrade,
      leveledUp: newGrade > currentGrade
    },
    changed: true
  };
}

function getActiveQuestProtocolList(savedState) {
  const state = ensureQuestState(savedState);
  for (const q of Object.values(state.quests.active)) {
    evaluateQuest(state, q);
  }
  return Object.values(state.quests.active).map(q => formatQuestProtocol(q));
}

function completedQuestLog(savedState) {
  const state = typeof savedState === 'string' ? JSON.parse(savedState) : (savedState || {});
  const completed = state.quests?.completed || [];
  if (!Array.isArray(completed)) throw Error('Historico de missoes invalido');
  let maxId = 0;
  for (const id of completed) {
    if (!Number.isSafeInteger(id) || id < 1 || !questTemplates.has(id) || id > 524280)
      throw Error('Missao concluida fora do catalogo/protocolo');
    maxId = Math.max(maxId, id);
  }
  const bits = Buffer.alloc(Math.ceil(maxId / 8));
  for (const id of completed) bits[Math.floor((id - 1) / 8)] |= 1 << ((id - 1) % 8);
  return bits;
}

function formatQuestUpdatedProtocol(savedState, quest) {
  const states = completedQuestLog(savedState);
  const questList = Array.isArray(quest)
    ? quest.map(q => (q && q.templateId !== undefined ? formatQuestProtocol(q) : q))
    : [quest && quest.templateId !== undefined ? formatQuestProtocol(q) : quest];
  return { quest: questList, statesLength: states.length, states };
}

module.exports = {
  getTemplate: id => questTemplates.get(Number(id)),
  getConditions,
  ensureQuestState,
  evaluateQuest,
  syncAutoQuests,
  acceptQuest,
  formatQuestProtocol,
  getActiveQuestProtocolList,
  completedQuestLog,
  formatQuestUpdatedProtocol,
  onCombatVictory,
  onBuildingUpgrade,
  onRecruitPawn,
  onPositionPawn,
  onPawnUpgrade,
  onCampaignVictory,
  onHarvestCrop,
  onItemCompose,
  onNpcInteract,
  finishQuest,
  getAvailableQuests: state => []
};