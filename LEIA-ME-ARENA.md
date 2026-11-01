# VanHellsingZ — Briefing Operacional para IAs

> **Cole ESTE ARQUIVO INTEIRO na conversa com qualquer IA antes de pedir qualquer tarefa.**
> Ele contém toda a inteligência necessária para trabalhar no projeto sem perguntar nada.

---

## Repositório
```
https://github.com/vanhellsingz/wartune-v097-node
```

## Links do Cliente (Cloudflare Tunnel — pode estar offline)
```
Índice: https://surface-reading-lead-preparation.trycloudflare.com/indice-cliente.html
Manifesto JSON: https://surface-reading-lead-preparation.trycloudflare.com/manifesto-cliente.json
```

---

## Arquitetura do Servidor

| Item | Valor |
|---|---|
| Entry point | `iniciar.js` → `servidor_v08.js` |
| Linhas servidor_v08.js | 12.195 |
| Total de módulos | 77 arquivos .js |
| Total de linhas | 32.543 |
| Banco de dados | MySQL via mysql2 → database `wartune_ultra` |
| Porta cliente HTTP | 8088 |
| Porta API REST | 8905 |
| Porta WebSocket | 8906 (protocolo binário protobuf) |
| Engine do cliente | LayaAir (HTML5/WebGL) |
| Versão | 0.9.7-candidato |
| SO do servidor | Windows 10 22H2 |
| Node.js | 18+ |

---

## ⚠️ REGRA #1 — SISTEMA DE HASH (CRÍTICO)

**Todo arquivo do cliente tem um hash de 10 caracteres no nome.**

```
ERRADO: t_s_itemtemplate.json          ← NÃO EXISTE
CERTO:  t_s_itemtemplate-43b07d7a92.json  ← esse é o arquivo real
```

O servidor resolve assim (Node.js):
```javascript
const file = fs.readdirSync(configRoot).find(f => f.startsWith('t_s_itemtemplate-'));
```

**Em Java, o equivalente é:**
```java
Path file = Files.list(configDir)
    .filter(p -> p.getFileName().toString().startsWith("t_s_itemtemplate-"))
    .findFirst().orElse(null);
```

**NUNCA HARDCODE O HASH. SEMPRE BUSCA POR PREFIXO.**

---

## Catálogos de Dados

### Onde ficam
```
Servidor carrega de: ../res/release/config/   (271 JSONs — USAR ESSES)
Cliente beta tem:    res/beta/config/          (138 JSONs — NÃO USAR, hashes diferentes!)
```

### Hashes hardcoded no servidor (todos batem com release)
```
t_s_itemtemplate-43b07d7a92.json     (templates de itens — 122k+ itens)
t_s_skilltemplate-cd26b32bf4.json    (templates de skills)
t_s_dropitem-358e5cbc6e.json         (tabelas de drop)
t_s_compose-9b5ac04f09.json          (receitas de composição)
t_s_outcityshop-1fbc231827.json      (loja da cidade exterior)
t_s_upgradetemplate-f3c7098547.json  (upgrade de fashion/talento)
```

### Catálogos carregados dinamicamente (via loadCatalog)
```
t_s_campaigndata     (dados de campanha — battle-engine.js)
t_s_pawntemplate     (templates de mobs — battle-engine.js)
t_s_herotemplate     (templates de heróis — battle-engine.js)
t_s_questtemplate    (templates de quests — quest-state.js)
t_s_questcondiction  (condições de quest — quest-state.js)
t_s_questgood        (recompensas de quest — quest-state.js)
t_s_pettemplate      (templates de pets — battle-engine.js)
t_s_kingtowerboss    (boss da torre — battle-engine.js)
t_s_skillbuffertemplate (buffs de skill — battle-engine.js)
t_s_starsublimation  (sublimação astral — astral-state.js)
t_s_startemplate     (template astral — astral-state.js)
t_s_skillpropertytemplate (propriedades de skill — attribute-calculator.js)
t_s_mounttemplate    (templates de montaria — attribute-calculator.js)
```

---

## Os 68 Módulos que servidor_v08.js importa (require)

```
db.js                        character-repository.js       map-config.js
player-state.js              inventory-state.js            sylph-equipment-state.js
hero-state.js                original-protobuf.js          session-state.js
movement-state.js            resource-service.js           resource-state.js
system-open-state.js         job-transfer-state.js         progression-rules.js
tutorial-state.js            city-state.js                 sylph-atoll-state.js
atoll-encounters.js          atoll-patrol.js               item-consumable-state.js
campaign-movement-state.js   packet-recorder.js            quest-state.js
castle-state.js              barracks-state.js             shop-state.js
guild-skills.js              shop-p0-catalog.js            shop-db-live.js
shop-catalog-live.js         skills-state.js               campaign-state.js
mpd-room-state.js            battle-engine.js              item-repository.js
attribute-calculator.js      astral-state.js               stargazing-state.js
navigation-state.js          secondary-systems-state.js    wartune-sylph-skills.js
mount-state.js               uiplay-state.js               secondary-features-state.js
extended-subsystems-state.js outercity-state.js            guild-state.js
guard-system-state.js        canonical-config-repository.js combat-guardian-state.js
rare-weapon-state.js         item-effects-v3.js            avatar-frame-state.js
sylph-training-live.js       sylph-duplicate-resolve.js    sylph-promotion-state.js
sylph-xp-scroll.js           wartune-attribute-bonuses.js  wartune-combat-math.js
wartune-integrity-r7.js      wartune-battle-targets.js     rune-battle-state.js
socket-compat.js             hall-experience-state.js      sylph-awakening-state.js
```

---

## Top 20 Módulos por Tamanho (linhas)

| Arquivo | Linhas | Função |
|---|---|---|
| servidor_v08.js | 12.195 | Core — HTTP/WS, todos os opcodes |
| extended-subsystems-state.js | 2.285 | Fashion, tattoo, gemas, astrologia |
| battle-engine.js | 1.558 | Motor de batalha completo |
| quest-state.js | 1.253 | Sistema de quests |
| astral-state.js | 1.153 | Constelações |
| attribute-calculator.js | 981 | Pipeline 6 camadas stats (A→F) |
| campaign-state.js | 944 | Dungeons/campanhas |
| outercity-state.js | 671 | Cidade exterior |
| character-repository.js | 667 | CRUD de personagens |
| guild-state.js | 626 | Sistema de guilda |
| barracks-state.js | 593 | Quartel/tropas |
| secondary-features-state.js | 553 | Coleções, conquistas |
| guard-system-state.js | 537 | Sistema de guardião |
| stargazing-state.js | 469 | Contemplação de estrelas |
| castle-state.js | 445 | Castelo/construções |
| canonical-config-repository.js | 392 | Repositório de catálogos |
| shop-state.js | 333 | Loja |
| secondary-systems-state.js | 327 | Astrologia base, VIP |
| uiplay-state.js | 323 | Pets, formações visuais |
| inventory-state.js | 307 | Inventário |

---

## Fórmulas de Atributos (attribute-calculator.js)

```
PATK = base_attack + Power × 4
MATK = base_magicattack + Intellect × 4
PDEF = base_defence + Power × 1 + Agility × 4
MDEF = base_magicdefence + Intellect × 1 + Agility × 4
HP   = base_live + Physique × 20
Troops = Captain × 1

Potential Points por nível = (grade - 1) × 5

Job classes: 1=Warrior, 2=Archer, 3=Mage
```

---

## BUGS CONHECIDOS (verificados no código real)

### BUG-001 CRITICAL — Migração Java não pode hardcodar hashes
Toda referência a catálogo no Java DEVE usar busca por prefixo, nunca o nome completo com hash.

### BUG-003 HIGH — 271 catálogos no cliente, servidor só usa ~36
O cliente tem 271 configs em res/release/config/. O servidor carrega ~36. Os 235 restantes (conquistas, gacha, season pass, guild maze, casamento, PvP rankeado, etc.) não têm dados — essas features estão quebradas.

### BUG-004 CRITICAL — quest-state.js depende de catálogos em ../res/release/config/
quest-state.js usa loadCatalog('t_s_questtemplate') que busca em `path.resolve(__dirname, '../res/release/config')`. Se essa pasta não existe ou não tem os JSONs, TODAS as quests ficam vazias.

### BUG-005 HIGH — battle-engine.js depende de catálogos na mesma pasta
battle-engine.js faz loadCatalog('t_s_campaigndata'), loadCatalog('t_s_herotemplate'), etc. Mesma pasta, mesmo problema.

### BUG-007 HIGH — IPv6 hardcoded
```javascript
const PUBLIC_IPV6 = process.env.WARTUNE_PUBLIC_IPV6 || '2804:d45:bf02:ae00:5cae:9f5a:478b:464b';
```
Esse é o IPv6 pessoal do Marcelo. Outros jogadores não conectam.

### BUG-008 MEDIUM — Connection pool MySQL limitado a 5
db.js: `connectionLimit: 5`. Com múltiplos jogadores simultaneamente, queries acumulam.

### BUG-009 HIGH — herotemplate pode não carregar
battle-engine.js faz `const rawHeros = loadCatalog('t_s_herotemplate')`. Se o arquivo não está em ../res/release/config/, `heroById.get(x)` retorna undefined → stats do herói ficam errados.

### BUG-010 CRITICAL — 1.487 opcodes não implementados
PROTOCOLO_CODIGOS_CLIENTE.json tem 1.670 opcodes. Servidor CODE_NAMES tem 183. Quando o cliente manda um opcode não implementado, o servidor ignora silenciosamente.

---

## Opcodes Principais (que o servidor conhece)

```
28678  L_CREATE_LOGIN         (C→S) Login
3846   U_L_CREATE_LOGIN_RSP   (S→C) Resposta login
28672  L_GET_PLAYER_LIST      (C→S) Lista de personagens
28676  L_REGISTER_ROLE        (C→S) Criar personagem
20001  G_LOGIN_GATEWAY        (C→S) Gateway WebSocket
5005   C_BAG_MOVE             (C→S) Mover item na bag
8254   C_MOVE_POS             (C→S) Movimento do jogador
150    U_C_SERIAL_ARMY        (S→C) Formação do exército
4153   U_C_LOAD_CASTLE        (S→C) Carregar castelo
4154   U_C_LOAD_BUILD         (S→C) Carregar construções
134    U_C_CAMPAIGN_FINISH    (S→C) Campanha concluída
```

---

## MySQL — Tabelas Principais

```sql
accounts          (id, username, password_hash, created_at)
characters        (id, account_id, nickname, sex, camp, icon, grade, gold, experience, 
                   crystals, bound_crystals, energy, map_id, pos_x, pos_y, site, 
                   state_json, vip_level, created_at)
vip               (character_id, vip_level, vip_type, vip_expire_time, vip_points)
consortia         (id, name, level, materials)
consortia_members (character_id, consortia_id, build, total_build)
consortia_research(consortia_id, skill_type, level)
inventory_items   (id, character_id, template_id, amount, location, slot_number)
ultra_resource_ledger (id, character_id, operation_ref, resource_kind, delta, ...)
ultra_schema_migrations (version, applied_at)
```

---

## Para Migração Java

| Node.js | Java |
|---|---|
| mysql2 pool | Spring Data JPA + HikariCP (15 connections) |
| WebSocket binário | Netty 4.x (NÃO Spring WebSocket) |
| require('./module') | @Service + @Autowired |
| fs.readdirSync().find() | Files.list().filter().findFirst() |
| JSON.parse(fs.readFileSync()) | ObjectMapper.readValue() |
| protobuf encode/decode | protobuf-java library |

### Ordem de migração recomendada:
1. **wartune-combat-math.js** → CombatMathService.java (zero deps, cálculo puro)
2. **wartune-attribute-bonuses.js** → AttributeBonusCalculator.java (zero deps)
3. **attribute-calculator.js** → AttributeCalculatorService.java (deps: 1+2)
4. **db.js** → DatabaseConfig.java + JPA entities (infraestrutura)
5. **original-protobuf.js** → ProtobufCodec.java (protocolo)
6. **session-state.js** → SessionState.java + WebSocketHandler (Netty)
7. **servidor_v08.js** → OpCodeRouter.java (dividir por grupos de opcodes)

---

## Fim do Briefing

**Agora me diga o que você quer que eu faça e eu faço. Tenho todo o contexto.**
