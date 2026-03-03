/**
 * Утиліта для cleanup тестових даних через БД (відповідає tests-Python/utils/db_helper.py).
 * Використовується для видалення створеного фіду після тесту.
 * Якщо сервер вимагає SSL (pg_hba.conf) — задати TEST_DB_SSL=1 або require в .env.
 */
import { Client } from 'pg';
import { testConfig } from '../fixtures/env';

function isSslEnabled(): boolean {
  const v = (testConfig.dbSsl || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'require';
}

function createClient(): Client {
  const { dbHost, dbPort, dbName, dbUser, dbPassword } = testConfig;
  if (!dbHost || !dbName) {
    throw new Error('Налаштування БД не вказані (TEST_DB_HOST, TEST_DB_NAME). Операція не може бути виконана.');
  }

  return new Client({
    host: dbHost,
    port: dbPort || 5432,
    database: dbName,
    user: dbUser || undefined,
    password: dbPassword || undefined,
    ssl: isSslEnabled()
      ? { rejectUnauthorized: false }
      : false,
  });
}

export async function deleteFeedById(feedId: string): Promise<boolean> {
  const client = createClient();

  try {
    await client.connect();

    const resImages = await client.query('DELETE FROM feed_image_feed WHERE feed_id = $1', [feedId]);
    const resFeed = await client.query('DELETE FROM feed WHERE feed_id = $1', [feedId]);

    if (resFeed.rowCount && resFeed.rowCount > 0) {
      return true;
    }
    throw new Error(`Фід з ID '${feedId}' не знайдено в БД`);
  } finally {
    await client.end();
  }
}

/** Вимкнути фід (is_active = false). Для cleanup тестів 7, 11. */
export async function deactivateFeedById(feedId: string): Promise<boolean> {
  const client = createClient();

  try {
    await client.connect();
    const res = await client.query('UPDATE feed SET is_active = false WHERE feed_id = $1', [feedId]);
    if (res.rowCount && res.rowCount > 0) return true;
    throw new Error(`Фід з ID '${feedId}' не знайдено в БД або вже вимкнено`);
  } finally {
    await client.end();
  }
}

/**
 * Перевірити, чи є для переданого feed_id хоч один SKU зі статусом ContentPending,
 * завантажений з фіду (upload_source = 'feed') і не видалений.
 */
export async function hasContentPendingSkusForFeed(feedId: string): Promise<boolean> {
  const client = createClient();

  try {
    await client.connect();
    const result = await client.query(
      `
        SELECT ss.id
        FROM supplier_sku ss
        JOIN feed_offer_item foi ON foi.sku_id = ss.id
        WHERE foi.feed_id = $1
          AND ss.status_track && ARRAY['ContentPending']
          AND ss.upload_source = 'feed'
          AND ss.is_deleted = false
        LIMIT 1
      `,
      [feedId],
    );
    return !!result.rowCount && result.rowCount > 0;
  } finally {
    await client.end();
  }
}
