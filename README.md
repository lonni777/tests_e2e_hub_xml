# Проект автотестів Hub (логін та XML-фіди)

Автоматизація **логіну** та **XML-фідів** у HUB. Репозиторій містить два набори тестів:

| Каталог | Мова | Призначення |
|---------|------|-------------|
| **tests-ts/** | TypeScript (Playwright) | **Основні тести** — логін та XML-фіди (додавання, валідація, налаштування) |
| **tests-Python/** | Python (pytest + Playwright) | **Legacy** — існуючі тести, нові кейси не додаються |

Секрети та конфіг: файл **`.env`** у **корені** репозиторію (скопіюйте з `.env.example`). Його використовують обидва підпроєкти.

---

## tests-ts (основні тести, TypeScript)

Нові тест-кейси пишуться лише тут.

**Встановлення:**
```bash
cd tests-ts
npm install
npx playwright install
```

**Запуск:**
```bash
cd tests-ts
npm run test              # всі тести
npm run test:headed        # з відкритим браузером
npx playwright test e2e/login.spec.ts
```

Детальніше: [tests-ts/README.md](tests-ts/README.md).

---

## tests-Python (legacy, Python)

Існуючі тести на pytest + Playwright. За потреби їх можна запускати окремо.

**Встановлення:**
```bash
cd tests-Python
pip install -r requirements.txt
playwright install
```

**Запуск** (з каталогу `tests-Python`):
```bash
pytest
pytest --headed -v
pytest tests/test_login.py -v
```

Детальніше: [tests-Python/README.md](tests-Python/README.md).

---

## Структура репозиторію

```
tests_e2e_hub_xml/
├── tests-ts/           # TypeScript, Playwright — логін та XML-фіди
│   ├── e2e/
│   ├── playwright.config.ts
│   └── package.json
├── tests-Python/       # Python, pytest — legacy
│   ├── tests/
│   ├── pages/, config/, locators/, utils/
│   ├── conftest.py
│   └── requirements.txt
├── reports/            # Звіти (обидва проєкти можуть писати сюди)
├── docs/
├── .env.example
└── README.md
```

---

## Налаштування секретів

Файл **`.env`** створюється в **корені** проєкту (не всередині tests-ts чи tests-Python).

- Скопіюйте `.env.example` у `.env` і заповніть значення.
- Файл `.env` не комітиться в Git.
- Потрібні змінні: `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`, `TEST_BASE_URL` / `TEST_LOGIN_URL` тощо (див. `.env.example`).

Детальніше: [docs/SECRETS_MANAGEMENT.md](docs/SECRETS_MANAGEMENT.md) (якщо є).

---

## Звіти

- **TypeScript (основні):** Allure Report. Після прогону: `cd tests-ts && npm run allure:generate && npm run allure:open` → http://localhost:9753/index.html. Детально: [docs/TEST_REPORTS.md](docs/TEST_REPORTS.md).
- **Python (legacy):** при запуску з `tests-Python` генерується `reports/report_YYYYMMDD_HHMMSS.html`.

Вся документація (POM, чеклист, секрети, репорти): [docs/](docs/).
