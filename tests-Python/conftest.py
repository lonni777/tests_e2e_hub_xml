import pytest
import platform
from datetime import datetime
from pathlib import Path
from typing import List, Dict
from config.settings import TestConfig


def pytest_configure(config):
    """
    Налаштування pytest перед запуском тестів.
    Видаляє старі HTML-репорти та створює новий звіт з timestamp.
    """
    # Репорти зберігаємо в корені репозиторію (tests_e2e_hub_xml/reports)
    reports_dir = Path(__file__).resolve().parent.parent / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    # Видаляємо старі HTML-репорти (report_*.html), щоб не накопичувати їх
    for old_report in reports_dir.glob("report_*.html"):
        try:
            old_report.unlink()
        except OSError:
            pass

    # Генеруємо timestamp для унікального імені звіту
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = reports_dir / f"report_{timestamp}.html"
    
    # Замінюємо шлях до звіту на версію з timestamp
    # pytest-html зберігає шлях в config.option.htmlpath
    if hasattr(config.option, 'htmlpath') and config.option.htmlpath:
        # Замінюємо стандартний шлях на версію з timestamp
        config.option.htmlpath = str(report_path)
    else:
        # Якщо htmlpath не встановлено, встановлюємо його
        config.option.htmlpath = str(report_path)


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    """Налаштування контексту браузера"""
    return {
        **browser_context_args,
        "viewport": {"width": 1920, "height": 1080},
        "accept_downloads": True,  # Дозволяємо скачування файлів
    }


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    """Налаштування запуску браузера з відкритими DevTools"""
    # Якщо browser_type_launch_args - це словник, додаємо devtools
    if isinstance(browser_type_launch_args, dict):
        return {
            **browser_type_launch_args,
            "devtools": True,  # Відкриваємо DevTools для моніторингу помилок
        }
    # Якщо це список аргументів, додаємо devtools як параметр
    return {
        "devtools": True,
    }


@pytest.hookimpl(tryfirst=True)
def pytest_runtest_setup(item):
    """
    Хук для ініціалізації збору помилок консолі перед запуском тесту.
    """
    # Ініціалізуємо структуру для зберігання помилок для всіх тестів
    item.console_errors_data = {
        "console_messages": [],
        "js_errors": []
    }


@pytest.fixture(scope="function", autouse=True)
def setup_devtools_network_tab(request):
    """
    Фікстура для відкриття DevTools на вкладці Network після створення page.
    Працює тільки в режимі з відкритим браузером (headed mode).
    
    Примітка: Автоматичне перемикання DevTools на конкретну вкладку через Playwright/CDP
    є складним завданням, оскільки DevTools мають власний контекст виконання.
    DevTools будуть відкриті через browser_type_launch_args, але вкладка може бути Elements.
    Користувач може вручну перемкнути на Network вкладку під час виконання тесту.
    
    Для автоматичного перемикання можна використати:
    1. Клавіатурні скорочення (Ctrl+Shift+E для Elements, потім Tab для навігації)
    2. Миша для кліку на вкладку Network
    3. Або використати спеціальні параметри запуску браузера (якщо доступні)
    """
    # Перевіряємо чи тест використовує page фікстуру
    if "page" not in request.fixturenames:
        yield
        return
    
    # Отримуємо page після його створення
    try:
        page = request.getfixturevalue("page")
        if page:
            # Чекаємо трохи, щоб DevTools встигли відкритися
            page.wait_for_timeout(2000)
            
            # Намагаємося перемкнути DevTools на вкладку Network через CDP
            # Використовуємо різні методи для максимальної сумісності
            try:
                cdp_session = page.context.new_cdp_session(page)
                
                # Метод 1: Спробуємо використати CDP для виконання JavaScript
                # який перемкне DevTools на Network вкладку
                cdp_session.send("Runtime.evaluate", {
                    "expression": """
                        (function() {
                            try {
                                // Спробуємо знайти DevTools через chrome.devtools API
                                if (typeof chrome !== 'undefined' && chrome.devtools) {
                                    const panels = chrome.devtools.panels;
                                    if (panels && panels.network) {
                                        panels.network.show();
                                        return true;
                                    }
                                }
                                
                                // Спробуємо через внутрішній API
                                if (typeof UI !== 'undefined' && UI && UI.panels && UI.panels.network) {
                                    UI.panels.network.show();
                                    return true;
                                }
                                
                                return false;
                            } catch(e) {
                                return false;
                            }
                        })();
                    """
                })
            except:
                # Якщо не вдалося через CDP, продовжуємо роботу
                # DevTools все одно будуть відкриті через browser_type_launch_args
                pass
    except:
        pass
    
    yield


@pytest.hookimpl(tryfirst=True)
def pytest_runtest_call(item):
    """
    Хук для підключення обробників помилок консолі перед викликом тесту.
    Підключає обробники до page після його створення.
    """
    # Перевіряємо чи тест використовує page фікстуру
    if "page" not in item.fixturenames:
        return
    
    # Отримуємо page з funcargs та підключаємо обробники
    try:
        page = item.funcargs.get("page")
        if page:
            console_messages = item.console_errors_data["console_messages"]
            js_errors = item.console_errors_data["js_errors"]
            
            def handle_console(msg):
                """Обробник повідомлень консолі"""
                console_messages.append({
                    "type": msg.type,
                    "text": msg.text,
                    "location": {
                        "url": msg.location.get("url", ""),
                        "line": msg.location.get("lineNumber", ""),
                        "column": msg.location.get("columnNumber", "")
                    }
                })
            
            def handle_page_error(error):
                """Обробник JavaScript помилок"""
                js_errors.append(str(error))
            
            # Підписуємося на події консолі та помилок
            page.on("console", handle_console)
            page.on("pageerror", handle_page_error)
            
            # Спробуємо відкрити DevTools на вкладці Network через CDP
            try:
                cdp_session = page.context.new_cdp_session(page)
                # Використовуємо CDP для відкриття DevTools на вкладці Network
                # Це працює тільки якщо DevTools вже відкриті через devtools: True
                page.evaluate("""
                    () => {
                        // Намагаємося перемкнути DevTools на вкладку Network
                        // Використовуємо DevTools API якщо доступний
                        if (window.chrome && window.chrome.runtime) {
                            // Спробуємо знайти DevTools і перемкнути на Network
                            const devtools = document.querySelector('devtools');
                            if (devtools) {
                                // Використовуємо внутрішній API DevTools
                                try {
                                    const UI = window.UI || window.DevToolsAPI;
                                    if (UI && UI.panels) {
                                        UI.panels.network.show();
                                    }
                                } catch(e) {}
                            }
                        }
                    }
                """)
            except:
                # Якщо не вдалося, продовжуємо роботу
                pass
    except Exception as e:
        # Якщо не вдалося підключити обробники, ігноруємо помилку
        pass


def _save_bug_report(item, rep, screenshot_path=None):
    """
    Зберігає шаблон баг-репорту для ручного створення в Jira.
    Файл: reports/last_failure_bug_report.txt
    """
    reports_dir = Path("reports")
    reports_dir.mkdir(exist_ok=True)
    bug_report_path = reports_dir / "last_failure_bug_report.txt"
    
    test_name = item.nodeid
    test_short = item.name.split("[")[0] if "[" in item.name else item.name
    error_msg = str(rep.longrepr) if rep.longrepr else str(rep)
    
    # Кроки з docstring тесту (якщо є)
    docstring = item.function.__doc__ or ""
    steps = ""
    if docstring:
        lines = docstring.strip().split("\n")
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("-") or stripped.startswith("Крок"):
                steps += stripped + "\n"
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    html_reports = list(Path("reports").glob("report_*.html"))
    latest_report = max(html_reports, key=lambda p: p.stat().st_mtime) if html_reports else None
    
    attachments = []
    if screenshot_path:
        attachments.append(f"Скріншот: {screenshot_path}")
    if latest_report:
        attachments.append(f"HTML звіт: {latest_report}")
    
    content = f"""=== БАГ-РЕПОРТ ДЛЯ JIRA (копіювати вручну) ===
Згенеровано: {timestamp}

--- Summary ---
[Автотест] {test_short}: {error_msg[:80]}...

--- Description ---
**Тест:** {test_name}

**Помилка:**
{error_msg[:1500]}

**Кроки для відтворення:**
{steps or "(див. тест-кейс)"}

**Очікуваний результат:** (з тест-кейсу)
**Фактичний результат:** (див. помилку вище)

**Середовище:** {platform.system()}, Python

--- Attachments ---
{chr(10).join(attachments) or "(немає)"}
"""
    
    bug_report_path.write_text(content, encoding="utf-8")
    print(f"\n>>> Bug report збережено: {bug_report_path}")
    print(">>> Можна створити issue в Jira, скопіювавши вміст файлу.\n")


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """
    Хук для збереження скріншотів, trace та помилок консолі при помилках тестів.
    Автоматично зберігає артефакти після кожного тесту.
    """
    outcome = yield
    rep = outcome.get_result()
    
    extra_items = []
    
    # Збираємо помилки консолі та JavaScript (якщо є)
    console_errors_data = getattr(item, "console_errors_data", None)
    if console_errors_data:
        # Фільтруємо тільки помилки та попередження
        errors = [
            msg for msg in console_errors_data["console_messages"]
            if msg["type"] in ["error", "warning"]
        ]
        js_errors = console_errors_data["js_errors"]
        
        # Формуємо текст для звіту
        error_text = ""
        if errors:
            error_text += "=== Помилки консолі ===\n"
            for err in errors:
                error_text += f"[{err['type'].upper()}] {err['text']}\n"
                if err['location']['url']:
                    error_text += f"  URL: {err['location']['url']}\n"
                    if err['location']['line']:
                        error_text += f"  Рядок: {err['location']['line']}, Колонка: {err['location']['column']}\n"
                error_text += "\n"
        
        if js_errors:
            error_text += "=== JavaScript помилки ===\n"
            for js_err in js_errors:
                error_text += f"{js_err}\n\n"
        
        if error_text:
            # Додаємо помилки в звіт як текст
            extra_items.append({
                "type": "text",
                "name": "Помилки браузера",
                "value": error_text
            })
    
    # Зберігаємо скріншот, bug report та trace тільки якщо тест завершився з помилкою
    screenshot_path = None
    if rep.when == "call" and rep.failed:
        # Отримуємо page з тесту (якщо доступний)
        if "page" in item.fixturenames:
            page = item.funcargs.get("page")
            if page:
                # Створюємо папку для збереження артефактів
                screenshots_dir = Path("test-results/screenshots")
                screenshots_dir.mkdir(parents=True, exist_ok=True)
                
                # Генеруємо унікальне ім'я файлу
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                test_name_safe = item.name.replace("::", "_").replace("[", "_").replace("]", "")
                screenshot_path = screenshots_dir / f"{test_name_safe}_{timestamp}.png"
                
                try:
                    # Зберігаємо скріншот
                    page.screenshot(path=str(screenshot_path), full_page=True)
                    # Додаємо шлях до скріншота в звіт
                    extra_items.append({
                        "type": "image",
                        "name": "Screenshot",
                        "value": str(screenshot_path)
                    })
                except Exception:
                    screenshot_path = None
        
        # Зберігаємо bug report для ручного створення в Jira
        _save_bug_report(item, rep, screenshot_path)
    
    # Додаємо всі додаткові елементи в звіт
    if extra_items:
        rep.extra = extra_items


@pytest.fixture(scope="session")
def test_config():
    """
    Фікстура для конфігурації тестів.
    Завантажує налаштування з .env файлу та валідує їх.
    """
    # Валідація конфігурації при завантаженні
    TestConfig.validate()
    return TestConfig
