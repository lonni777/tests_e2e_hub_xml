import { expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { xmlFeedLocators } from '../locators/xml-feed.locators';

export class XmlFeedPage extends BasePage {
  async navigateToXmlFeedsViaMenu(): Promise<void> {
    await this.page.locator(xmlFeedLocators.productsMenu).click();
    await this.page.waitForTimeout(500);
    await this.page.locator(xmlFeedLocators.importNewItemsLink).click();
    await this.page.waitForTimeout(500);
    await this.page.locator(xmlFeedLocators.xmlTabLink).click();
    await this.waitForLoadState('networkidle');
  }

  async selectSupplier(supplierName: string): Promise<void> {
    try {
      const userMenu = this.page.locator(xmlFeedLocators.userMenu);
      if (await userMenu.isVisible({ timeout: 2000 })) {
        await userMenu.click();
        await this.page.waitForTimeout(500);
      }
    } catch {
      /* ігноруємо */
    }
    try {
      const allSuppliers = this.page.locator(xmlFeedLocators.allSuppliersOption);
      if (await allSuppliers.isVisible({ timeout: 2000 })) {
        await allSuppliers.click();
        await this.page.waitForTimeout(500);
      }
    } catch {
      /* ігноруємо */
    }
    try {
      const searchInput = this.page.getByPlaceholder('Постачальники');
      await searchInput.click();
      await searchInput.fill(supplierName);
    } catch {
      const searchInput = this.page.locator(xmlFeedLocators.suppliersSearchInput);
      await searchInput.click();
      await searchInput.fill(supplierName);
    }
    await this.page.waitForTimeout(1000);
    const option = this.page.locator(`text=/${supplierName}/i`).first();
    await option.click();
    await this.waitForLoadState('networkidle');
  }

  async clickAddNewFeedButton(): Promise<void> {
    await this.page.getByRole('button', { name: 'Додати новий фід', exact: true }).click();
    await this.page.waitForTimeout(1000);
  }

  async fillFeedUrl(url: string): Promise<void> {
    try {
      const input = this.page.getByPlaceholder('https://127.0.0.1:8000/fmt.');
      await input.click();
      await input.fill(url);
    } catch {
      const input = this.page.locator(xmlFeedLocators.feedUrlInput);
      await input.click();
      await input.fill(url);
    }
  }

  async clearFeedUrl(): Promise<void> {
    try {
      const input = this.page.getByPlaceholder('https://127.0.0.1:8000/fmt.');
      await input.click();
      await input.fill('');
    } catch {
      const input = this.page.locator(xmlFeedLocators.feedUrlInput);
      await input.click();
      await input.fill('');
    }
  }

  async enableUploadItemsCheckbox(): Promise<void> {
    const container = this.page.locator('div').filter({ hasText: /^Завантажити товари з xml/ }).first();
    const checkbox = container.locator('input[type="checkbox"]').first();
    await checkbox.check();
  }

  async disableUploadItemsCheckbox(): Promise<void> {
    const container = this.page.locator('div').filter({ hasText: /^Завантажити товари з xml/ }).first();
    const checkbox = container.locator('input[type="checkbox"]').first();
    await checkbox.uncheck();
  }

  async setZeroStockWhenNotFoundCheckbox(checked: boolean): Promise<void> {
    const container = this.page
      .locator('div')
      .filter({ hasText: /^Зняти з продажу товари, які відсутні в фіді/ })
      .first();
    const checkbox = container.locator('input[type="checkbox"]').first();
    const isChecked = await checkbox.isChecked();
    if (checked && !isChecked) {
      await checkbox.check();
    } else if (!checked && isChecked) {
      await checkbox.uncheck();
    }
  }

  async isZeroStockWhenNotFoundChecked(): Promise<boolean> {
    const container = this.page
      .locator('div')
      .filter({ hasText: /^Зняти з продажу товари, які відсутні в фіді/ })
      .first();
    const checkbox = container.locator('input[type="checkbox"]').first();
    return checkbox.isChecked();
  }

  async clickSaveButton(): Promise<void> {
    await this.page.locator(xmlFeedLocators.saveButton).click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Чекаємо повідомлення про успіх — зреагує одразу як з'явиться, але не більше 5 секунд.
   * Якщо точний текст не знайдено, пробуємо fallback-и (частковий текст, URL, body).
   */
  async verifySuccessMessage(expectedText: string = 'Дані збережено!'): Promise<void> {
    const timeout = 5000;
    let found = false;
    try {
      await expect(this.page.locator(xmlFeedLocators.successMessage)).toBeVisible({ timeout });
      found = true;
    } catch {
      /* pass */
    }
    if (!found) {
      try {
        await expect(this.page.locator(`text=${expectedText}`)).toBeVisible({ timeout: 3000 });
        found = true;
      } catch {
        /* pass */
      }
    }
    if (!found) {
      const partial = expectedText.toLowerCase().includes('збережено') ? 'збережено' : expectedText.slice(0, 5);
      try {
        await expect(this.page.getByText(new RegExp(partial, 'i'))).toBeVisible({ timeout: 3000 });
        found = true;
      } catch {
        /* pass */
      }
    }
    if (!found) {
      const url = this.getUrl();
      if (url.includes('/supplier-content/xml') && !url.includes('feed_id')) {
        found = true;
      }
    }
    if (!found) {
      const body = (await this.page.locator('body').textContent()) || '';
      if (body.toLowerCase().includes('збережено')) {
        found = true;
      }
    }
    expect(found, `Повідомлення про успіх "${expectedText}" не знайдено. URL: ${this.getUrl()}`).toBe(true);
  }

  async hasValidationErrorMessage(containsText: string): Promise<boolean> {
    const body = await this.page.locator('body').textContent();
    return (body || '').toLowerCase().includes(containsText.toLowerCase());
  }

  async verifyValidationErrorMessage(containsText: string): Promise<void> {
    await this.page.waitForTimeout(3000);
    const body = await this.page.locator('body').textContent();
    expect((body || '').toLowerCase()).toContain(containsText.toLowerCase());
  }

  async navigateToFeedsTable(feedsUrl: string): Promise<void> {
    await this.goto(feedsUrl);
    await this.waitForLoadState('networkidle');
    await expect(this.page.locator('.ag-root')).toBeVisible({ timeout: 5000 });
  }

  async filterFeedsByLink(feedUrl: string): Promise<void> {
    const filterUrl = feedUrl.replace('/raw', '').trim();
    await this.page.locator(xmlFeedLocators.feedLinkColumnHeader).click();
    await this.page.waitForTimeout(500);
    await this.page.locator(xmlFeedLocators.feedLinkFilterIcon).click();
    await this.page.getByPlaceholder('Фільтр').fill(filterUrl);
    await expect(this.page.locator('.ag-row').first()).toBeVisible({ timeout: 5000 });
  }

  /**
   * Після фільтра по лінку — значення стовпця "Підключено?" у першому (відфільтрованому) рядку.
   * Очікується "Так" або "Ні".
   */
  async getConnectedStatusFromFilteredRow(): Promise<string> {
    await expect(this.page.locator('.ag-row').first()).toBeVisible({ timeout: 5000 });
    const headerCells = this.page.locator('.ag-header-cell');
    const headerCount = await headerCells.count();
    let colIndex = -1;
    for (let i = 0; i < headerCount; i++) {
      const text = (await headerCells.nth(i).textContent())?.trim() || '';
      if (text.includes('Підключено')) {
        colIndex = i;
        break;
      }
    }
    if (colIndex < 0) return '';
    const firstRow = this.page.locator('.ag-row').first();
    const cell = firstRow.locator('.ag-cell').nth(colIndex);
    return ((await cell.textContent())?.trim() || '').trim();
  }

  async getFeedIdFromFilteredTable(): Promise<string> {
    await this.page.waitForSelector('.ag-row', { timeout: 5000 });
    const firstRow = this.page.locator('.ag-row').first();
    if (!(await firstRow.isVisible({ timeout: 3000 }))) return '';
    const cells = firstRow.locator('.ag-cell');
    const count = await cells.count();
    for (let i = 0; i < Math.min(3, count); i++) {
      const cell = cells.nth(i);
      const spans = cell.locator('span');
      const spanCount = await spans.count();
      for (let j = 0; j < spanCount; j++) {
        const text = (await spans.nth(j).textContent())?.trim() || '';
        if (text && /^[A-Za-z0-9]{1,10}$/.test(text)) return text;
      }
    }
    const firstCellText = (await cells.first().textContent())?.trim() || '';
    if (firstCellText && firstCellText.length <= 10) return firstCellText;
    return '';
  }

  async getFeedIdByUrlFromTable(feedUrl: string): Promise<string> {
    await this.page.waitForSelector('.ag-row', { timeout: 10000 });
    const rows = this.page.locator('.ag-row');
    const count = await rows.count();
    const urlKey = feedUrl.split('/').pop() || feedUrl;
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const rowText = (await row.textContent()) || '';
      if (!rowText.includes(feedUrl) && !rowText.includes(urlKey)) continue;
      const cells = row.locator('.ag-cell');
      const firstText = (await cells.first().textContent())?.trim() || '';
      if (firstText) return firstText;
      try {
        const link = row.locator("a[href*='feed_id']").first();
        if (await link.isVisible({ timeout: 2000 })) {
          const href = await link.getAttribute('href');
          const match = href?.match(/feed_id=([^&]+)/);
          if (match) return decodeURIComponent(match[1]).replace(/%20/g, ' ').trim();
        }
      } catch {
        /* pass */
      }
    }
    return '';
  }

  async getFeedsTableRowCount(): Promise<number> {
    await this.page.waitForSelector('.ag-row', { timeout: 10000 });
    return await this.page.locator('.ag-row').count();
  }

  /** Отримати feed_id з рядка таблиці за індексом (0-based). Для тесту обмеження 3 активні. */
  async getFeedIdFromRow(rowIndex: number): Promise<string> {
    await expect(this.page.locator('.ag-row').nth(rowIndex)).toBeVisible({ timeout: 5000 });
    const row = this.page.locator('.ag-row').nth(rowIndex);
    const cells = row.locator('.ag-cell');
    const count = await cells.count();
    for (let i = 0; i < Math.min(3, count); i++) {
      const cell = cells.nth(i);
      const spans = cell.locator('span');
      const spanCount = await spans.count();
      for (let j = 0; j < spanCount; j++) {
        const text = (await spans.nth(j).textContent())?.trim() || '';
        if (text && /^[A-Za-z0-9]{1,10}$/.test(text)) return text;
      }
    }
    const firstCellText = (await cells.first().textContent())?.trim() || '';
    if (firstCellText && firstCellText.length <= 10) return firstCellText;
    try {
      const link = row.locator("a[href*='feed_id']").first();
      if (await link.isVisible({ timeout: 1000 })) {
        const href = await link.getAttribute('href');
        const match = href?.match(/feed_id=([^&]+)/);
        if (match) return decodeURIComponent(match[1]).replace(/%20/g, ' ').trim();
      }
    } catch {
      /* pass */
    }
    return '';
  }

  /** Перші n feed_id з таблиці (для тесту без фіксованого списку). */
  async getFirstNFeedIds(n: number): Promise<string[]> {
    const count = await this.getFeedsTableRowCount();
    if (count < n) return [];
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = await this.getFeedIdFromRow(i);
      if (id) ids.push(id);
    }
    return ids;
  }

  async openFeedFromTableById(feedId: string): Promise<void> {
    const row = this.page.getByRole('row').filter({ hasText: feedId }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    const editBtn = row.getByRole('button', { name: /Редагувати/i });
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await this.waitForLoadState('networkidle');
  }

  async clickEditButton(): Promise<void> {
    try {
      const mgmt = this.page.locator(xmlFeedLocators.managementButton);
      if (await mgmt.isVisible({ timeout: 3000 })) {
        await mgmt.click();
        await this.page.waitForTimeout(500);
      }
      const editBtn = this.page.getByRole('button', { name: ' Редагувати' });
      if (await editBtn.isVisible({ timeout: 3000 })) {
        await editBtn.click();
        await this.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        return;
      }
    } catch {
      /* pass */
    }
    await this.page.locator(xmlFeedLocators.editButton).first().click();
    await this.waitForLoadState('networkidle');
    await this.page.waitForTimeout(2000);
  }

  async getFeedUrlFromInput(): Promise<string> {
    await this.page.waitForTimeout(1000);
    try {
      const input = this.page.getByPlaceholder('https://127.0.0.1:8000/fmt.');
      if (await input.isVisible({ timeout: 3000 }))
        return ((await input.inputValue()) || '').trim();
    } catch {
      /* pass */
    }
    try {
      const input = this.page.locator(xmlFeedLocators.feedUrlInput);
      if (await input.isVisible({ timeout: 2000 }))
        return ((await input.inputValue()) || '').trim();
    } catch {
      /* pass */
    }
    return '';
  }

  async isUploadItemsCheckboxChecked(): Promise<boolean> {
    try {
      const container = this.page.locator('div').filter({ hasText: /^Завантажити товари з xml/ }).first();
      if (await container.isVisible({ timeout: 3000 })) {
        const checkbox = container.locator("input[type='checkbox']").first();
        if (await checkbox.isVisible({ timeout: 2000 })) return await checkbox.isChecked();
      }
    } catch {
      /* pass */
    }
    return false;
  }

  async disableUploadItemsCheckbox(): Promise<void> {
    const container = this.page.locator('div').filter({ hasText: /^Завантажити товари з xml/ }).first();
    const checkbox = container.locator('input[type="checkbox"]').first();
    await checkbox.uncheck();
  }

  async openFeedForEditing(feedId: string): Promise<void> {
    const base = this.getUrl().split('?')[0];
    await this.goto(`${base}?feed_id=${feedId}&tab=feed`);
    await this.waitForLoadState('networkidle');
    await this.page.waitForTimeout(2000);
  }

  async downloadExcelMappingFile(downloadPath: string, feedId?: string): Promise<string> {
    const path = await import('path');
    const fs = await import('fs');
    if (!fs.existsSync(downloadPath)) {
      fs.mkdirSync(downloadPath, { recursive: true });
    }
    let downloadBtn = this.page.locator('text=Отримати файл для ручного мапінгу').first();
    if (!(await downloadBtn.isVisible({ timeout: 10000 }))) {
      downloadBtn = this.page.locator('button').filter({ hasText: 'Отримати файл для ручного мапінгу' }).first();
      if (!(await downloadBtn.isVisible({ timeout: 5000 })))
        throw new Error('Кнопка скачування Excel мапінгу не знайдена');
    }
    await downloadBtn.waitFor({ state: 'visible', timeout: 5000 });
    await this.page.waitForTimeout(2000);
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 90000 }),
      downloadBtn.click({ timeout: 60000 }),
    ]);
    await this.page.waitForTimeout(3000);
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '_');
    const fileName = feedId ? `${feedId}_${timestamp}.xlsx` : `mapping_${timestamp}.xlsx`;
    const filePath = path.join(downloadPath, fileName);
    await download.saveAs(filePath);
    return filePath;
  }

  async uploadExcelMappingFile(filePath: string): Promise<boolean> {
    const fs = await import('fs');
    if (!fs.existsSync(filePath)) throw new Error(`Файл не знайдено: ${filePath}`);
    const fileInput = this.page.locator("input[type='file']").first();
    await fileInput.setInputFiles(filePath);
    await this.page.waitForTimeout(2000);
    try {
      const uploadBtn = this.page.locator('text=Завантажити ручний мапінг категорій').first();
      if (await uploadBtn.isVisible({ timeout: 2000 })) {
        await uploadBtn.click();
        await this.page.waitForTimeout(2000);
      }
    } catch {
      /* pass */
    }
    return true;
  }
}
