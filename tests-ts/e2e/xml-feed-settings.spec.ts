/**
 * Тести налаштувань XML-фідів (блок «Налаштування» на сторінці редагування фіду).
 * Один spec-файл — кілька тест-сьютів (describe) по кожній опції.
 * Cleanup: feedCleanup для фідів, створених у тестах.
 */
import { test, expect } from '../fixtures/feed-cleanup';
import { testConfig } from '../fixtures/env';
import { LoginPage } from '../pages/LoginPage';
import { XmlFeedPage } from '../pages/XmlFeedPage';
import { getSkuByOfferId, hasContentPendingSkusForFeed, updateFeedSettings } from '../utils/db-helper';

test.describe('XML-фіди: налаштування завантаження', () => {
  test.beforeEach(async ({ page }) => {
    const { loginUrl, userEmail, userPassword } = testConfig;
    if (!userEmail || !userPassword) return;
    const loginPage = new LoginPage(page);
    await loginPage.navigateToLogin(`${loginUrl}?next=/supplier-content/xml`);
    await loginPage.login(userEmail, userPassword);
    await loginPage.verifySuccessfulLogin();
  });

  test.describe('Завантажити товари з xml (поведінка при увімк/вимк)', () => {
    test('активний фід завантажує новинки', async ({ page, feedCleanup }) => {
      // Два feed load: перший ставить фото в Kafka, після паузи другий створює SKU з ContentPending (feed_image вже з resized_s3)
      test.setTimeout(720000); // 12 хв
      const {
        testSupplierName,
        xmlFeedsUrl,
        testXmlFeedUrl,
        triggerFeedloadUrl,
        triggerFeedloadAuth,
        dbHost,
        dbName,
      } = testConfig;

      if (!triggerFeedloadAuth) {
        test.skip(true, 'потрібен TEST_TRIGGER_FEEDLOAD_AUTH для виклику trigger-feedload');
        return;
      }
      if (!dbHost || !dbName) {
        test.skip(true, 'потрібні TEST_DB_HOST та TEST_DB_NAME для перевірки ContentPending в БД');
        return;
      }

      const xmlFeedPage = new XmlFeedPage(page);

      await xmlFeedPage.selectSupplier(testSupplierName);
      await xmlFeedPage.navigateToXmlFeedsViaMenu();
      await xmlFeedPage.clickAddNewFeedButton();
      await xmlFeedPage.fillFeedUrl(testXmlFeedUrl);
      await xmlFeedPage.enableUploadItemsCheckbox();
      await xmlFeedPage.clickSaveButton();
      await xmlFeedPage.verifySuccessMessage('Дані збережено!');

      await xmlFeedPage.navigateToFeedsTable(xmlFeedsUrl);
      await xmlFeedPage.filterFeedsByLink(testXmlFeedUrl);
      let feedId = await xmlFeedPage.getFeedIdFromFilteredTable();
      if (!feedId) feedId = await xmlFeedPage.getFeedIdByUrlFromTable(testXmlFeedUrl);
      expect(feedId, 'Має бути знайдено feed_id після збереження').toBeTruthy();
      if (feedId) feedCleanup.registerDelete(feedId);

      if (triggerFeedloadAuth && feedId) {
        // Відкриваємо фід через «Редагувати» і беремо URL з поля — як у БД (нормалізований)
        await xmlFeedPage.openFeedFromTableById(feedId);
        await page.waitForTimeout(2000);
        let originUrl = await xmlFeedPage.getFeedUrlFromInput();
        if (!originUrl) {
          await xmlFeedPage.openFeedForEditing(feedId);
          await page.waitForTimeout(1000);
          originUrl = await xmlFeedPage.getFeedUrlFromInput();
        }
        if (!originUrl.includes('#ufeed')) {
          originUrl = `${originUrl.replace(/#.*$/, '')}#ufeed${feedId}`;
        }
        expect(originUrl, 'Має бути отримано origin_url з форми фіду').toBeTruthy();

        const trigger = (url: string) =>
          fetch(triggerFeedloadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: triggerFeedloadAuth },
            body: JSON.stringify({ origin_url: url }),
          });

        // 1) Перший feed load: парсинг, фото йдуть в Kafka (SKU не створюються — OFFER_PICTURES_WAIT)
        let response = await trigger(originUrl);
        expect(
          response.ok,
          `trigger-feedload (1) має повернути успішний статус, отримано: ${response.status}`,
        ).toBe(true);

        // 2) Чекаємо обробки фото в Kafka (feed_image отримує resized_s3), орієнтовно 3–5 хв
        const kafkaWaitMs = 5 * 60 * 1000; // 5 хв
        await page.waitForTimeout(kafkaWaitMs);

        // 3) Другий feed load: get-img-entry вже бачить resized_s3 → створюються SKU з ContentPending
        response = await trigger(originUrl);
        expect(
          response.ok,
          `trigger-feedload (2) має повернути успішний статус, отримано: ${response.status}`,
        ).toBe(true);

        // 4) Після другого завантаження чекаємо появу хоча б одного SKU з ContentPending
        const maxAttempts = 12; // до ~3 хв
        const delayMs = 15000;
        let hasPending = false;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await page.waitForTimeout(delayMs);
          hasPending = await hasContentPendingSkusForFeed(feedId);
          if (hasPending) break;
        }

        expect(
          hasPending,
          'Після другого завантаження фіду має з’явитися хоча б один SKU зі статусом ContentPending (upload_source=feed, не видалений)',
        ).toBe(true);
      }
    });

    test('вимкнення фіда блокує нові завантаження', async ({ page, feedCleanup }) => {
      test.setTimeout(120000);
      const {
        testSupplierName,
        xmlFeedsUrl,
        testXmlFeedTwoVersionsUrl,
        triggerFeedloadUrl,
        triggerFeedloadAuth,
      } = testConfig;
      if (!triggerFeedloadAuth) {
        test.skip(true, 'потрібен TEST_TRIGGER_FEEDLOAD_AUTH для виклику trigger-feedload');
        return;
      }
      const xmlFeedPage = new XmlFeedPage(page);

      // 1. Створюємо фід з URL, що повертає спочатку 1 товар, потім 2 (mock на 9877)
      await xmlFeedPage.selectSupplier(testSupplierName);
      await xmlFeedPage.navigateToXmlFeedsViaMenu();
      await xmlFeedPage.clickAddNewFeedButton();
      await xmlFeedPage.fillFeedUrl(testXmlFeedTwoVersionsUrl);
      await xmlFeedPage.enableUploadItemsCheckbox();
      await xmlFeedPage.clickSaveButton();
      await xmlFeedPage.verifySuccessMessage('Дані збережено!');

      await xmlFeedPage.navigateToFeedsTable(xmlFeedsUrl);
      await xmlFeedPage.filterFeedsByLink(testXmlFeedTwoVersionsUrl);
      let feedId = await xmlFeedPage.getFeedIdFromFilteredTable();
      if (!feedId) feedId = await xmlFeedPage.getFeedIdByUrlFromTable(testXmlFeedTwoVersionsUrl);
      expect(feedId, 'Має бути знайдено feed_id').toBeTruthy();
      if (feedId) feedCleanup.registerDelete(feedId);

      const feedUrlForTrigger = testXmlFeedTwoVersionsUrl.replace(/#.*$/, '');
      const originUrl = `${feedUrlForTrigger}#ufeed${feedId}`;

      // 2. Перший trigger: бекенд завантажує фід → mock повертає 1 товар (blocked-test-1)
      let response = await fetch(triggerFeedloadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: triggerFeedloadAuth },
        body: JSON.stringify({ origin_url: originUrl }),
      });
      expect(response.ok, `trigger-feedload 1: ${response.status}`).toBe(true);
      await page.waitForTimeout(15000);

      // 3. Вимикаємо «Завантажити товари з xml», зберігаємо
      await xmlFeedPage.openFeedForEditing(feedId!);
      await xmlFeedPage.disableUploadItemsCheckbox();
      await xmlFeedPage.clickSaveButton();
      await xmlFeedPage.verifySuccessMessage('Дані збережено!');

      // 4. Другий trigger: бекенд знову завантажує фід → mock повертає 2 товари; новий товар (blocked-test-2) не повинен імпортуватися
      response = await fetch(triggerFeedloadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: triggerFeedloadAuth },
        body: JSON.stringify({ origin_url: originUrl }),
      });
      expect(response.ok, `trigger-feedload 2: ${response.status}`).toBe(true);
      await page.waitForTimeout(15000);

      // 5. Перевірка: на сторінці фіду / звіті не має з’являтися SKU blocked-test-2 (він лише в XML при другому запиті, імпорт має бути заблокований)
      await xmlFeedPage.openFeedForEditing(feedId!);
      await page.waitForTimeout(3000);
      const bodyText = (await page.locator('body').textContent()) || '';
      expect(
        bodyText.includes('blocked-test-2'),
        'При вимкненому «Завантажити товари з xml» новий товар (blocked-test-2) не повинен з’явитися у звіті/сторінці',
      ).toBe(false);
    });

    test('TC-ZSNF-01A: zero_stock_when_not_found (SP-фід Parfums R3S0): товар зникає з фіда → сток 0 → повертається у фід → сток відновлюється', async ({
      page,
    }) => {
      test.setTimeout(600000); // 10 хв
      const {
        loginUrl,
        userEmail,
        userPassword,
        testSupplierName,
        xmlFeedsUrl,
        triggerFeedloadUrl,
        triggerFeedloadAuth,
        dbHost,
        dbName,
        testZeroStockFeedUrl,
        testZeroStockFeedId,
        testZeroStockTargetOfferId,
        testZeroStockControlOfferId,
      } = testConfig;

      if (!userEmail || !userPassword) {
        test.skip(true, 'потрібні TEST_USER_EMAIL та TEST_USER_PASSWORD для логіну в HUB');
        return;
      }
      if (!triggerFeedloadAuth) {
        test.skip(true, 'потрібен TEST_TRIGGER_FEEDLOAD_AUTH для виклику trigger-feedload');
        return;
      }
      if (!dbHost || !dbName) {
        test.skip(true, 'потрібні TEST_DB_HOST та TEST_DB_NAME для перевірки стоків у БД');
        return;
      }

      const loginPage = new LoginPage(page);
      await loginPage.navigateToLogin(`${loginUrl}?next=/supplier-content/xml`);
      await loginPage.login(userEmail, userPassword);
      await loginPage.verifySuccessfulLogin();

      const xmlFeedPage = new XmlFeedPage(page);

      // 1. Відкриваємо існуючий SP-фід Парфюмс (R3S0) і отримуємо origin_url як у БД
      await xmlFeedPage.selectSupplier(testSupplierName);
      await xmlFeedPage.navigateToFeedsTable(xmlFeedsUrl);
      await xmlFeedPage.filterFeedsByLink(testZeroStockFeedUrl);
      let feedId = await xmlFeedPage.getFeedIdFromFilteredTable();
      if (!feedId) {
        feedId = await xmlFeedPage.getFeedIdByUrlFromTable(testZeroStockFeedUrl);
      }
      expect(feedId, 'Має бути знайдено feed_id для тестового фіда Парфюмс').toBeTruthy();
      expect(feedId, 'Очікується, що feed_id дорівнює testZeroStockFeedId').toBe(testZeroStockFeedId);

      // Виставляємо конфіг: SP-фід, zero_stock_when_not_found=true, update_stock=true, is_active=true
      await updateFeedSettings(feedId!, {
        sp_feed_enabled: true,
        zero_stock_when_not_found: true,
        update_stock: true,
        is_active: true,
      });

      await xmlFeedPage.openFeedFromTableById(feedId!);
      await page.waitForTimeout(2000);
      let originUrl = await xmlFeedPage.getFeedUrlFromInput();
      if (!originUrl) {
        await xmlFeedPage.openFeedForEditing(feedId!);
        await page.waitForTimeout(1000);
        originUrl = await xmlFeedPage.getFeedUrlFromInput();
      }
      if (!originUrl?.includes('#ufeed')) {
        originUrl = `${originUrl!.replace(/#.*$/, '')}#ufeed${feedId}`;
      }
      expect(originUrl, 'Має бути отримано origin_url з форми фіду').toBeTruthy();

      const trigger = (url: string) =>
        fetch(triggerFeedloadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: triggerFeedloadAuth },
          body: JSON.stringify({ origin_url: url }),
        });

      const waitForStock = async (offerId: string, predicate: (stock: number) => boolean, timeoutMs: number) => {
        const started = Date.now();
        let lastStock: number | null = null;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const sku = await getSkuByOfferId(offerId);
          if (sku) {
            lastStock = sku.stock;
            if (predicate(sku.stock)) {
              return sku.stock;
            }
          }

          if (Date.now() - started > timeoutMs) {
            throw new Error(
              `Не вдалося дочекатися потрібного стоку для offer_id=${offerId}. Останнє значення: ${lastStock}`,
            );
          }

          await page.waitForTimeout(10000);
        }
      };

      // 2. Перший запуск: обидва офери присутні у фіді → target і control мають сток > 0
      let response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (1) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock1 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );
      const controlStock1 = await waitForStock(
        testZeroStockControlOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock1,
        `Очікується, що початковий сток для target offer (${testZeroStockTargetOfferId}) > 0`,
      ).toBeGreaterThan(0);
      expect(
        controlStock1,
        `Очікується, що початковий сток для control offer (${testZeroStockControlOfferId}) > 0`,
      ).toBeGreaterThan(0);

      // 3. Другий запуск: backend-мок/скрипт ховає target offer з XML → очікуємо сток 0 для target, control без змін
      response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (2) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock2 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s === 0,
        5 * 60 * 1000,
      );
      const controlStock2 = await waitForStock(
        testZeroStockControlOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock2,
        `Після другого завантаження фіда target offer (${testZeroStockTargetOfferId}) має отримати сток 0`,
      ).toBe(0);
      expect(
        controlStock2,
        `Control offer (${testZeroStockControlOfferId}) повинен залишатися з позитивним стоком після другого завантаження`,
      ).toBeGreaterThan(0);

      // 4. Третій запуск: backend-мок/скрипт знову повертає target offer у XML → очікуємо сток > 0
      response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (3) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock3 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock3,
        `Після третього завантаження фіда target offer (${testZeroStockTargetOfferId}) має знову отримати сток > 0`,
      ).toBeGreaterThan(0);
    });

    test('TC-ZSNF-01B: zero_stock_when_not_found (звичайний фід, update_stock=true): товар зникає з фіда → сток 0 → повертається у фід → сток відновлюється', async ({
      page,
    }) => {
      test.setTimeout(600000); // 10 хв
      const {
        loginUrl,
        userEmail,
        userPassword,
        testSupplierName,
        xmlFeedsUrl,
        triggerFeedloadUrl,
        triggerFeedloadAuth,
        dbHost,
        dbName,
        testZeroStockFeedUrl,
        testZeroStockFeedId,
        testZeroStockTargetOfferId,
        testZeroStockControlOfferId,
      } = testConfig;

      if (!userEmail || !userPassword) {
        test.skip(true, 'потрібні TEST_USER_EMAIL та TEST_USER_PASSWORD для логіну в HUB');
        return;
      }
      if (!triggerFeedloadAuth) {
        test.skip(true, 'потрібен TEST_TRIGGER_FEEDLOAD_AUTH для виклику trigger-feedload');
        return;
      }
      if (!dbHost || !dbName) {
        test.skip(true, 'потрібні TEST_DB_HOST та TEST_DB_NAME для перевірки стоків у БД');
        return;
      }

      const loginPage = new LoginPage(page);
      await loginPage.navigateToLogin(`${loginUrl}?next=/supplier-content/xml`);
      await loginPage.login(userEmail, userPassword);
      await loginPage.verifySuccessfulLogin();

      const xmlFeedPage = new XmlFeedPage(page);

      await xmlFeedPage.selectSupplier(testSupplierName);
      await xmlFeedPage.navigateToFeedsTable(xmlFeedsUrl);
      await xmlFeedPage.filterFeedsByLink(testZeroStockFeedUrl);
      let feedId = await xmlFeedPage.getFeedIdFromFilteredTable();
      if (!feedId) {
        feedId = await xmlFeedPage.getFeedIdByUrlFromTable(testZeroStockFeedUrl);
      }
      expect(feedId, 'Має бути знайдено feed_id для тестового фіда Парфюмс').toBeTruthy();
      expect(feedId, 'Очікується, що feed_id дорівнює testZeroStockFeedId').toBe(testZeroStockFeedId);

      // Конфіг для звичайного фіда: SP вимкнено, zero_stock_when_not_found=true, update_stock=true
      await updateFeedSettings(feedId!, {
        sp_feed_enabled: false,
        zero_stock_when_not_found: true,
        update_stock: true,
        is_active: true,
      });

      await xmlFeedPage.openFeedFromTableById(feedId!);
      await page.waitForTimeout(2000);
      let originUrl = await xmlFeedPage.getFeedUrlFromInput();
      if (!originUrl) {
        await xmlFeedPage.openFeedForEditing(feedId!);
        await page.waitForTimeout(1000);
        originUrl = await xmlFeedPage.getFeedUrlFromInput();
      }
      if (!originUrl?.includes('#ufeed')) {
        originUrl = `${originUrl!.replace(/#.*$/, '')}#ufeed${feedId}`;
      }
      expect(originUrl, 'Має бути отримано origin_url з форми фіду').toBeTruthy();

      const trigger = (url: string) =>
        fetch(triggerFeedloadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: triggerFeedloadAuth },
          body: JSON.stringify({ origin_url: url }),
        });

      const waitForStock = async (offerId: string, predicate: (stock: number) => boolean, timeoutMs: number) => {
        const started = Date.now();
        let lastStock: number | null = null;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const sku = await getSkuByOfferId(offerId);
          if (sku) {
            lastStock = sku.stock;
            if (predicate(sku.stock)) {
              return sku.stock;
            }
          }

          if (Date.now() - started > timeoutMs) {
            throw new Error(
              `Не вдалося дочекатися потрібного стоку для offer_id=${offerId}. Останнє значення: ${lastStock}`,
            );
          }

          await page.waitForTimeout(10000);
        }
      };

      // 1. Перший запуск: обидва офери присутні → сток > 0
      let response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (1) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock1 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );
      const controlStock1 = await waitForStock(
        testZeroStockControlOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock1,
        `Очікується, що початковий сток для target offer (${testZeroStockTargetOfferId}) > 0`,
      ).toBeGreaterThan(0);
      expect(
        controlStock1,
        `Очікується, що початковий сток для control offer (${testZeroStockControlOfferId}) > 0`,
      ).toBeGreaterThan(0);

      // 2. Другий запуск: target offer зникає з XML → очікуємо сток 0 для target, control без змін
      response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (2) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock2 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s === 0,
        5 * 60 * 1000,
      );
      const controlStock2 = await waitForStock(
        testZeroStockControlOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock2,
        `Після другого завантаження фіда target offer (${testZeroStockTargetOfferId}) має отримати сток 0`,
      ).toBe(0);
      expect(
        controlStock2,
        `Control offer (${testZeroStockControlOfferId}) повинен залишатися з позитивним стоком після другого завантаження`,
      ).toBeGreaterThan(0);

      // 3. Третій запуск: target offer повертається у XML → очікуємо сток > 0
      response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (3) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock3 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock3,
        `Після третього завантаження фіда target offer (${testZeroStockTargetOfferId}) має знову отримати сток > 0`,
      ).toBeGreaterThan(0);
    });

    test('TC-ZSNF-02: zero_stock_when_not_found вимкнено — товари не знімаються з продажу', async ({
      page,
    }) => {
      test.setTimeout(600000); // 10 хв
      const {
        loginUrl,
        userEmail,
        userPassword,
        testSupplierName,
        xmlFeedsUrl,
        triggerFeedloadUrl,
        triggerFeedloadAuth,
        dbHost,
        dbName,
        testZeroStockFeedUrl,
        testZeroStockFeedId,
        testZeroStockTargetOfferId,
        testZeroStockControlOfferId,
      } = testConfig;

      if (!userEmail || !userPassword) {
        test.skip(true, 'потрібні TEST_USER_EMAIL та TEST_USER_PASSWORD для логіну в HUB');
        return;
      }
      if (!triggerFeedloadAuth) {
        test.skip(true, 'потрібен TEST_TRIGGER_FEEDLOAD_AUTH для виклику trigger-feedload');
        return;
      }
      if (!dbHost || !dbName) {
        test.skip(true, 'потрібні TEST_DB_HOST та TEST_DB_NAME для перевірки стоків у БД');
        return;
      }

      const loginPage = new LoginPage(page);
      await loginPage.navigateToLogin(`${loginUrl}?next=/supplier-content/xml`);
      await loginPage.login(userEmail, userPassword);
      await loginPage.verifySuccessfulLogin();

      const xmlFeedPage = new XmlFeedPage(page);

      await xmlFeedPage.selectSupplier(testSupplierName);
      await xmlFeedPage.navigateToFeedsTable(xmlFeedsUrl);
      await xmlFeedPage.filterFeedsByLink(testZeroStockFeedUrl);
      let feedId = await xmlFeedPage.getFeedIdFromFilteredTable();
      if (!feedId) {
        feedId = await xmlFeedPage.getFeedIdByUrlFromTable(testZeroStockFeedUrl);
      }
      expect(feedId, 'Має бути знайдено feed_id для тестового фіда Парфюмс').toBeTruthy();
      expect(feedId, 'Очікується, що feed_id дорівнює testZeroStockFeedId').toBe(testZeroStockFeedId);

      // Конфіг: SP вимкнено, zero_stock_when_not_found=false, update_stock=true
      await updateFeedSettings(feedId!, {
        sp_feed_enabled: false,
        zero_stock_when_not_found: false,
        update_stock: true,
        is_active: true,
      });

      await xmlFeedPage.openFeedFromTableById(feedId!);
      await page.waitForTimeout(2000);
      let originUrl = await xmlFeedPage.getFeedUrlFromInput();
      if (!originUrl) {
        await xmlFeedPage.openFeedForEditing(feedId!);
        await page.waitForTimeout(1000);
        originUrl = await xmlFeedPage.getFeedUrlFromInput();
      }
      if (!originUrl?.includes('#ufeed')) {
        originUrl = `${originUrl!.replace(/#.*$/, '')}#ufeed${feedId}`;
      }
      expect(originUrl, 'Має бути отримано origin_url з форми фіду').toBeTruthy();

      const trigger = (url: string) =>
        fetch(triggerFeedloadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: triggerFeedloadAuth },
          body: JSON.stringify({ origin_url: url }),
        });

      const waitForStock = async (offerId: string, predicate: (stock: number) => boolean, timeoutMs: number) => {
        const started = Date.now();
        let lastStock: number | null = null;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const sku = await getSkuByOfferId(offerId);
          if (sku) {
            lastStock = sku.stock;
            if (predicate(sku.stock)) {
              return sku.stock;
            }
          }

          if (Date.now() - started > timeoutMs) {
            throw new Error(
              `Не вдалося дочекатися потрібного стоку для offer_id=${offerId}. Останнє значення: ${lastStock}`,
            );
          }

          await page.waitForTimeout(10000);
        }
      };

      // 1. Перший запуск: обидва офери присутні → сток > 0
      let response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (1) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock1 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );
      const controlStock1 = await waitForStock(
        testZeroStockControlOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock1,
        `Очікується, що початковий сток для target offer (${testZeroStockTargetOfferId}) > 0`,
      ).toBeGreaterThan(0);
      expect(
        controlStock1,
        `Очікується, що початковий сток для control offer (${testZeroStockControlOfferId}) > 0`,
      ).toBeGreaterThan(0);

      // 2. Другий запуск: target offer зникає з XML → zero_stock_when_not_found=false, тому сток НЕ має ставати 0
      response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (2) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock2 = await waitForStock(
        testZeroStockTargetOfferId,
        // очікуємо, що сток залишиться > 0, а не стане 0
        (s) => s > 0,
        5 * 60 * 1000,
      );
      const controlStock2 = await waitForStock(
        testZeroStockControlOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock2,
        `Після другого завантаження фіда при zero_stock_when_not_found=false target offer (${testZeroStockTargetOfferId}) не має отримати сток 0`,
      ).toBeGreaterThan(0);
      expect(
        controlStock2,
        `Control offer (${testZeroStockControlOfferId}) повинен залишатися з позитивним стоком після другого завантаження`,
      ).toBeGreaterThan(0);
    });

    test('TC-ZSNF-03: zero_stock_when_not_found обнуляє сток тільки для товарів з цього фіда (перевірка на рівні control offer)', async ({
      page,
    }) => {
      test.setTimeout(600000);
      const {
        loginUrl,
        userEmail,
        userPassword,
        testSupplierName,
        xmlFeedsUrl,
        triggerFeedloadUrl,
        triggerFeedloadAuth,
        dbHost,
        dbName,
        testZeroStockFeedUrl,
        testZeroStockFeedId,
        testZeroStockTargetOfferId,
        testZeroStockControlOfferId,
      } = testConfig;

      if (!userEmail || !userPassword) {
        test.skip(true, 'потрібні TEST_USER_EMAIL та TEST_USER_PASSWORD для логіну в HUB');
        return;
      }
      if (!triggerFeedloadAuth) {
        test.skip(true, 'потрібен TEST_TRIGGER_FEEDLOAD_AUTH для виклику trigger-feedload');
        return;
      }
      if (!dbHost || !dbName) {
        test.skip(true, 'потрібні TEST_DB_HOST та TEST_DB_NAME для перевірки стоків у БД');
        return;
      }

      const loginPage = new LoginPage(page);
      await loginPage.navigateToLogin(`${loginUrl}?next=/supplier-content/xml`);
      await loginPage.login(userEmail, userPassword);
      await loginPage.verifySuccessfulLogin();

      const xmlFeedPage = new XmlFeedPage(page);

      await xmlFeedPage.selectSupplier(testSupplierName);
      await xmlFeedPage.navigateToFeedsTable(xmlFeedsUrl);
      await xmlFeedPage.filterFeedsByLink(testZeroStockFeedUrl);
      let feedId = await xmlFeedPage.getFeedIdFromFilteredTable();
      if (!feedId) {
        feedId = await xmlFeedPage.getFeedIdByUrlFromTable(testZeroStockFeedUrl);
      }
      expect(feedId, 'Має бути знайдено feed_id для тестового фіда Парфюмс').toBeTruthy();
      expect(feedId, 'Очікується, що feed_id дорівнює testZeroStockFeedId').toBe(testZeroStockFeedId);

      // Конфіг: zero_stock_when_not_found=true
      await updateFeedSettings(feedId!, {
        sp_feed_enabled: true,
        zero_stock_when_not_found: true,
        update_stock: true,
        is_active: true,
      });

      await xmlFeedPage.openFeedFromTableById(feedId!);
      await page.waitForTimeout(2000);
      let originUrl = await xmlFeedPage.getFeedUrlFromInput();
      if (!originUrl) {
        await xmlFeedPage.openFeedForEditing(feedId!);
        await page.waitForTimeout(1000);
        originUrl = await xmlFeedPage.getFeedUrlFromInput();
      }
      if (!originUrl?.includes('#ufeed')) {
        originUrl = `${originUrl!.replace(/#.*$/, '')}#ufeed${feedId}`;
      }
      expect(originUrl, 'Має бути отримано origin_url з форми фіду').toBeTruthy();

      const trigger = (url: string) =>
        fetch(triggerFeedloadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: triggerFeedloadAuth },
          body: JSON.stringify({ origin_url: url }),
        });

      const waitForStock = async (offerId: string, predicate: (stock: number) => boolean, timeoutMs: number) => {
        const started = Date.now();
        let lastStock: number | null = null;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const sku = await getSkuByOfferId(offerId);
          if (sku) {
            lastStock = sku.stock;
            if (predicate(sku.stock)) {
              return sku.stock;
            }
          }

          if (Date.now() - started > timeoutMs) {
            throw new Error(
              `Не вдалося дочекатися потрібного стоку для offer_id=${offerId}. Останнє значення: ${lastStock}`,
            );
          }

          await page.waitForTimeout(10000);
        }
      };

      // 1. Перший запуск: обидва офери присутні → сток > 0
      let response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (1) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock1 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );
      const controlStock1 = await waitForStock(
        testZeroStockControlOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock1,
        `Очікується, що початковий сток для target offer (${testZeroStockTargetOfferId}) > 0`,
      ).toBeGreaterThan(0);
      expect(
        controlStock1,
        `Очікується, що початковий сток для control offer (${testZeroStockControlOfferId}) > 0`,
      ).toBeGreaterThan(0);

      // 2. Другий запуск: target offer зникає з XML → очікуємо сток 0 для target, control без змін
      response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (2) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock2 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s === 0,
        5 * 60 * 1000,
      );
      const controlStock2 = await waitForStock(
        testZeroStockControlOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock2,
        `Після другого завантаження фіда target offer (${testZeroStockTargetOfferId}) має отримати сток 0`,
      ).toBe(0);
      expect(
        controlStock2,
        `Control offer (${testZeroStockControlOfferId}) повинен залишатися з позитивним стоком після другого завантаження`,
      ).toBeGreaterThan(0);
    });

    test('TC-ZSNF-01C: zero_stock_when_not_found (звичайний фід, update_stock=false): товар зникає з фіда → сток 0 → повертається у фід → сток відновлюється', async ({
      page,
    }) => {
      test.setTimeout(600000); // 10 хв
      const {
        loginUrl,
        userEmail,
        userPassword,
        testSupplierName,
        xmlFeedsUrl,
        triggerFeedloadUrl,
        triggerFeedloadAuth,
        dbHost,
        dbName,
        testZeroStockFeedUrl,
        testZeroStockFeedId,
        testZeroStockTargetOfferId,
        testZeroStockControlOfferId,
      } = testConfig;

      if (!userEmail || !userPassword) {
        test.skip(true, 'потрібні TEST_USER_EMAIL та TEST_USER_PASSWORD для логіну в HUB');
        return;
      }
      if (!triggerFeedloadAuth) {
        test.skip(true, 'потрібен TEST_TRIGGER_FEEDLOAD_AUTH для виклику trigger-feedload');
        return;
      }
      if (!dbHost || !dbName) {
        test.skip(true, 'потрібні TEST_DB_HOST та TEST_DB_NAME для перевірки стоків у БД');
        return;
      }

      const loginPage = new LoginPage(page);
      await loginPage.navigateToLogin(`${loginUrl}?next=/supplier-content/xml`);
      await loginPage.login(userEmail, userPassword);
      await loginPage.verifySuccessfulLogin();

      const xmlFeedPage = new XmlFeedPage(page);

      await xmlFeedPage.selectSupplier(testSupplierName);
      await xmlFeedPage.navigateToFeedsTable(xmlFeedsUrl);
      await xmlFeedPage.filterFeedsByLink(testZeroStockFeedUrl);
      let feedId = await xmlFeedPage.getFeedIdFromFilteredTable();
      if (!feedId) {
        feedId = await xmlFeedPage.getFeedIdByUrlFromTable(testZeroStockFeedUrl);
      }
      expect(feedId, 'Має бути знайдено feed_id для тестового фіда Парфюмс').toBeTruthy();
      expect(feedId, 'Очікується, що feed_id дорівнює testZeroStockFeedId').toBe(testZeroStockFeedId);

      // Конфіг для звичайного фіда: SP вимкнено, zero_stock_when_not_found=true, update_stock=false
      await updateFeedSettings(feedId!, {
        sp_feed_enabled: false,
        zero_stock_when_not_found: true,
        update_stock: false,
        is_active: true,
      });

      await xmlFeedPage.openFeedFromTableById(feedId!);
      await page.waitForTimeout(2000);
      let originUrl = await xmlFeedPage.getFeedUrlFromInput();
      if (!originUrl) {
        await xmlFeedPage.openFeedForEditing(feedId!);
        await page.waitForTimeout(1000);
        originUrl = await xmlFeedPage.getFeedUrlFromInput();
      }
      if (!originUrl?.includes('#ufeed')) {
        originUrl = `${originUrl!.replace(/#.*$/, '')}#ufeed${feedId}`;
      }
      expect(originUrl, 'Має бути отримано origin_url з форми фіду').toBeTruthy();

      const trigger = (url: string) =>
        fetch(triggerFeedloadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: triggerFeedloadAuth },
          body: JSON.stringify({ origin_url: url }),
        });

      const waitForStock = async (offerId: string, predicate: (stock: number) => boolean, timeoutMs: number) => {
        const started = Date.now();
        let lastStock: number | null = null;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const sku = await getSkuByOfferId(offerId);
          if (sku) {
            lastStock = sku.stock;
            if (predicate(sku.stock)) {
              return sku.stock;
            }
          }

          if (Date.now() - started > timeoutMs) {
            throw new Error(
              `Не вдалося дочекатися потрібного стоку для offer_id=${offerId}. Останнє значення: ${lastStock}`,
            );
          }

          await page.waitForTimeout(10000);
        }
      };

      // 1. Перший запуск: обидва офери присутні → сток > 0
      let response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (1) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock1 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );
      const controlStock1 = await waitForStock(
        testZeroStockControlOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock1,
        `Очікується, що початковий сток для target offer (${testZeroStockTargetOfferId}) > 0`,
      ).toBeGreaterThan(0);
      expect(
        controlStock1,
        `Очікується, що початковий сток для control offer (${testZeroStockControlOfferId}) > 0`,
      ).toBeGreaterThan(0);

      // 2. Другий запуск: target offer зникає з XML → очікуємо сток 0 для target, control без змін
      response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (2) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock2 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s === 0,
        5 * 60 * 1000,
      );
      const controlStock2 = await waitForStock(
        testZeroStockControlOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock2,
        `Після другого завантаження фіда target offer (${testZeroStockTargetOfferId}) має отримати сток 0`,
      ).toBe(0);
      expect(
        controlStock2,
        `Control offer (${testZeroStockControlOfferId}) повинен залишатися з позитивним стоком після другого завантаження`,
      ).toBeGreaterThan(0);

      // 3. Третій запуск: target offer повертається у XML → очікуємо сток > 0
      response = await trigger(originUrl!);
      expect(
        response.ok,
        `trigger-feedload (3) має повернути успішний статус, отримано: ${response.status}`,
      ).toBe(true);

      const targetStock3 = await waitForStock(
        testZeroStockTargetOfferId,
        (s) => s > 0,
        5 * 60 * 1000,
      );

      expect(
        targetStock3,
        `Після третього завантаження фіда target offer (${testZeroStockTargetOfferId}) має знову отримати сток > 0`,
      ).toBeGreaterThan(0);
    });

    test('TC-ZSNF-07: вимкнений / не запущений фід не змінює стоки (зміна тільки налаштувань в UI)', async ({ page }) => {
      test.setTimeout(300000);
      const {
        loginUrl,
        userEmail,
        userPassword,
        testSupplierName,
        xmlFeedsUrl,
        dbHost,
        dbName,
        testZeroStockFeedUrl,
        testZeroStockFeedId,
        testZeroStockTargetOfferId,
      } = testConfig;

      if (!userEmail || !userPassword) {
        test.skip(true, 'потрібні TEST_USER_EMAIL та TEST_USER_PASSWORD для логіну в HUB');
        return;
      }
      if (!dbHost || !dbName) {
        test.skip(true, 'потрібні TEST_DB_HOST та TEST_DB_NAME для перевірки стоків у БД');
        return;
      }

      const loginPage = new LoginPage(page);
      await loginPage.navigateToLogin(`${loginUrl}?next=/supplier-content/xml`);
      await loginPage.login(userEmail, userPassword);
      await loginPage.verifySuccessfulLogin();

      const xmlFeedPage = new XmlFeedPage(page);

      await xmlFeedPage.selectSupplier(testSupplierName);
      await xmlFeedPage.navigateToFeedsTable(xmlFeedsUrl);
      await xmlFeedPage.filterFeedsByLink(testZeroStockFeedUrl);
      let feedId = await xmlFeedPage.getFeedIdFromFilteredTable();
      if (!feedId) {
        feedId = await xmlFeedPage.getFeedIdByUrlFromTable(testZeroStockFeedUrl);
      }
      expect(feedId, 'Має бути знайдено feed_id для тестового фіда Парфюмс').toBeTruthy();
      expect(feedId, 'Очікується, що feed_id дорівнює testZeroStockFeedId').toBe(testZeroStockFeedId);

      const beforeSku = await getSkuByOfferId(testZeroStockTargetOfferId);
      expect(beforeSku, `SKU для offer_id=${testZeroStockTargetOfferId} має існувати до зміни налаштувань`).not.toBeNull();
      const beforeStock = beforeSku!.stock;

      // 1. Вимикаємо «Завантажити товари з xml» (фід не повинен запускатися автоматично)
      await xmlFeedPage.openFeedFromTableById(feedId!);
      await page.waitForTimeout(2000);
      await xmlFeedPage.disableUploadItemsCheckbox();
      await xmlFeedPage.clickSaveButton();
      await xmlFeedPage.verifySuccessMessage('Дані збережено!');

      // 2. Не запускаємо trigger-feedload / cron у рамках цього тесту, просто чекаємо й перевіряємо сток
      await page.waitForTimeout(30000);

      const afterSku = await getSkuByOfferId(testZeroStockTargetOfferId);
      expect(afterSku, `SKU для offer_id=${testZeroStockTargetOfferId} має існувати після зміни налаштувань`).not.toBeNull();

      expect(
        afterSku!.stock,
        'При відсутності запуску фіда зміна лише налаштувань в UI не має змінювати сток товару',
      ).toBe(beforeStock);
    });

    test('TC-ZSNF-08: UI прапорця «Зняти з продажу товари, які відсутні в фіді»', async ({ page }) => {
      test.setTimeout(300000);
      const {
        loginUrl,
        userEmail,
        userPassword,
        testSupplierName,
        xmlFeedsUrl,
        testZeroStockFeedUrl,
        testZeroStockFeedId,
      } = testConfig;

      if (!userEmail || !userPassword) {
        test.skip(true, 'потрібні TEST_USER_EMAIL та TEST_USER_PASSWORD для логіну в HUB');
        return;
      }

      const loginPage = new LoginPage(page);
      await loginPage.navigateToLogin(`${loginUrl}?next=/supplier-content/xml`);
      await loginPage.login(userEmail, userPassword);
      await loginPage.verifySuccessfulLogin();

      const xmlFeedPage = new XmlFeedPage(page);

      await xmlFeedPage.selectSupplier(testSupplierName);
      await xmlFeedPage.navigateToFeedsTable(xmlFeedsUrl);
      await xmlFeedPage.filterFeedsByLink(testZeroStockFeedUrl);
      let feedId = await xmlFeedPage.getFeedIdFromFilteredTable();
      if (!feedId) {
        feedId = await xmlFeedPage.getFeedIdByUrlFromTable(testZeroStockFeedUrl);
      }
      expect(feedId, 'Має бути знайдено feed_id для тестового фіда Парфюмс').toBeTruthy();
      expect(feedId, 'Очікується, що feed_id дорівнює testZeroStockFeedId').toBe(testZeroStockFeedId);

      // 1. Вмикаємо прапорець у UI, зберігаємо й перевіряємо, що після повторного відкриття він залишився ввімкненим
      await xmlFeedPage.openFeedFromTableById(feedId!);
      await page.waitForTimeout(2000);
      await xmlFeedPage.setZeroStockWhenNotFoundCheckbox(true);
      await xmlFeedPage.clickSaveButton();
      await xmlFeedPage.verifySuccessMessage('Дані збережено!');

      await xmlFeedPage.openFeedFromTableById(feedId!);
      await page.waitForTimeout(2000);
      const checkedAfterEnable = await xmlFeedPage.isZeroStockWhenNotFoundChecked();
      expect(
        checkedAfterEnable,
        'Після збереження з увімкненим прапорцем «Зняти з продажу…» чекбокс має залишатися ввімкненим',
      ).toBe(true);

      // 2. Вимикаємо прапорець у UI, зберігаємо й перевіряємо, що після повторного відкриття він залишився вимкненим
      await xmlFeedPage.setZeroStockWhenNotFoundCheckbox(false);
      await xmlFeedPage.clickSaveButton();
      await xmlFeedPage.verifySuccessMessage('Дані збережено!');

      await xmlFeedPage.openFeedFromTableById(feedId!);
      await page.waitForTimeout(2000);
      const checkedAfterDisable = await xmlFeedPage.isZeroStockWhenNotFoundChecked();
      expect(
        checkedAfterDisable,
        'Після збереження з вимкненим прапорцем «Зняти з продажу…» чекбокс має залишатися вимкненим',
      ).toBe(false);
    });

    test('вимкнений фід призупиняє оновлення контенту', async ({ page, feedCleanup }) => {
      test.skip(true, 'фід з оновленням контенту → зняти чекбокс → змінити XML опис → значення не оновлюються');
    });

    test('вимкнений фід призупиняє оновлення цін/стоків (звичайний парсер)', async ({
      page,
      feedCleanup,
    }) => {
      test.skip(true, 'фід з оновленням цін/стоків (звичайний парсер) → зняти чекбокс → ціни/стоки не оновлюються');
    });

    test('вимкнений фід НЕ призупиняє оновлення цін/стоків (новий парсер)', async ({
      page,
      feedCleanup,
    }) => {
      test.skip(true, 'новий парсер — при вимкненому чекбоксі оновлення цін/стоків все одно виконуються');
    });
  });
});
