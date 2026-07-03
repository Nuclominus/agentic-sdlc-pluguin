# Специфікація: `--resume` через per-phase checkpoints (Напрямок B1) — 2026-07-03

> Статус: **дизайн зафіксовано, готово до `writing-plans`.**
> Батьківський брейншторм: `2026-07-03-plugin-improvements-roadmap-design.md`.
> Зафіксовані рішення: **per-phase checkpoint файли** (єдине, що переживає жорсткий краш) ·
> `_telemetry.json` збирається з чекпойнтів (два записи → один, менше дрейфу) · resume
> входить у DAG на фазовій гранулярності з правильною loop/skip/aspect-семантикою.

## Мета

Зупинений (краш сесії, cost-cap abort, fatal-halt, Ctrl-C) запуск `/sdlc:start` має
**дописуватись**, а не починатись з нуля. Запуск, убитий на Security, коштує одну фазу, а не
п'ять. Це найвища ROI з одної фічі роадмапу.

**Ключова знахідка з коду, що формує дизайн.** `_telemetry.json` пишеться **лише в Step 5**
(кінець або graceful-abort). При жорсткому краші сесії посеред фази телеметрії **не існує** —
лишаються тільки файли фаз `0X-{phase}.md`. Але саме краш — головний кейс для resume. Тому
roadmap-формула «фаза завершена = файл виводу + телеметрія `status: completed`» **недостатня**:
у критичному кейсі телеметрії просто немає. Рішення — **інкрементальний per-phase checkpoint**,
який пишеться одразу після кожної фази (Step 3d), а не наприкінці.

## Не-цілі (out of scope)

- **Не** відновлюємо стан репозиторію. Resume довіряє workspace-у й файлам на диску; він не
  перевіряє, що git не поїхав під фазами. Це відповідальність користувача (документуємо).
- **Не** робимо checkpoint на під-фазовій гранулярності loop-раундів (YAGNI — resume входить
  на межі фази; незавершений loop переграється з раунду 1, див. нижче).
- **Не** вводимо фонові/паралельні запуски — пайплайн лишається синхронним в одній сесії.
- Крос-run rollup (B2) і `/sdlc:status` (D) — окремі специфікації; тут лише робимо checkpoint
  придатним до їх повторного використання.

---

## Компоненти

### 1. Checkpoint-файли — `docs/plans/{slug}/.checkpoint/`

Один файл на завершену одиницю роботи (фазу або `(фаза, аспект)`):

```
docs/plans/{slug}/.checkpoint/
  business_analysis.json
  development-database.json        # aspect-aware → {phase}-{aspect}.json
  development-backend.json
  development-plan-backend.json    # dev план-пас (approved gate) — окремий чекпойнт
  qa.json
  security.json
  ...
```

**Схема checkpoint-файла** — це рівно один запис `phases[]` з телеметрії плюс два поля
(`output_file`, `completed_at`). Тобто checkpoint і фінальний `phases[]`-елемент — **одна й та
сама структура**; це навмисно (усуває дрейф — див. Компонент 3):

```json
{
  "phase": "development",
  "aspect": "backend",
  "status": "completed",
  "agent": "android-developer",
  "model": "claude-sonnet-5",
  "input_tokens": 28000,
  "output_tokens": 2100,
  "cached_input_tokens": 18000,
  "cost_usd": 0.04,
  "usage_source": "reported",
  "compact_summary_chars": 1450,
  "compact_handoff_violation": false,
  "output_file": "docs/plans/{slug}/02-development-backend.md",
  "completed_at": "<ISO timestamp>"
}
```

- `status` ∈ `completed` | `skipped` | `approved`.
  - `completed` — фаза відпрацювала й пройшла 3e-валідацію.
  - `skipped` — фаза пропущена skip-rule-ом (Step 0c) або порожнім агентом (3a); робити нічого.
  - `approved` — **лише для dev-план-паса** (`{phase}-plan[-aspect].json`): план схвалено на
    approval-gate, але імплементацію ще не завершено. Дозволяє resume пропустити planning-gate
    і піти одразу в implement-пас.
- QA-фаза додає `qa_iterations_used`, `qa_status` (як у наявній 3d-2).
- Aspect-agnostic фази: `aspect: null`, ім'я файла — `{phase}.json`.

**Атомарність запису (guard проти напівзаписаного чекпойнта при краші під час самого запису).**
Писати в `.checkpoint/{name}.json.tmp`, потім `rename` на фінальне ім'я (rename атомарний у
межах FS). Resume, що зустрічає `.tmp` або JSON, який не парситься / не має `status`, вважає цю
фазу **НЕ завершеною** (переграє). Fail-safe: сумнів → перегра, ніколи не пропуск.

### 2. Розпізнавання й вхід у resume

**CLI-поверхня (`start.md`).** Парсити `--resume` та `--resume=<slug>`:

- `--resume` (без значення) — slug виводиться з опису так само, як у Step 2 (той самий
  детермінований алгоритм), і має збігтися з наявною текою за побудовою.
- `--resume=<slug>` — явна тека `docs/plans/<slug>/`.
- Прапор `--dry-run` комбінується (див. Компонент 4).

Передати `resume_slug` (або сигнал «resume, derive slug») у skill як вхід поряд з `forced_stack`.

**Step 2 (skill) — resume-режим замість чистого workspace-препа.** Коли resume активний:

1. Резолвити `task_slug` (з `--resume=<slug>` або derive). Якщо `docs/plans/{slug}/` не існує
   → HALT: `⛔ Nothing to resume: docs/plans/{slug}/ not found. Run without --resume to start fresh.`
2. **Не** перестворювати `_brief.md`. Прочитати наявний (це першоджерело опису для агентів).
   Якщо переданий опис непорожній і відрізняється від `_brief.md` → надрукувати warning
   (`⚠️ --resume: description differs from saved _brief.md; using saved brief`), але продовжити
   зі збереженим (workspace — SSOT).
3. Прочитати `.checkpoint/*.json` → побудувати `CONTEXT.completed_units` — множину
   `(phase, aspect, status)`. Ушкоджені/`.tmp` ігноруються (перегра).
4. **MUST PRINT VERBATIM:**
   ```
   ⏭ Resume: {slug}
      Completed: {list of phase[-aspect] from checkpoints}
      Re-entering at: {first incomplete resolved phase}
   ```

### 3. Пропуск завершених фаз у DAG (Step 3)

Перед диспатчем кожної **resolved-фази** Step 3 звіряється з `CONTEXT.completed_units`. Правила
пропуску (усі — узгоджені з наявними loop/parallel/aspect/skip-семантиками):

- **Plain / parallel-член** з checkpoint `status ∈ {completed, skipped}` для цієї
  `(phase, aspect)` → **пропустити диспатч**. Завантажити checkpoint у `CONTEXT.phases[]`
  (для фінальної агрегації) і додати `cost_usd` у `CONTEXT.running_cost_usd`. Надрукувати:
  ```
  ⏩ Phase {N}/{total}: {phase}{ — aspect} → skipped (resumed from checkpoint)
  ```
- **Aspect-aware фаза** — пропуск **по-аспектно**. Аспекти з completed-checkpoint пропускаються;
  решта в канонічному порядку (`database → backend → frontend → testing`) диспатчаться нормально.
  Прочитані аспект-виводи завершених аспектів лишаються доступні наступним (вони на диску).
- **Development two-pass.** Якщо `development[-aspect].json` == `completed` → пропустити весь
  аспект. Інакше, якщо `development-plan[-aspect].json` == `approved` → пропустити planning-пас
  і approval-gate, піти одразу в implement-пас (план уже на диску, схвалений). Інакше — повний
  two-pass із нуля.
- **Loop-фаза.** Переграється **як одиниця з раунду 1**, ЯКЩО її власний checkpoint не
  `completed` (тобто вердикт не був approved). Це навмисно просто: ми не чекпойнтимо окремі
  раунди (out of scope). `return_to`-фаза, навіть якщо має completed-checkpoint, буде
  ре-диспатчена loop-ом нормально — бо loop її «повертає»; узгоджено з наявним правилом «фаза,
  повернута через changes, не завершена». Checkpoint loop-фази пишеться лише коли вона **approved**.
- **Skip-rules (Step 0c)** при resume перечитуються з нуля (детерміновані від `$ARGUMENTS`) —
  вони дають ті самі `skipped`, тож checkpoint і re-обчислення збігаються; конфлікту немає.

Якщо **всі** resolved-фази вже completed → resume друкує «nothing left to run», переходить одразу
до Step 4 (post-checks) + Step 5 (перезбирає телеметрію). Post-checks завжди переганяються —
вони дешеві й перевіряють підсумковий стан диска.

**Запис checkpoint (Step 3d, нова під-дія 3d-3).** Після 3d-1/3d-2 (telemetry обчислена) і 3e
(валідація пройдена) — атомарно записати `.checkpoint/{phase}[-{aspect}].json` зі структурою
Компонента 1. Dev план-пас пише `{phase}-plan[-aspect].json` зі `status: approved` одразу після
approval-gate. Skip (3a/0c) пише checkpoint зі `status: skipped`. Це **єдина** зміна write-path
оркестратора — адитивна, логіку фаз не чіпає.

### 4. Фінальна телеметрія збирається з чекпойнтів (Step 5)

Замість того щоб тримати `phases[]` лише в пам'яті, Step 5 **читає `.checkpoint/*.json`** і
складає з них `phases[]` (упорядкувати за `completed_at`). Оскільки checkpoint-схема == елемент
`phases[]`, агрегати (`total_*`, `cache_hit_ratio`, `total_cost_usd`) рахуються як і раніше — але
тепер вони коректні **навіть після resume**: вартість завершених до-краху фаз збережена в
чекпойнтах, а не втрачена.

Нові поля верхнього рівня в `_telemetry.json`:

- `resumed: true` — коли запуск був resume.
- `resumed_at: <ISO>` — коли відбувся resume-вхід.
- `resume_slug: <slug>`.
- Кожен `phases[]`-елемент несе `origin: "resumed" | "fresh"` (resumed = завантажений із
  checkpoint без ре-диспатчу цього запуску). Дає B2/AAR атрибутувати, що реально коштувало цього
  разу проти перенесеного з попереднього запуску.

`aborted_at_phase` лишається як є (пишеться при cost-cap/fatal abort) — тепер він і checkpoint-и
разом дають наступному resume точку входу.

### 5. `--resume --dry-run` (дешевий preview)

Комбінація друкує, що resume **зробив би**, без диспатчу: які фази пропущені (з checkpoint), яка
перша ре-входиться, і кошторис **решти** фаз (heuristic, як у наявному 1d-2, але тільки для
неповних фаз). Виходить чисто. Корисно перед дорогим re-run переконатися, що checkpoint-и
розпізналися правильно.

---

## Потік даних

```
/sdlc:start "<desc>" --resume[=slug]
  └─ start.md: парс --resume → resume_slug | derive-signal
       └─ skill Step 2: HALT якщо теки нема; читає _brief.md + .checkpoint/*.json
            → CONTEXT.completed_units
       └─ Step 3: для кожної resolved-фази
            ├─ у completed_units? → ⏩ skip, load checkpoint → phases[]+running_cost
            └─ інакше → нормальний диспатч → 3d-3 пише .checkpoint/{phase}.json (atomic)
       └─ Step 4: post-checks (завжди)
       └─ Step 5: glob .checkpoint/*.json → phases[] → _telemetry.json
                   (+ resumed, resumed_at, origin per phase)
```

## Обробка помилок

- **Теки `docs/plans/{slug}/` нема** при `--resume` → HALT з підказкою запустити без `--resume`.
- **Ушкоджений / `.tmp` / без `status` checkpoint** → фаза вважається незавершеною (перегра).
  Ніколи не пропускаємо на основі сумнівного чекпойнта (fail-safe у бік повторного виконання).
- **`.checkpoint/` існує, але порожня** (краш до першої фази) → resume = звичайний повний запуск,
  просто без перестворення `_brief.md`.
- **Опис ≠ збережений `_brief.md`** → warning, використати збережений (workspace — SSOT).
- **Усі фази completed** → пропустити диспатч, перегнати post-checks + перезібрати телеметрію.
- Headless: ті самі правила; warnings у stderr одним рядком, HALT → exit 1 з машинним рядком.

## Тестування

Resume-логіка живе в LLM-виконуваному markdown (як і решта оркестратора) — юніт-тестувати її
безпосередньо не можна. Тому перевіряємо **детерміновані артефакти** через наявний `sdlc-lint`
(Напрямок A) і цілеспрямовані fixture-перевірки:

- **Схема checkpoint** — додати `schemas/checkpoint.schema.json`; `sdlc-lint schema` валідує
  будь-який `docs/plans/**/.checkpoint/*.json` проти неї. Ловить дрейф структури.
- **Fixture-workspace** — `tools/sdlc-lint/fixtures/resume-*/` із заздалегідь викладеними
  `.checkpoint/*.json` + `expected-reentry.json` (`{ completed: [...], reenter_at: "security" }`).
  Нова під-команда `sdlc-lint resume <workspaceDir>` обчислює точку ре-входу з checkpoint-ів за
  тими самими правилами пропуску (Компонент 3) і порівнює з `expected-reentry.json`. Це і є
  відсутня детермінована тестова поверхня для resume-семантики (включно з aspect-partial,
  dev-plan-approved, loop-not-approved кейсами).
- **`node --test`** — юніт на функцію обчислення точки ре-входу (та сама, що під `resume`-командою).
- Ручний smoke: запустити пайплайн, вбити на Security, `--resume`, переконатися що BA→QA
  пропущені, Security+Docs відпрацювали, фінальна телеметрія має повну вартість усіх фаз.

> **Дисципліна проти дрейфу.** Правила пропуску існують у двох місцях: markdown-оркестратор
> (виконує) і `detect`-подібна функція в `sdlc-lint resume` (тестує). Guard-коментар у Step 3
> SKILL.md: «при зміні resume skip-семантики — оновити `lib/resume.mjs` + fixtures». Той самий
> патерн дисципліни, що вже застосований для detect-правил у специфікації A.

## Взаємодія з рештою роадмапу

- **B2 (`/sdlc:report`)** — `origin: fresh|resumed` дозволяє не подвоювати вартість при
  агрегації кількох запусків одного slug. Checkpoint-и — вже готовий машинний субстрат.
- **D (`/sdlc:status`)** — читає ті самі `.checkpoint/*.json`, щоб показати in-progress позицію
  без окремого формату стану.
- **C1 (AAR)** — `gather.md` може читати checkpoint-и/телеметрію замість перепарсингу трансcrypta.
- **A (`sdlc-lint`)** — розширюється командою `resume` + схемою checkpoint; перевикористовує
  `load.mjs`.

---

## Deliverables (чек-ліст для writing-plans)

1. **`start.md`** — парсинг `--resume` / `--resume=<slug>`; передача `resume_slug` у skill;
   секція документації про resume + non-goal «не відновлює git-стан».
2. **`pipeline-orchestrator/SKILL.md`** (адитивні зміни, логіка фаз недоторкана):
   - Step 2 — resume-гілка: HALT-guard, читання `_brief.md`+checkpoint-ів, `⏭ Resume` банер.
   - Step 3 — skip-перевірка перед диспатчем (plain/parallel/aspect/dev-two-pass/loop правила),
     `⏩` банер; guard-коментар про дрейф skip-семантики.
   - Step 3d-3 — атомарний запис checkpoint (+ dev-plan `approved`, skip `skipped`).
   - Step 5 — збирати `phases[]` з checkpoint-ів; нові поля `resumed`, `resumed_at`,
     `resume_slug`, `origin` per phase.
3. **`schemas/checkpoint.schema.json`** — схема одного checkpoint-запису.
4. **`tools/sdlc-lint`** — під-команда `resume <workspaceDir>` + `lib/resume.mjs`
   (обчислення точки ре-входу); `schema`-мапінг для `.checkpoint/*.json`; **розширити `all`**:
   тепер `all` = `schema` + `cycles` + `detect`(по `fixtures/` з `expected.json`) +
   `resume`(по `fixtures/resume-*/` з `expected-reentry.json`).
5. **`tools/sdlc-lint/fixtures/resume-*/`** — дерева з `.checkpoint/*.json` + `expected-reentry.json`
   (кейси: clean-midpoint, aspect-partial, dev-plan-approved, loop-not-approved, all-done, corrupt-tmp).
6. **`test/resume.test.mjs`** (node:test) — юніт на re-entry-функцію по фікстурах.
7. **`.github/workflows/ci.yml`** — жодних змін кроків: розширений `sdlc-lint all` (deliverable 4)
   уже покриває resume-fixtures у наявному CI-виклику.
8. **README + `docs/WORKFLOW.md`** — коротка секція «Resuming an interrupted run: `--resume`».
