# Завантаження фото у фідах (схема для тестів)

Коротка схема того, як працює завантаження фото в XML-фідах і чому для перевірки ContentPending потрібні **два** виклики trigger-feedload з паузою.

---

## Як працює завантаження фото

1. **Парсинг фіду (синхронно)**  
   Завантаження фіду → `feed_loader/load-feed!` → `parse-feed-s3` → `rz_parser/parse-feed`.  
   Для кожного оффера викликається `load-offer-fn`:  
   - `imageb(img)` — додає URL картинок у буфер (batch 1000);  
   - `load-sku` — перевіряє, чи є фото, і створює SKU.

2. **Умова створення SKU (ContentPending)**  
   `load-sku` використовує `images-state`:  
   - `hublinks` — є тільки якщо всі картинки мають `resized_s3` у `feed_image`;  
   - `wait` — true, якщо ще не всі картинки завантажені.  
   Якщо `wait = true` → OFFER_PICTURES_WAIT → **SKU не створюється**.

3. **Джерело даних для фото**  
   `get-img-entry` бере дані зі знімка на **початку** завантаження фіду (feed_image JOIN feed_image_feed на момент старту load-feed). Тобто використовується стан `feed_image` на старті, без оновлень під час парсингу.

4. **Асинхронне завантаження фото (Kafka)**  
   При flush буфера `imageb` (в кінці парсингу):  
   - `load-image-fast` → топік `feed_load_image_1_4`;  
   - `load-image-slow` → топіки `feed_load_image_2_4`, `3_4`, `4_4`.  
   Потім `mark-imageset!` для feed_id.

5. **Обробка Kafka (окремий процес)**  
   Консьюмери завантажують фото, ресайзять, роблять `UPDATE feed_image SET target_s3, resized_s3`.

---

## Чому одного feed load недостатньо

| Крок | Процес | Що відбувається |
|------|--------|-----------------|
| 1 | Feed loader | Парсинг XML; для оффера з фото: `get-img-entry` → nil (feed_image ще без resized_s3). |
| 2 | Feed loader | OFFER_PICTURES_WAIT, **SKU не створюється**. |
| 3 | Feed loader | Flush imageb → повідомлення в Kafka. |
| 4 | Kafka consumer | try-download! → завантаження + ресайз. |
| 5 | Kafka consumer | UPDATE feed_image SET resized_s3 = ... |
| 6 | **Наступний** feed load | `get-img-entry` вже повертає resized_s3 → **SKU створюється з ContentPending**. |

Тобто **ContentPending з’являється лише при наступному завантаженні фіду**, коли в `feed_image` вже є `resized_s3`.

---

## Що робить тест «активний фід завантажує новинки»

У `tests-ts/e2e/xml-feed-settings.spec.ts`:

1. **Перший** trigger-feedload — парсинг, фото йдуть в Kafka; SKU не створюються (OFFER_PICTURES_WAIT).
2. **Пауза 5 хв** — час на обробку Kafka (завантаження фото, ресайз, оновлення `feed_image`).
3. **Другий** trigger-feedload — `get-img-entry` бачить `resized_s3` → створюються SKU з ContentPending.
4. Поллінг БД на наявність хоча б одного SKU зі статусом ContentPending для цього feed_id.

Таймаут тесту: 12 хв (щоб вмістити паузу та поллінг). Орієнтовні таймаути в бекенді: TRY-DOWNLOAD-IMAGE-TIMEOUT = 1 хв на фото, ONE-FEED-RUN-TIMEOUT = 120 хв на фід.

---

## Альтернативи (для довідки)

- **Мок Kafka/фото** (як у puma_test.clj): `flush-images-to-feed-image` імітує завершення завантаження фото, щоб `feed_image` мала `resized_s3` до другого feed load або в тому ж run.
- **Локальний Kafka consumer** — переконатися, що консьюмер `feed_load_image_*` реально працює в тестовому середовищі.
