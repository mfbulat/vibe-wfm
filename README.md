# Vibe WFM

WFM-планировщик смен на `React + TypeScript + Vite` с поддержкой desktop и mobile интерфейсов.

## Возможности

- Режимы просмотра: `День`, `Неделя`, `Месяц`.
- Выбор даты через `datepicker`.
- Автоскролл к выбранной дате:
  - при выборе даты в `week/month`,
  - при переключении в режим `week/month`.
- Подсветка заголовка выбранной даты на 2 секунды (плавное затухание).
- Добавление смен:
  - по двойному клику по ячейке (desktop),
  - через кнопку `Добавить смену` в тулбаре,
  - через кнопку `Добавить` в карточке сотрудника (mobile).
- Редактирование смены:
  - двойной клик по смене (desktop),
  - тап по карточке смены (mobile).
- Перенос смен drag&drop между сотрудниками/датами (desktop).
- Resize смены за левый/правый край (desktop, все режимы).
- В `week` (desktop): колонки адаптируются по ширине и заполняют доступную ширину таблицы.
- Выделение сегодняшней даты в заголовке таблицы.
- Виртуализация таблицы по вертикали и горизонтали (desktop).
- 10 визуальных цветовых тем с переключением внизу страницы.
- Локализация интерфейса на 15 языков с переключением внизу страницы.
- Флаги в селекторе языка.

## Хранение данных

- Смены сохраняются в `IndexedDB`:
  - БД: `vibe-wfm-db`
  - Store: `app_store`
  - Key: `shifts`
- В `localStorage` сохраняются:
  - режим просмотра (`vibe-wfm:view-mode`)
  - тема (`vibe-wfm:theme`)
  - язык (`vibe-wfm:language`)

## Быстрый старт

```bash
npm install
npm run dev
```

Открыть: `http://localhost:5173/`

## Скрипты

```bash
npm run dev      # локальная разработка
npm run build    # production build
npm run preview  # preview production сборки
npm run lint     # eslint
```

## CI / Deploy

В репозитории настроены GitHub Actions:

- `CI`: `lint + build` на `push` и `pull_request`.
- `Deploy Pages`: деплой на GitHub Pages на `push` в `main/master`.

Файлы workflow:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-pages.yml`

## Структура (основное)

- `src/App.tsx` — основной UI и бизнес-логика планировщика.
- `src/App.module.scss` — стили интерфейса.
- `src/indexedDb.ts` — слой работы с IndexedDB.

## Примечание по Node.js

Проект собирается на текущей конфигурации, но `Vite 7` рекомендует `Node.js >= 20.19` или `>= 22.12`.
