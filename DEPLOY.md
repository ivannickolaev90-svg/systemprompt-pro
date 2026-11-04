# Деплой на Cloudflare Pages

Структура:
- `public/` — сайт (статичные файлы), `public/_headers` — заголовки безопасности;
- `functions/api/*.js` — серверные функции (`/api/task`, `/api/tasks`, `/api/generate`, `/api/status`, `/api/order`, `/api/claim`, `/api/yoomoney-webhook`);
- `lib/tasks.js` — сценарии задач «выбери задачу → готовый текст» (поля формы и инструкции для ИИ);
- `lib/` — общая серверная логика (лицензии, лимиты, хранилище D1, ИИ).

## Настройки проекта Cloudflare Pages
- Framework preset: **None**, Build command: пусто, Build output directory: **public**.
- Bindings → D1 database: имя переменной **DB** (таблица создаётся автоматически).

## Переменные окружения (Settings → Variables and Secrets)
| Имя | Обязательно | Что это |
|---|---|---|
| `LICENSE_SECRET` | да | случайная строка от 32 символов, подпись лицензий |
| `YOOMONEY_NOTIFICATION_SECRET` | да | секрет HTTP-уведомлений из настроек ЮMoney |
| `GROQ_API_KEY` | для ИИ | ключ Groq (console.groq.com), бесплатно |
| `DEEPSEEK_API_KEY` | нет | запасной платный ИИ, если Groq не задан |
| `AI_MODEL` | нет | модель (по умолчанию `openai/gpt-oss-120b`, запасная `llama-3.3-70b-versatile`) |
| `AI_ENABLED` | нет | `false` — выключить ИИ |
| `AI_DAILY_MAX`, `AI_PRO_DAILY`, `AI_FREE_TRIAL_DAILY` | нет | лимиты (60 / 30 / 1 в сутки) |
| `AI_MONTHLY_USD` | нет | бюджет в $ для платного ИИ (по умолчанию 3) |
| `AI_TASK_FREE_DAILY`, `AI_TASK_PRO_DAILY`, `AI_TASK_DAILY_MAX` | нет | лимиты задач «готовый текст» (5 / 100 в сутки на человека, 900 в сутки на сайт) |

URL уведомлений ЮMoney: `https://<домен>/api/yoomoney-webhook`.
