# Специфікація: `sdlc-lint` CLI + CI (Напрямок A) — 2026-07-03

> Статус: **дизайн зафіксовано, готово до `writing-plans`.**
> Батьківський брейншторм: `2026-07-03-plugin-improvements-roadmap-design.md`.
> Зафіксовані рішення: Node ESM CLI · детекція на fixtures · **паралельна верифікація**
> (оркестратор НЕ змінюється) · прибирання мертвого коду.

## Мета

Дати маркетплейсу детермінований шар перевірки, щоб merge не міг мовчки зламати
валідність маніфестів/workflow чи логіку авто-детекції стека. Досягається без жодної зміни
`pipeline-orchestrator/SKILL.md` (інваріант «core never changes» збережено): CLI —
**незалежний verifier**, а не рушій рантайму.

## Не-цілі (out of scope)

- Оркестратор **не** делегує детекцію CLI (обрано паралельну верифікацію). Markdown-логіка
  детекції лишається в skill як є.
- Жодних змін у фазах пайплайна, агентах чи pricing.
- LLM-in-the-loop eval-тести (дорого/флейкі) — не тут.

---

## Компоненти

### 1. `tools/sdlc-lint/` — Node ESM CLI

Структура:

```
tools/sdlc-lint/
  package.json          # type:module, bin: sdlc-lint, deps: yaml ^2, ajv ^8, ajv-formats
  cli.mjs               # роутер підкоманд + прапори (--json, --root, --quiet)
  lib/
    load.mjs            # glob плагінів; читання YAML/JSON; поділ manifest за kind
    schema.mjs          # ajv-валідація проти schemas/*.json
    cycles.mjs          # побудова DAG з workflow + виявлення циклів (алгоритм RESOLVER.md)
    detect.mjs          # обчислення detect-правил проти дерева (file_exists/contains/glob/any/all)
    report.mjs          # human + --json формат виводу; агрегація exit-коду
  fixtures/
    android-bare/       + expected.json
    android-retrofit/   + expected.json
    android-full/       + expected.json
    vanilla-node/       + expected.json
    no-kotlin/          + expected.json
  test/
    detect.test.mjs     # node:test — проганяє fixtures через detect.mjs, порівнює з expected
    cycles.test.mjs     # node:test — cyclic.yaml → цикл; валідні workflow → чисто
```

**Підкоманди** (кожна: exit 0 = чисто, 1 = знайдено проблеми, 2 = помилка інструмента):

| Команда | Робить |
|---------|--------|
| `sdlc-lint schema [--root .]` | кожен `plugins/**/manifest.yaml`, `plugins/**/workflows/*.yaml`, `plugins/sdlc/config/models.json`, будь-який `**/.claude/model.local.json` → проти відповідної схеми в `schemas/` (мапінг за іменем/`kind`). |
| `sdlc-lint cycles` | кожен `workflows/*.yaml` → DAG з `loop.return_to`/`parallel`/послідовності; back-edge, що не оголошений `loop`, = цикл. Валідує `loop.return_to` вказує на попередню фазу. |
| `sdlc-lint detect <fixtureDir>` | обчислює `detect` кожного foundation-маніфеста проти дерева; резолвить winner (найвищий `priority`) + additive-набір (framework, чий `dependency` присутній і чий `enriches_aspect` у `hosts_aspects` winner-а). Друкує рішення. З `--expect <file>` порівнює з `expected.json`. |
| `sdlc-lint all` | `schema` + `cycles` + `detect` по всіх `fixtures/*` з їхніми `expected.json`. Це запускає CI. Ненульовий exit, якщо будь-що впало. |

**Мапінг схем** (`schema.mjs`):

- `manifest.yaml` → `schemas/manifest.schema.json` (розрізнення `kind: foundation|framework`
  вже в схемі).
- `workflows/*.yaml` → `schemas/workflow.schema.json`.
- `config/models.json` → `schemas/models.schema.json`.
- `.claude/model.local.json` → `schemas/model-local.schema.json`.

**Правила `detect` (`detect.mjs`)** — дзеркалить чотири типи з README/схеми:

- `file_exists: <path>` — існує (відносно кореня fixture).
- `file_contains: { path, pattern }` — regex-мMatches; `path` може бути glob.
- `file_glob: <pattern>` — ≥1 файл матчиться.
- `any: [...]` / `all: [...]` — рекурсивні OR/AND.

Framework-детекція для fixtures: спрощена до `file_contains` по
`gradle/libs.versions.toml` + `**/build.gradle*` на `dependency`-координату (той самий
пошук, що foundation оголошує через `framework_detection`).

> **Дисципліна проти дрейфу.** `detect.mjs` реалізує ту саму специфікацію правил, що й
> оркестратор у markdown. Щоб дрейф не проскочив: `test/detect.test.mjs` фіксує очікування, а
> в roadmap-беклог додається пункт «при зміні detect-правил у SKILL.md — оновити detect.mjs +
> fixtures» (додати як коментар-guard у секцію Step 0b оркестратора, БЕЗ зміни логіки).

### 2. `expected.json` (контракт fixture)

```json
{ "foundation": "android", "priority": 300, "additive": ["retrofit"] }
```

Матриця:

| fixture | вміст | foundation | additive |
|---------|-------|------------|----------|
| `android-bare` | `settings.gradle.kts` + `app/src/.../Main.kt` | android | [] |
| `android-retrofit` | + `libs.versions.toml` з retrofit | android | [retrofit] |
| `android-full` | + room + dagger координати | android | [retrofit, room, dagger] |
| `vanilla-node` | `package.json`, без gradle/kt | vanilla | [] |
| `no-kotlin` | `settings.gradle.kts`, але 0 `*.kt` | vanilla | [] (перевірка AND-гілки android-детекції) |

### 3. `.github/workflows/ci.yml`

Один workflow на `push` + `pull_request`, job `lint-and-test` (ubuntu, Node 20):

```yaml
steps:
  - checkout
  - setup-node@v4 (node 20, cache npm на tools/sdlc-lint)
  - run: npm ci --prefix tools/sdlc-lint
  - run: node tools/sdlc-lint/cli.mjs all --json
  - run: node --test tools/sdlc-lint/test        # node:test раннер
  - run: sudo apt-get install -y shellcheck && shellcheck plugins/**/hooks/*.sh
  - run: bash tests/test-enforce-agent-model.sh
  - run: python3 tests/test-model-local-schema.py
```

(Якщо `**` не розкривається в shellcheck-кроці — використати `find plugins -name '*.sh' -path '*/hooks/*' -print0 | xargs -0 shellcheck`.)

### 4. Прибирання

- Видалити `plugins/android-plugin/` (мертва тека, лише `.DS_Store`).
- `.gitignore`: додати `.DS_Store`; `git rm --cached` усі закомічені `.DS_Store`.

---

## Потік даних

```
CI trigger
  └─ npm ci (tools/sdlc-lint)
       └─ sdlc-lint all
            ├─ load.mjs   → globs plugins/**, парсить YAML/JSON, split за kind
            ├─ schema.mjs → ajv проти schemas/*  ─┐
            ├─ cycles.mjs → DAG кожного workflow  ─┼─ report.mjs → human/json + max(exit)
            └─ detect.mjs → кожен fixtures/* vs expected.json ┘
```

Жоден шлях не читає й не запускає оркестратор. CLI бачить лише файли на диску.

## Обробка помилок

- **Відсутня/зламана схема** → exit 2 (помилка інструмента), явне повідомлення, який файл.
- **Невалідний YAML/JSON** → рахується як фейл валідації (exit 1), з шляхом + рядком ajv/yaml.
- **fixture без `expected.json`** → exit 2 (мисконфіг тесту), не мовчазний pass.
- **`--json`** завжди друкує машинний підсумок навіть при фейлі (для CI-гейтингу).
- Fail-closed у CI (ненульовий exit блокує merge); fail-open у `/doctor` (лише попередження).

## Тестування

- `node --test tools/sdlc-lint/test` — юніт на `detect.mjs` (усі fixtures) і `cycles.mjs`
  (`workflows/test-fixtures/cyclic.yaml` → цикл; усі реальні workflow → чисто).
- Сам `sdlc-lint schema` проти реальних `plugins/**` — це і тест, і продакшн-перевірка
  (реальні маніфести мусять валідуватись).
- Наявні `tests/*.sh` / `*.py` лишаються, тепер ганяються в CI.

## Майбутнє перевикористання (поза цією специфікацією)

- `/sdlc:doctor` викликає `sdlc-lint all --json` (fail-open) — детермінований бекенд замість
  LLM-перевірок.
- `/sdlc:validate` (нова команда для авторів плагінів) — тонка обгортка над `sdlc-lint all`.
- `/sdlc:report` (B2) перевикористовує `load.mjs` для читання `_telemetry.json`.

---

## Deliverables (чек-ліст для writing-plans)

1. `tools/sdlc-lint/` пакет: `cli.mjs` + `lib/*` + `package.json`.
2. `fixtures/*` з `expected.json` (5 дерев).
3. `test/*.test.mjs` (node:test).
4. `.github/workflows/ci.yml`.
5. Прибирання: видалити `plugins/android-plugin/`, `.gitignore` + de-track `.DS_Store`.
6. Guard-коментар у Step 0b `SKILL.md` (лише коментар, логіка недоторкана).
7. README: коротка секція «Verifying plugins locally: `node tools/sdlc-lint/cli.mjs all`».
