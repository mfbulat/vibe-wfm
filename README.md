# Vibe WFM

WFM-планировщик смен на `React + TypeScript + Vite` с поддержкой desktop и mobile интерфейсов.

## Возможности

- Режимы просмотра: `День`, `Неделя`, `Месяц`.
- Выбор даты через `datepicker`.
- Добавление смен:
  - по двойному клику по ячейке (desktop),
  - через кнопку `Добавить смену` в тулбаре,
  - через кнопку `Добавить` в карточке сотрудника (mobile).
- Редактирование смены:
  - двойной клик по смене (desktop),
  - тап по карточке смены (mobile).
- Перенос смен drag&drop между сотрудниками/датами (desktop).
- Resize смены за левый/правый край (desktop, все режимы).
- В `week/month`: автоскролл к выбранной из `datepicker` дате + подсветка заголовка даты на 2 секунды.
- В `month`: при выборе даты выполняется скролл к нужной колонке.
- В `week` (desktop): колонки адаптируются по ширине и заполняют доступную ширину таблицы.
- Выделение сегодняшней даты в заголовке таблицы.
- Виртуализация таблицы по вертикали и горизонтали (desktop).

## Хранение данных

- Смены сохраняются в `IndexedDB`:
  - БД: `vibe-wfm-db`
  - Store: `app_store`
  - Key: `shifts`
- Выбранный режим просмотра (`day/week/month`) сохраняется в `localStorage` (`vibe-wfm:view-mode`).

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
