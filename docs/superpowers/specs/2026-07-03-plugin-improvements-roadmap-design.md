# Roadmap: покращення та нові можливості плагіна — 2026-07-03

> Статус: **брейншторм завершено, рішення зафіксовано.** Це divergent-документ на чотири
> напрямки. Кожен пункт далі перетворюється на власну implementation-специфікацію
> (`docs/superpowers/specs/…`) через skill `writing-plans`.
>
> Порядок реалізації (обрано користувачем): **A → далі за пріоритетом (пропозиція: B1 → D → C).**

## Контекст

Маркетплейс `agentic-sdlc` — зрілий: платформо-агностичне ядро `sdlc` (skill
`pipeline-orchestrator`, ~1400 рядків) + centerpiece `android-foundation` + 3 additive
framework-плагіни (Retrofit / Room / Dagger). `CORE-TODO.md` фактично весь `DONE`. Останні
релізи закрили: model-registry SSOT, per-model pricing + cost-телеметрію, `model.local.json`,
`--dry-run` + cost-caps, project-local workflows, match-based авто-вибір workflow, Project
Extension Manifest.

Питання не «дороблянка roadmap», а **наступний рівень зрілості маркетплейса, який
встановлюють і якому довіряють інші**.

### Знахідки з коду (обґрунтування напрямків)

1. **Немає CI взагалі** — відсутній `.github/`. Лише 2 мікротести
   (`tests/test-enforce-agent-model.sh`, `tests/test-model-local-schema.py`), які ніхто не
   ганяє автоматично. 5 схем є, але жодна не валідує реальні маніфести/workflow.
2. **Cost-телеметрія вже реальна, але посильна per-run.** Оркестратор пише реальні
   `input/output/cached` токени + `cost_usd` (з registry-pricing) у
   `docs/plans/{slug}/_telemetry.json`. Крос-run агрегації **немає**.
3. **Resume не існує.** Оркестратор *записує* `aborted_at_phase`, але ніхто це не споживає.
   Зупинений запуск викидає всі попередні фази.
4. **Навчальний цикл — осиротілий.** Агент `android-aar` посилається на skill
   `android-workflow:aar` з контрактами `gather.md`/`report.md`/apply — **цього skill у
   репозиторії немає.** `android-docs` і `rules/workflow.md` теж кажуть «Run
   `android-workflow:aar`» — висяча команда. Ретроспективу спроєктували на папері, але не
   портували.
5. **Дрібне прибирання:** мертва тека `plugins/android-plugin/` (лише `.DS_Store`);
   `.DS_Store` закомічені по всьому дереву.

---

## Зафіксовані рішення

| # | Рішення | Вибір |
|---|---------|-------|
| A-депт | Глибина тулінгу | **Повний resolver CLI** (`tools/sdlc-lint`) — схеми + детекція на fixtures + цикли |
| A-мова | Рантайм CLI | **Node.js (ESM `.mjs`)** — збігається з наявним `vault/scripts/*.mjs`, без нового рантайму |
| C-модель | Персистентність уроків | **Обидва** — `.claude/sdlc-lessons.md` (інжект у промпти) + запропоновані правки зі схваленням |
| Порядок | Перше в роботу | **A — CI + resolver CLI** (фундамент для B2/D/doctor) |

---

## Напрямок A — Надійність: CI + реальні тести

**Проблема.** Найвищий за важелем реальний розрив. Найризиковіша логіка (детекція стека,
резолюція аспектів, workflow-DAG з loops/parallel) не має регресійного покриття; поганий
merge мовчки ламає авто-детекцію в усіх користувачів.

**Ключова напруга.** Оркестратор — це LLM-виконуваний markdown, а не код; його не
юніт-тестувати дешево й детерміновано. Тому цінність — **винести детерміновані частини в
маленький resolver/validator CLI** (`tools/sdlc-lint`, Node ESM):

- Валідує кожен `**/manifest.yaml`, `**/workflows/*.yaml`, `config/models.json`,
  `model.local.json` проти відповідної схеми в `schemas/`.
- Виявляє цикли у workflow (алгоритм уже описаний у `workflows/RESOLVER.md`; фікстура
  `workflows/test-fixtures/cyclic.yaml` чекає на раннер).
- Обчислює правила `detect` (`file_exists` / `file_contains` / `file_glob` / вкладені
  `any`/`all`) на **fixture-деревах проєктів** → assert, що резолвиться правильний foundation
  + additive-набір. Це і є відсутня тестова поверхня.

**Побічний виграш.** Той самий CLI стає детермінованим рушієм під `/sdlc:doctor` і новий
`/sdlc:validate` для авторів плагінів — LLM перестає щоразу вручну переобчислювати детекцію
(менше вартість/флейкі оркестратора).

**Deliverables.**
- `tools/sdlc-lint/` (Node ESM): підкоманди `schema`, `detect`, `cycles`, `all`; JSON + human
  вивід; ненульовий exit при фейлі.
- `tools/sdlc-lint/fixtures/` — дерева: `android-bare`, `android+retrofit`,
  `android+room+dagger`, `vanilla`, `no-match`.
- `.github/workflows/ci.yml`: `sdlc-lint all` + `shellcheck` усіх hooks + наявні bash/python
  тести + (майбутнє) fixture-матриця.
- Прибрати `plugins/android-plugin/`; додати `.DS_Store` в `.gitignore` і de-track.

**Оцінка.** Середня. CLI — основна робота; CI-обв'язка — пів дня.

---

## Напрямок B — Операційна зрілість: resume + крос-run вартість

**B1 — `--resume` (checkpoint).** `docs/plans/{slug}/NN-*.md` — це вже субстрат чекпойнта на
диску. `/sdlc:start "<same>" --resume` (або `--resume=<slug>`) читає workspace, вважає фазу
завершеною, якщо є файл виводу + телеметрія `status: completed`, і повторно входить у DAG на
першій незавершеній фазі (з повагою до loops: фаза, повернута через `changes`, не «завершена»).
Зупинений на Security запуск коштує одну фазу, а не п'ять. **Найвища ROI з одної фічі.**

**B2 — `/sdlc:report` (крос-run rollup).** Скрипт (дешевий, детермінований — перевикористати
CLI з A) глобить усі `docs/plans/*/_telemetry.json` і рендерить: сумарні витрати, витрати в
часі, вартість по фазах, вартість по моделях, тренд cache-hit, інциденти cap-breach, частоту
skip-rules, розподіл QA-ітерацій.

**B3 — Human approval gates (opt-in).** Workflow-рівневе `gates: [after: business_analysis]` —
пауза на sign-off перед витратами на Dev. Generic control flow, вимкнено за замовчуванням.

**Оцінка.** B1 середня (акуратна loop/skip-семантика), B2 низька, B3 низька.

---

## Напрямок C — Екосистема + (недороблений) навчальний цикл

**C1 — Завершити AAR-цикл (полагодити осиротілість).** Побудувати відсутній skill `aar`, який
агент `android-aar` уже припускає: `gather.md` (transcript → метрики токенів/кооперації;
тепер може *читати `_telemetry.json`* замість перепарсингу трансcrypта), `report.md`
(структуровані знахідки), `apply.md` (правки зі схваленням користувача).

**Модель персистентності (обрано «Обидва»):**
- `.claude/sdlc-lessons.md` — проєктний файл уроків; оркестратор інжектить його в стабільний
  префікс промптів фаз (cache-safe, детерміновано відсортований).
- AAR також може **пропонувати** конкретні правки агентів/правил/`settings.json`; користувач
  схвалює; частина — самовдосконалення плагіна.
- Прибрати висячі посилання, якщо skill не буде названо `android-workflow:aar` (вирівняти
  namespace на реальний плагін, напр. `android-foundation:aar`).

**C2 — Більше framework-провайдерів.** Патерн доведений, `create-pluguin` скаффолдить. Набір:
**Koin** (DI-альтернатива — закриває «detect, don't impose» для не-Hilt), **Ktor client**
(networking-альтернатива Retrofit), **WorkManager** (aspect background),
**kotlinx.serialization**, **DataStore-Proto**. Кожен enrich-only.

**Оцінка.** C1 середньо-висока (цикл + персистентність), C2 низька за штуку.

---

## Напрямок D — DX + спостережуваність

- **HTML-звіт запуску (artifact).** Наприкінці пайплайна рендерити `_telemetry.json` + резюме
  фаз + результати post-checks у самодостатній HTML-artifact (таймлайн фаз, розбивка
  вартості, знахідки, торкнуті файли). Значно читабельніше за термінальне резюме; поширюване.
- **`/sdlc:status`.** Чесно scoped: пайплайн іде синхронно в одній сесії, тож «статус» = читання
  in-progress `docs/plans/{slug}/` (які фази мають файли, остання телеметрія) + поточна позиція
  й витрати. Найкорисніше для `/sdlc:batch` worktree-запусків і для resume.
- **Онбординг першого запуску.** `/sdlc:doctor --fix`: пропонує скаффолд `sdlc.local.yaml`,
  ставить відсутні опційні залежності, ганяє dry-run smoke-тест.

**Оцінка.** Низька–середня. HTML-artifact — головний виграш.

---

## Перехресні залежності (чому порядок важливий)

- CLI з **A** → рушій для **B2** (report), **D** (status), і `doctor`.
- **B1** (resume) → вмикає **D** (status читає ту саму позицію).
- Телеметрія (уже є) + **B** → живить **C1** (AAR читає `_telemetry.json`).

**Пропонована послідовність специфікацій:** A → B1 → D(HTML-звіт) → C1 → B2 → C2 → B3.

---

## Наступний крок

Поглиблена пропрацювання **A** до implementation-ready специфікації
(`docs/superpowers/specs/2026-07-03-sdlc-lint-ci-design.md`), далі — `writing-plans`.
