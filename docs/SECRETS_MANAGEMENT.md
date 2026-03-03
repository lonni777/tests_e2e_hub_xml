# Управління секретами (tests-ts, TypeScript)

Секрети (логіни, паролі, URL) **не зберігаються в коді** і **не комітяться** в Git. Вони підвантажуються під час виконання з файлу `.env` або змінних середовища.

---

## Принципи

1. **Секрети в `.env`** — локально для розробки та запуску тестів.
2. **`.env` в `.gitignore`** — файл не потрапляє в репозиторій.
3. **Змінні середовища** — для CI/CD (GitHub Actions, GitLab CI тощо) секрети задаються в налаштуваннях пайплайну.
4. **Один `.env` у корені** — його використовують і tests-ts, і (за потреби) tests-Python.

---

## Структура

```
tests_e2e_hub_xml/
├── .env              # Секрети (НЕ комітиться)
├── .env.example      # Шаблон (комітиться)
├── tests-ts/
│   ├── fixtures/
│   │   └── env.ts    # Читає .env і експортує testConfig
│   └── e2e/
│       └── *.spec.ts # Використовують testConfig
```

---

## Як це працює

1. **Розробник** створює у **корені** репо файл `.env` на основі `.env.example` і заповнює реальними значеннями.
2. **tests-ts** під час зборки/запуску підвантажує змінні через `dotenv` (налаштовано в `playwright.config.ts` або в `fixtures/env.ts`).
3. **fixtures/env.ts** експортує об’єкт `testConfig` з полями типу `loginUrl`, `userEmail`, `userPassword`, `xmlFeedsUrl`, `testExistingFeedId` тощо — усі значення беруться з `process.env`.
4. **Тести** імпортують `testConfig` і використовують його замість хардкоду.

---

## Кроки для команди

### 1. Створити `.env` локально

У корені репозиторію:

```bash
cp .env.example .env
# Відредагуйте .env і заповніть значення
```

### 2. Не комітити `.env`

Переконайтеся, що в `.gitignore` є рядок `.env` (у цьому проєкті вже є).

### 3. CI/CD

У налаштуваннях пайплайну додайте секрети як змінні середовища (наприклад GitHub Secrets, GitLab CI Variables). Playwright підхопить їх через `process.env`; при потребі можна явно підвантажити `.env` лише для локального запуску.

---

## Безпека

- **Не** комітьте `.env` у Git.
- **Не** діліться файлом `.env` через месенджери або email.
- Використовуйте **окремі облікові записи** для dev/test/prod.
- У CI використовуйте **захищені змінні** (Secrets) і не логуйте їх значення.

---

## Приклад використання в тесті

```typescript
import { testConfig } from '../fixtures/env';
import { LoginPage } from '../pages/LoginPage';

test('успішний логін', async ({ page }) => {
  const { loginUrl, userEmail, userPassword } = testConfig;
  if (!userEmail || !userPassword) {
    test.skip(true, 'TEST_USER_EMAIL та TEST_USER_PASSWORD потрібні в .env');
  }
  const loginPage = new LoginPage(page);
  await loginPage.navigateToLogin(loginUrl);
  await loginPage.login(userEmail!, userPassword!);
  await loginPage.verifySuccessfulLogin();
});
```

Список змінних і їх призначення: **`.env.example`** у корені репо та **`tests-ts/fixtures/env.ts`**. Чеклист перед запуском: [PRE_RUN_CHECKLIST.md](PRE_RUN_CHECKLIST.md).
