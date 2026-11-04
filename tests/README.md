# Тесты серверной части

Запуск (Node 22+, без установки пакетов — D1 эмулируется через встроенный `node:sqlite`, ИИ — подменой `fetch`):

```
node --no-warnings tests/test.mjs        # конструктор, лимиты, оплата ЮMoney, лицензии, Groq/DeepSeek
node --no-warnings tests/test-tasks.mjs  # задачи «готовый текст»: /api/tasks, /api/task, твики, лимиты, запасная модель
```

Каждая строка печатает PASS/FAIL; при любом FAIL код выхода 1.
