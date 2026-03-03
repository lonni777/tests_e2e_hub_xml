"""
Модуль для управління конфігурацією та секретами тестів.
Завантажує дані з .env файлу або змінних середовища.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Шлях до кореня репозиторію (tests_e2e_hub_xml), щоб використовувати спільний .env
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Завантаження змінних з .env файлу в корені репозиторію (якщо він існує)
env_path = BASE_DIR / ".env"
if env_path.exists():
    load_dotenv(env_path)


class TestConfig:
    """Клас для зберігання конфігурації тестів"""
    
    # URL системи
    BASE_URL = os.getenv("TEST_BASE_URL", "https://hubtest.kasta.ua")
    LOGIN_URL = os.getenv("TEST_LOGIN_URL", f"{BASE_URL}/user/login")
    
    # Дані для логіну
    USER_EMAIL = os.getenv("TEST_USER_EMAIL", "")
    USER_PASSWORD = os.getenv("TEST_USER_PASSWORD", "")
    
    # Дані для негативних тестів
    # Email користувача, якого не існує в системі (для негативних кейсів)
    NON_EXISTENT_USER_EMAIL = os.getenv("TEST_NON_EXISTENT_USER_EMAIL", "")
    
    # URL після успішного логіну
    DASHBOARD_URL = os.getenv("TEST_DASHBOARD_URL", "")
    
    # URL для XML-фідів
    XML_FEEDS_URL = os.getenv("TEST_XML_FEEDS_URL", f"{BASE_URL}/supplier-content/xml")
    XML_FEED_ADD_URL = os.getenv("TEST_XML_FEED_ADD_URL", f"{BASE_URL}/supplier-content/xml?feed_id=%20%20%20&tab=feed")
    
    # Тестовий XML-фід URL (з Git Gist) — валідний фід для автотестів
    TEST_XML_FEED_URL = os.getenv("TEST_XML_FEED_URL", "https://gist.githubusercontent.com/lonni777/dc7d69b7226ce29d807d762bbb054598/raw")
    # URL з розширенням .xml але вмістом JSON (невалідна структура) — для негативного тесту
    TEST_INVALID_XML_FEED_URL = os.getenv(
        "TEST_INVALID_XML_FEED_URL",
        "https://www.dropbox.com/scl/fi/o84mvoxjl0ro6iejsh60p/Untitled-1.xml?rlkey=p09wc82oxv8rfl5c4pho4bfin&st=8k4hz546&dl=1"
    )
    # URL що повертає 404 — для негативного тесту (змінено валідний gist URL)
    TEST_404_FEED_URL = os.getenv(
        "TEST_404_FEED_URL",
        "https://gist.github.com/lonni777/1eb5d08a1dfd4ad0fdf8666ab78ab5be111/raw"
    )
    # Невалідний URL (не підтримуваний протокол, напр. ftp) — для тесту формату
    TEST_INVALID_URL_FEED = os.getenv("TEST_INVALID_URL_FEED", "ftp://test.com")
    # TC-XML-008: XML з некоректною структурою (неповний/зламаний XML)
    TEST_INVALID_XML_STRUCTURE_URL = os.getenv(
        "TEST_INVALID_XML_STRUCTURE_URL",
        "https://gist.githubusercontent.com/lonni777/231bc3625b32b6d8ae95374f154a4e30/raw"
    )
    # TC-XML-007: URL для тесту conn-timeout 1 хв при збереженні фіду.
    # feed-download: conn-timeout 1 хв, socket-timeout 5 хв.
    # Non-routable IP (TEST-NET) — з'єднання не встановлюється, гарантовано conn-timeout.
    # httpbin.org/delay повертає JSON за ~10 сек → помилка валідації XML, не таймаут.
    TEST_TIMEOUT_FEED_URL = os.getenv("TEST_TIMEOUT_FEED_URL", "http://192.0.2.1/xml")
    
    # Постачальник для тестування XML-фідів
    TEST_SUPPLIER_NAME = os.getenv("TEST_SUPPLIER_NAME", "Парфюмс")
    # URL для тесту "Додавання одного URL двічі" (Парфюмс, фід не створює дубль, лише оновлює)
    TEST_DUPLICATE_FEED_URL = os.getenv(
        "TEST_DUPLICATE_FEED_URL",
        "https://www.foxtrot.com.ua/pricelist/kasta_uk.xml"
    )
    
    # Існуючий feed_id для тестування Excel мапінгу (для оптимізації - використовуємо замість створення нового)
    # Використовується фід постачальника Парфюмс з ID R3DV
    TEST_EXISTING_FEED_ID = os.getenv("TEST_EXISTING_FEED_ID", "R3DV")
    # 4 feed_id для тесту обмеження "3 активні фіди" (через кому)
    # Вмикаємо 3, при спробі вмикнути 4-й — очікується помилка
    _feed_ids_str = os.getenv("TEST_FEED_IDS_FOR_LIMIT", "R3DV,R2K3,R3DX,R3DY")
    TEST_FEED_IDS_FOR_LIMIT = [x.strip() for x in _feed_ids_str.split(",") if x.strip()]
    
    # Налаштування бази даних для очищення тестових даних
    DB_HOST = os.getenv("TEST_DB_HOST", "")
    DB_PORT = int(os.getenv("TEST_DB_PORT", "5432"))
    DB_NAME = os.getenv("TEST_DB_NAME", "")
    DB_USER = os.getenv("TEST_DB_USER", "")
    DB_PASSWORD = os.getenv("TEST_DB_PASSWORD", "")
    
    @classmethod
    def validate(cls):
        """Перевірка наявності обов'язкових змінних"""
        missing = []
        
        if not cls.USER_EMAIL:
            missing.append("TEST_USER_EMAIL")
        if not cls.USER_PASSWORD:
            missing.append("TEST_USER_PASSWORD")
        if not cls.NON_EXISTENT_USER_EMAIL:
            missing.append("TEST_NON_EXISTENT_USER_EMAIL")
        
        if missing:
            raise ValueError(
                f"Відсутні обов'язкові змінні середовища: {', '.join(missing)}\n"
                f"Створіть файл .env на основі .env.example та заповніть необхідні дані."
            )
