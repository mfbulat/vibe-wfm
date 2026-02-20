import {useEffect, useMemo, useRef, useState} from 'react'
import type {DragEvent, FormEvent, PointerEvent as ReactPointerEvent} from 'react'
import {loadShiftsFromIndexedDb, saveShiftsToIndexedDb} from './indexedDb'
import styles from './App.module.scss'

type Employee = {
    id: string
    name: string
}

type Shift = {
    id: string
    employeeId: string
    dateKey: string
    title: string
    start: number
    end: number
}

type ModalDraft = {
    mode: 'create' | 'edit'
    shiftId?: string
    employeeId: string
    dateKey: string
    title: string
    startTime: string
    endTime: string
}

type ResizeState = {
    shiftId: string
    edge: 'left' | 'right'
    originX: number
    originStart: number
    originEnd: number
    pixelsPerHour: number
}

type ViewMode = 'day' | 'week' | 'month'
type LanguageId =
    | 'ru'
    | 'en'
    | 'es'
    | 'fr'
    | 'de'
    | 'it'
    | 'pt'
    | 'tr'
    | 'pl'
    | 'uk'
    | 'ar'
    | 'hi'
    | 'zh'
    | 'ja'
    | 'ko'
type ThemeId =
    | 'aurora'
    | 'sand'
    | 'forest'
    | 'sunset'
    | 'ocean'
    | 'citrus'
    | 'slate'
    | 'rose'
    | 'ice'
    | 'earth'

type VirtualViewport = {
    width: number
    height: number
    scrollTop: number
    scrollLeft: number
}

const HOURS = Array.from({length: 24}, (_, i) => i)
const MINUTES_IN_DAY = 24 * 60
const SNAP_MINUTES = 15
const MIN_SHIFT_MINUTES = 30
const HOUR_WIDTH = 72
const DATE_CELL_WIDTH = 160
const DATE_CELL_PADDING = 6
const MAX_MODAL_MINUTES = MINUTES_IN_DAY - SNAP_MINUTES
const DEFAULT_SHIFT_START = 9 * 60
const DATE_CHIP_GAP = 4
const VIEW_MODE_STORAGE_KEY = 'vibe-wfm:view-mode'
const THEME_STORAGE_KEY = 'vibe-wfm:theme'
const LANGUAGE_STORAGE_KEY = 'vibe-wfm:language'
const SELECTED_DATE_STORAGE_KEY = 'vibe-wfm:selected-date'

const EMPLOYEE_COLUMN_WIDTH_DESKTOP = 180
const EMPLOYEE_COLUMN_WIDTH_MOBILE = 130
const MOBILE_BREAKPOINT = 900
const HEADER_HEIGHT = 54
const ROW_HEIGHT = 76
const ROW_OVERSCAN = 4
const COLUMN_OVERSCAN = 2

const employees: Employee[] = [
    {id: 'e1', name: 'Анна'},
    {id: 'e2', name: 'Борис'},
    {id: 'e3', name: 'Светлана'},
    {id: 'e4', name: 'Дмитрий'},
    {id: 'e5', name: 'Екатерина'},
    {id: 'e6', name: 'Иван'},
    {id: 'e7', name: 'Мария'},
    {id: 'e8', name: 'Павел'},
    {id: 'e9', name: 'Ольга'},
    {id: 'e10', name: 'Никита'},
    {id: 'e11', name: 'Татьяна'},
    {id: 'e12', name: 'Владимир'},
    {id: 'e13', name: 'Юлия'},
    {id: 'e14', name: 'Алексей'},
    {id: 'e15', name: 'Ксения'},
]

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const snapToStep = (value: number, step = SNAP_MINUTES) => Math.round(value / step) * step

const formatTime = (minutes: number) => {
    const normalized = clamp(minutes, 0, MINUTES_IN_DAY)
    const h = Math.floor(normalized / 60)
    const m = normalized % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const parseTime = (value: string) => {
    const [h, m] = value.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return null
    if (h < 0 || h > 23 || m < 0 || m > 59) return null
    return h * 60 + m
}

const dateToKey = (date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

const parseDateKey = (value: string) => {
    const [y, m, d] = value.split('-').map(Number)
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null
    const date = new Date(y, m - 1, d)
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
    return date
}

const addDays = (date: Date, amount: number) => {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    copy.setDate(copy.getDate() + amount)
    return copy
}

const getWeekDates = (date: Date) => {
    const day = (date.getDay() + 6) % 7
    const monday = addDays(date, -day)
    return Array.from({length: 7}, (_, i) => addDays(monday, i))
}

const getMonthDates = (date: Date) => {
    const y = date.getFullYear()
    const m = date.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    return Array.from({length: daysInMonth}, (_, i) => new Date(y, m, i + 1))
}

const dateCellKey = (employeeId: string, dateKey: string) => `${employeeId}|${dateKey}`

const isViewMode = (value: string): value is ViewMode =>
    value === 'day' || value === 'week' || value === 'month'

const getInitialViewMode = (): ViewMode => {
    if (typeof window === 'undefined') return 'day'

    try {
        const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
        if (stored && isViewMode(stored)) {
            return stored
        }
    } catch (error) {
        console.error('Failed to read view mode from localStorage:', error)
    }

    return 'day'
}

const getVirtualRange = (
    itemCount: number,
    itemSize: number,
    viewportStartPx: number,
    viewportEndPx: number,
    overscan: number,
) => {
    if (itemCount <= 0) return {start: 0, end: -1}

    const safeStart = Math.max(viewportStartPx, 0)
    const safeEnd = Math.max(viewportEndPx, 0)
    const start = clamp(Math.floor(safeStart / itemSize) - overscan, 0, itemCount - 1)
    const end = clamp(Math.ceil(safeEnd / itemSize) + overscan, 0, itemCount - 1)

    return {start, end}
}

const today = new Date()
const todayKey = dateToKey(today)
const languageOptions: Array<{id: LanguageId; label: string; locale: string}> = [
    {id: 'ru', label: '🇷🇺 Русский', locale: 'ru-RU'},
    {id: 'en', label: '🇺🇸 English', locale: 'en-US'},
    {id: 'es', label: '🇪🇸 Español', locale: 'es-ES'},
    {id: 'fr', label: '🇫🇷 Français', locale: 'fr-FR'},
    {id: 'de', label: '🇩🇪 Deutsch', locale: 'de-DE'},
    {id: 'it', label: '🇮🇹 Italiano', locale: 'it-IT'},
    {id: 'pt', label: '🇵🇹 Português', locale: 'pt-PT'},
    {id: 'tr', label: '🇹🇷 Türkçe', locale: 'tr-TR'},
    {id: 'pl', label: '🇵🇱 Polski', locale: 'pl-PL'},
    {id: 'uk', label: '🇺🇦 Українська', locale: 'uk-UA'},
    {id: 'ar', label: '🇸🇦 العربية', locale: 'ar-SA'},
    {id: 'hi', label: '🇮🇳 हिन्दी', locale: 'hi-IN'},
    {id: 'zh', label: '🇨🇳 中文', locale: 'zh-CN'},
    {id: 'ja', label: '🇯🇵 日本語', locale: 'ja-JP'},
    {id: 'ko', label: '🇰🇷 한국어', locale: 'ko-KR'},
]

const translations: Record<
    LanguageId,
    {
        modeDay: string
        modeWeek: string
        modeMonth: string
        periodDay: string
        periodWeek: string
        periodMonth: string
        dateLabel: string
        addShift: string
        employeeHeader: string
        noShiftsForDate: string
        editShift: string
        createShift: string
        titleLabel: string
        employeeLabel: string
        startLabel: string
        endLabel: string
        delete: string
        cancel: string
        save: string
        invalidDate: string
        invalidTime: string
        endAfterStart: string
        minShiftDuration: string
        defaultShiftTitle: string
        newShiftTitle: string
        helpTitle: string
        helpMobileHint: string
        help1: string
        help2: string
        help3: string
        help4: string
        help5: string
        help6: string
        help7: string
        help8: string
        themeAria: string
        themeLabel: string
        languageLabel: string
        languageAria: string
    }
> = {
    ru: {
        modeDay: 'День', modeWeek: 'Неделя', modeMonth: 'Месяц',
        periodDay: 'День', periodWeek: 'Неделя', periodMonth: 'Месяц',
        dateLabel: 'Дата', addShift: 'Добавить смену', employeeHeader: 'Сотрудник',
        noShiftsForDate: 'На выбранную дату смен нет', editShift: 'Редактировать смену', createShift: 'Добавить смену',
        titleLabel: 'Название', employeeLabel: 'Сотрудник', startLabel: 'Начало', endLabel: 'Конец',
        delete: 'Удалить', cancel: 'Отмена', save: 'Сохранить',
        invalidDate: 'Укажите корректную дату', invalidTime: 'Введите корректное время в формате HH:MM',
        endAfterStart: 'Конец смены должен быть позже начала', minShiftDuration: 'Минимальная длительность смены',
        defaultShiftTitle: 'Смена', newShiftTitle: 'Новая смена',
        helpTitle: 'Как пользоваться WFM', helpMobileHint: 'Для полного функционала удобнее пользоваться на десктопе.',
        help1: 'Выберите режим: День, Неделя или Месяц.', help2: 'Выберите дату в датапикере сверху.',
        help3: 'Добавляйте смены кнопкой "Добавить смену" или двойным кликом по ячейке (десктоп).',
        help4: 'Редактируйте смену двойным кликом (десктоп) или тапом по карточке (мобайл).',
        help5: 'Перетаскивайте смены между ячейками на десктопе с помощью drag and drop.',
        help6: 'На десктопе тяните левый/правый край смены, чтобы изменить начало и конец.',
        help7: 'Удаление доступно в модалке редактирования кнопкой "Удалить".',
        help8: 'В режимах Неделя/Месяц при выборе даты таблица скроллится к дню и подсвечивает заголовок. Внизу страницы можно выбрать тему и язык интерфейса.',
        themeAria: 'Выбор цветовой темы', themeLabel: 'Тема', languageLabel: 'Язык', languageAria: 'Выбор языка интерфейса',
    },
    en: {
        modeDay: 'Day', modeWeek: 'Week', modeMonth: 'Month',
        periodDay: 'Day', periodWeek: 'Week', periodMonth: 'Month',
        dateLabel: 'Date', addShift: 'Add shift', employeeHeader: 'Employee',
        noShiftsForDate: 'No shifts for selected date', editShift: 'Edit shift', createShift: 'Add shift',
        titleLabel: 'Title', employeeLabel: 'Employee', startLabel: 'Start', endLabel: 'End',
        delete: 'Delete', cancel: 'Cancel', save: 'Save',
        invalidDate: 'Enter a valid date', invalidTime: 'Enter a valid time in HH:MM format',
        endAfterStart: 'Shift end must be after start', minShiftDuration: 'Minimum shift duration',
        defaultShiftTitle: 'Shift', newShiftTitle: 'New shift',
        helpTitle: 'How to use WFM', helpMobileHint: 'For full functionality, desktop is recommended.',
        help1: 'Select a mode: Day, Week, or Month.', help2: 'Choose a date in the date picker above.',
        help3: 'Add shifts with the "Add shift" button or by double-clicking a cell (desktop).',
        help4: 'Edit a shift with double-click (desktop) or tap a card (mobile).',
        help5: 'Drag and drop shifts between cells on desktop.',
        help6: 'On desktop, drag the left/right edge of a shift to change start and end.',
        help7: 'Delete is available in the edit modal via the "Delete" button.',
        help8: 'In Week/Month mode, date picker scrolls to the day and highlights the header. At the bottom, you can choose theme and interface language.',
        themeAria: 'Theme selector', themeLabel: 'Theme', languageLabel: 'Language', languageAria: 'Interface language selector',
    },
    es: {modeDay: 'Día', modeWeek: 'Semana', modeMonth: 'Mes', periodDay: 'Día', periodWeek: 'Semana', periodMonth: 'Mes', dateLabel: 'Fecha', addShift: 'Añadir turno', employeeHeader: 'Empleado', noShiftsForDate: 'No hay turnos para la fecha seleccionada', editShift: 'Editar turno', createShift: 'Añadir turno', titleLabel: 'Título', employeeLabel: 'Empleado', startLabel: 'Inicio', endLabel: 'Fin', delete: 'Eliminar', cancel: 'Cancelar', save: 'Guardar', invalidDate: 'Indica una fecha válida', invalidTime: 'Introduce una hora válida en formato HH:MM', endAfterStart: 'El fin debe ser posterior al inicio', minShiftDuration: 'Duración mínima del turno', defaultShiftTitle: 'Turno', newShiftTitle: 'Nuevo turno', helpTitle: 'Cómo usar WFM', helpMobileHint: 'Para todas las funciones, es mejor usar escritorio.', help1: 'Elige un modo: Día, Semana o Mes.', help2: 'Selecciona una fecha en el selector superior.', help3: 'Añade turnos con "Añadir turno" o doble clic en una celda (escritorio).', help4: 'Edita un turno con doble clic (escritorio) o toque en tarjeta (móvil).', help5: 'Arrastra y suelta turnos entre celdas en escritorio.', help6: 'En escritorio, arrastra el borde izquierdo/derecho para cambiar inicio y fin.', help7: 'Puedes eliminar desde la ventana de edición con "Eliminar".', help8: 'En Semana/Mes, el selector desplaza al día y resalta el encabezado.', themeAria: 'Selector de tema', themeLabel: 'Tema', languageLabel: 'Idioma', languageAria: 'Selector de idioma'},
    fr: {modeDay: 'Jour', modeWeek: 'Semaine', modeMonth: 'Mois', periodDay: 'Jour', periodWeek: 'Semaine', periodMonth: 'Mois', dateLabel: 'Date', addShift: 'Ajouter un shift', employeeHeader: 'Employé', noShiftsForDate: 'Aucun shift pour la date sélectionnée', editShift: 'Modifier le shift', createShift: 'Ajouter un shift', titleLabel: 'Titre', employeeLabel: 'Employé', startLabel: 'Début', endLabel: 'Fin', delete: 'Supprimer', cancel: 'Annuler', save: 'Enregistrer', invalidDate: 'Saisissez une date valide', invalidTime: 'Saisissez une heure valide au format HH:MM', endAfterStart: 'La fin doit être après le début', minShiftDuration: 'Durée minimale du shift', defaultShiftTitle: 'Shift', newShiftTitle: 'Nouveau shift', helpTitle: 'Comment utiliser WFM', helpMobileHint: 'Pour toutes les fonctions, le bureau est recommandé.', help1: 'Choisissez un mode : Jour, Semaine ou Mois.', help2: 'Choisissez une date dans le sélecteur en haut.', help3: 'Ajoutez des shifts avec "Ajouter un shift" ou double-clic sur une cellule (bureau).', help4: 'Modifiez un shift avec double-clic (bureau) ou tap sur une carte (mobile).', help5: 'Glissez-déposez les shifts entre cellules sur bureau.', help6: 'Sur bureau, tirez le bord gauche/droit pour modifier début et fin.', help7: 'La suppression est disponible dans la fenêtre d’édition via "Supprimer".', help8: 'En mode Semaine/Mois, la date fait défiler vers le jour et surligne l’en-tête.', themeAria: 'Sélecteur de thème', themeLabel: 'Thème', languageLabel: 'Langue', languageAria: 'Sélecteur de langue'},
    de: {modeDay: 'Tag', modeWeek: 'Woche', modeMonth: 'Monat', periodDay: 'Tag', periodWeek: 'Woche', periodMonth: 'Monat', dateLabel: 'Datum', addShift: 'Schicht hinzufügen', employeeHeader: 'Mitarbeiter', noShiftsForDate: 'Keine Schichten für das gewählte Datum', editShift: 'Schicht bearbeiten', createShift: 'Schicht hinzufügen', titleLabel: 'Titel', employeeLabel: 'Mitarbeiter', startLabel: 'Beginn', endLabel: 'Ende', delete: 'Löschen', cancel: 'Abbrechen', save: 'Speichern', invalidDate: 'Gültiges Datum eingeben', invalidTime: 'Gültige Zeit im Format HH:MM eingeben', endAfterStart: 'Schichtende muss nach Beginn liegen', minShiftDuration: 'Minimale Schichtdauer', defaultShiftTitle: 'Schicht', newShiftTitle: 'Neue Schicht', helpTitle: 'WFM verwenden', helpMobileHint: 'Für volle Funktionalität wird Desktop empfohlen.', help1: 'Modus wählen: Tag, Woche oder Monat.', help2: 'Datum oben im Datepicker wählen.', help3: 'Schichten per "Schicht hinzufügen" oder Doppelklick auf Zelle hinzufügen (Desktop).', help4: 'Schicht per Doppelklick (Desktop) oder Tap auf Karte (Mobil) bearbeiten.', help5: 'Schichten auf Desktop per Drag-and-drop verschieben.', help6: 'Auf Desktop linken/rechten Rand ziehen, um Start/Ende zu ändern.', help7: 'Löschen ist im Bearbeitungsdialog über "Löschen" verfügbar.', help8: 'In Woche/Monat scrollt die Datumsauswahl zum Tag und markiert den Header.', themeAria: 'Theme-Auswahl', themeLabel: 'Thema', languageLabel: 'Sprache', languageAria: 'Sprachauswahl'},
    it: {modeDay: 'Giorno', modeWeek: 'Settimana', modeMonth: 'Mese', periodDay: 'Giorno', periodWeek: 'Settimana', periodMonth: 'Mese', dateLabel: 'Data', addShift: 'Aggiungi turno', employeeHeader: 'Dipendente', noShiftsForDate: 'Nessun turno per la data selezionata', editShift: 'Modifica turno', createShift: 'Aggiungi turno', titleLabel: 'Titolo', employeeLabel: 'Dipendente', startLabel: 'Inizio', endLabel: 'Fine', delete: 'Elimina', cancel: 'Annulla', save: 'Salva', invalidDate: 'Inserisci una data valida', invalidTime: 'Inserisci un orario valido nel formato HH:MM', endAfterStart: 'La fine deve essere dopo l’inizio', minShiftDuration: 'Durata minima turno', defaultShiftTitle: 'Turno', newShiftTitle: 'Nuovo turno', helpTitle: 'Come usare WFM', helpMobileHint: 'Per tutte le funzioni è consigliato il desktop.', help1: 'Scegli una vista: Giorno, Settimana o Mese.', help2: 'Seleziona una data nel date picker in alto.', help3: 'Aggiungi turni con "Aggiungi turno" o doppio clic sulla cella (desktop).', help4: 'Modifica un turno con doppio clic (desktop) o tap sulla card (mobile).', help5: 'Trascina i turni tra le celle su desktop.', help6: 'Su desktop trascina il bordo sinistro/destro per cambiare inizio e fine.', help7: 'Eliminazione disponibile nella modale di modifica con "Elimina".', help8: 'In Settimana/Mese, la data scorre al giorno e illumina l’intestazione.', themeAria: 'Selettore tema', themeLabel: 'Tema', languageLabel: 'Lingua', languageAria: 'Selettore lingua'},
    pt: {modeDay: 'Dia', modeWeek: 'Semana', modeMonth: 'Mês', periodDay: 'Dia', periodWeek: 'Semana', periodMonth: 'Mês', dateLabel: 'Data', addShift: 'Adicionar turno', employeeHeader: 'Funcionário', noShiftsForDate: 'Sem turnos para a data selecionada', editShift: 'Editar turno', createShift: 'Adicionar turno', titleLabel: 'Título', employeeLabel: 'Funcionário', startLabel: 'Início', endLabel: 'Fim', delete: 'Excluir', cancel: 'Cancelar', save: 'Salvar', invalidDate: 'Informe uma data válida', invalidTime: 'Informe uma hora válida no formato HH:MM', endAfterStart: 'O fim deve ser após o início', minShiftDuration: 'Duração mínima do turno', defaultShiftTitle: 'Turno', newShiftTitle: 'Novo turno', helpTitle: 'Como usar o WFM', helpMobileHint: 'Para funcionalidade completa, prefira desktop.', help1: 'Escolha o modo: Dia, Semana ou Mês.', help2: 'Escolha uma data no seletor acima.', help3: 'Adicione turnos com "Adicionar turno" ou duplo clique na célula (desktop).', help4: 'Edite turno com duplo clique (desktop) ou toque no cartão (mobile).', help5: 'Arraste e solte turnos entre células no desktop.', help6: 'No desktop, arraste a borda esquerda/direita para ajustar início e fim.', help7: 'Exclusão disponível no modal de edição em "Excluir".', help8: 'Em Semana/Mês, o seletor rola para o dia e destaca o cabeçalho.', themeAria: 'Seletor de tema', themeLabel: 'Tema', languageLabel: 'Idioma', languageAria: 'Seletor de idioma'},
    tr: {modeDay: 'Gün', modeWeek: 'Hafta', modeMonth: 'Ay', periodDay: 'Gün', periodWeek: 'Hafta', periodMonth: 'Ay', dateLabel: 'Tarih', addShift: 'Vardiya ekle', employeeHeader: 'Çalışan', noShiftsForDate: 'Seçilen tarihte vardiya yok', editShift: 'Vardiya düzenle', createShift: 'Vardiya ekle', titleLabel: 'Başlık', employeeLabel: 'Çalışan', startLabel: 'Başlangıç', endLabel: 'Bitiş', delete: 'Sil', cancel: 'İptal', save: 'Kaydet', invalidDate: 'Geçerli bir tarih girin', invalidTime: 'HH:MM biçiminde geçerli saat girin', endAfterStart: 'Bitiş başlangıçtan sonra olmalı', minShiftDuration: 'Minimum vardiya süresi', defaultShiftTitle: 'Vardiya', newShiftTitle: 'Yeni vardiya', helpTitle: 'WFM nasıl kullanılır', helpMobileHint: 'Tam işlevler için masaüstü önerilir.', help1: 'Mod seçin: Gün, Hafta veya Ay.', help2: 'Yukarıdaki tarih seçiciden bir tarih seçin.', help3: '"Vardiya ekle" ile veya hücreye çift tıklayarak vardiya ekleyin (masaüstü).', help4: 'Vardiyayı çift tıklayarak (masaüstü) veya karta dokunarak (mobil) düzenleyin.', help5: 'Masaüstünde vardiyaları hücreler arasında sürükleyip bırakın.', help6: 'Masaüstünde sol/sağ kenarı sürükleyerek başlangıç ve bitişi değiştirin.', help7: 'Silme, düzenleme penceresinde "Sil" ile yapılır.', help8: 'Hafta/Ay görünümünde tarih seçimi ilgili güne kaydırır ve başlığı vurgular.', themeAria: 'Tema seçici', themeLabel: 'Tema', languageLabel: 'Dil', languageAria: 'Dil seçici'},
    pl: {modeDay: 'Dzień', modeWeek: 'Tydzień', modeMonth: 'Miesiąc', periodDay: 'Dzień', periodWeek: 'Tydzień', periodMonth: 'Miesiąc', dateLabel: 'Data', addShift: 'Dodaj zmianę', employeeHeader: 'Pracownik', noShiftsForDate: 'Brak zmian dla wybranej daty', editShift: 'Edytuj zmianę', createShift: 'Dodaj zmianę', titleLabel: 'Nazwa', employeeLabel: 'Pracownik', startLabel: 'Start', endLabel: 'Koniec', delete: 'Usuń', cancel: 'Anuluj', save: 'Zapisz', invalidDate: 'Podaj poprawną datę', invalidTime: 'Podaj poprawny czas w formacie HH:MM', endAfterStart: 'Koniec zmiany musi być po początku', minShiftDuration: 'Minimalny czas trwania zmiany', defaultShiftTitle: 'Zmiana', newShiftTitle: 'Nowa zmiana', helpTitle: 'Jak korzystać z WFM', helpMobileHint: 'Dla pełnej funkcjonalności zalecany jest desktop.', help1: 'Wybierz tryb: Dzień, Tydzień lub Miesiąc.', help2: 'Wybierz datę w selektorze u góry.', help3: 'Dodaj zmiany przyciskiem „Dodaj zmianę” lub dwuklikiem w komórkę (desktop).', help4: 'Edytuj zmianę dwuklikiem (desktop) lub stuknięciem karty (mobile).', help5: 'Przeciągaj zmiany między komórkami na desktopie.', help6: 'Na desktopie przeciągnij lewą/prawą krawędź zmiany, by zmienić początek i koniec.', help7: 'Usuwanie dostępne w oknie edycji przyciskiem „Usuń”.', help8: 'W trybie Tydzień/Miesiąc wybór daty przewija do dnia i podświetla nagłówek.', themeAria: 'Wybór motywu', themeLabel: 'Motyw', languageLabel: 'Język', languageAria: 'Wybór języka'},
    uk: {modeDay: 'День', modeWeek: 'Тиждень', modeMonth: 'Місяць', periodDay: 'День', periodWeek: 'Тиждень', periodMonth: 'Місяць', dateLabel: 'Дата', addShift: 'Додати зміну', employeeHeader: 'Співробітник', noShiftsForDate: 'На обрану дату змін немає', editShift: 'Редагувати зміну', createShift: 'Додати зміну', titleLabel: 'Назва', employeeLabel: 'Співробітник', startLabel: 'Початок', endLabel: 'Кінець', delete: 'Видалити', cancel: 'Скасувати', save: 'Зберегти', invalidDate: 'Вкажіть коректну дату', invalidTime: 'Введіть коректний час у форматі HH:MM', endAfterStart: 'Кінець зміни має бути пізніше початку', minShiftDuration: 'Мінімальна тривалість зміни', defaultShiftTitle: 'Зміна', newShiftTitle: 'Нова зміна', helpTitle: 'Як користуватися WFM', helpMobileHint: 'Для повного функціоналу зручніше використовувати десктоп.', help1: 'Оберіть режим: День, Тиждень або Місяць.', help2: 'Оберіть дату у дейтпікері вгорі.', help3: 'Додавайте зміни кнопкою "Додати зміну" або подвійним кліком по клітинці (десктоп).', help4: 'Редагуйте зміну подвійним кліком (десктоп) або тапом по картці (мобайл).', help5: 'Перетягуйте зміни між клітинками на десктопі.', help6: 'На десктопі тягніть лівий/правий край зміни для зміни початку і кінця.', help7: 'Видалення доступне в модалці редагування кнопкою "Видалити".', help8: 'У режимах Тиждень/Місяць вибір дати скролить до дня та підсвічує заголовок.', themeAria: 'Вибір теми', themeLabel: 'Тема', languageLabel: 'Мова', languageAria: 'Вибір мови'},
    ar: {modeDay: 'يوم', modeWeek: 'أسبوع', modeMonth: 'شهر', periodDay: 'يوم', periodWeek: 'أسبوع', periodMonth: 'شهر', dateLabel: 'التاريخ', addShift: 'إضافة وردية', employeeHeader: 'الموظف', noShiftsForDate: 'لا توجد ورديات للتاريخ المحدد', editShift: 'تعديل الوردية', createShift: 'إضافة وردية', titleLabel: 'العنوان', employeeLabel: 'الموظف', startLabel: 'البداية', endLabel: 'النهاية', delete: 'حذف', cancel: 'إلغاء', save: 'حفظ', invalidDate: 'أدخل تاريخًا صالحًا', invalidTime: 'أدخل وقتًا صالحًا بصيغة HH:MM', endAfterStart: 'يجب أن تكون النهاية بعد البداية', minShiftDuration: 'الحد الأدنى لمدة الوردية', defaultShiftTitle: 'وردية', newShiftTitle: 'وردية جديدة', helpTitle: 'كيفية استخدام WFM', helpMobileHint: 'لجميع الميزات، يُفضّل استخدام سطح المكتب.', help1: 'اختر العرض: يوم أو أسبوع أو شهر.', help2: 'اختر تاريخًا من منتقي التاريخ بالأعلى.', help3: 'أضف وردية عبر "إضافة وردية" أو بالنقر المزدوج على الخلية (سطح المكتب).', help4: 'حرر الوردية بالنقر المزدوج (سطح المكتب) أو بالنقر على البطاقة (الهاتف).', help5: 'اسحب وأفلت الورديات بين الخلايا على سطح المكتب.', help6: 'على سطح المكتب اسحب الحافة اليسرى/اليمنى لتغيير البداية والنهاية.', help7: 'الحذف متاح في نافذة التعديل بزر "حذف".', help8: 'في وضع الأسبوع/الشهر ينتقل التمرير إلى اليوم ويبرز العنوان.', themeAria: 'اختيار السمة', themeLabel: 'السمة', languageLabel: 'اللغة', languageAria: 'اختيار لغة الواجهة'},
    hi: {modeDay: 'दिन', modeWeek: 'सप्ताह', modeMonth: 'माह', periodDay: 'दिन', periodWeek: 'सप्ताह', periodMonth: 'माह', dateLabel: 'तारीख', addShift: 'शिफ्ट जोड़ें', employeeHeader: 'कर्मचारी', noShiftsForDate: 'चुनी गई तारीख के लिए कोई शिफ्ट नहीं', editShift: 'शिफ्ट संपादित करें', createShift: 'शिफ्ट जोड़ें', titleLabel: 'शीर्षक', employeeLabel: 'कर्मचारी', startLabel: 'शुरुआत', endLabel: 'समाप्ति', delete: 'हटाएँ', cancel: 'रद्द करें', save: 'सहेजें', invalidDate: 'मान्य तारीख दर्ज करें', invalidTime: 'HH:MM प्रारूप में मान्य समय दर्ज करें', endAfterStart: 'समाप्ति समय शुरुआत से बाद का होना चाहिए', minShiftDuration: 'न्यूनतम शिफ्ट अवधि', defaultShiftTitle: 'शिफ्ट', newShiftTitle: 'नई शिफ्ट', helpTitle: 'WFM का उपयोग कैसे करें', helpMobileHint: 'पूरी सुविधा के लिए डेस्कटॉप बेहतर है।', help1: 'मोड चुनें: दिन, सप्ताह या माह।', help2: 'ऊपर डेटपिकर से तारीख चुनें।', help3: '"शिफ्ट जोड़ें" से या सेल पर डबल-क्लिक करके शिफ्ट जोड़ें (डेस्कटॉप)।', help4: 'शिफ्ट को डबल-क्लिक (डेस्कटॉप) या कार्ड टैप (मोबाइल) से संपादित करें।', help5: 'डेस्कटॉप पर drag and drop से शिफ्ट को सेल्स के बीच ले जाएँ।', help6: 'डेस्कटॉप पर बाएँ/दाएँ किनारा खींचकर शुरुआत और समाप्ति बदलें।', help7: 'हटाने का विकल्प एडिट मोडल में "हटाएँ" बटन से उपलब्ध है।', help8: 'सप्ताह/माह मोड में तारीख चुनने पर तालिका उस दिन तक स्क्रॉल होती है और हेडर हाईलाइट होता है।', themeAria: 'थीम चयन', themeLabel: 'थीम', languageLabel: 'भाषा', languageAria: 'इंटरफ़ेस भाषा चयन'},
    zh: {modeDay: '日', modeWeek: '周', modeMonth: '月', periodDay: '日', periodWeek: '周', periodMonth: '月', dateLabel: '日期', addShift: '添加班次', employeeHeader: '员工', noShiftsForDate: '所选日期没有班次', editShift: '编辑班次', createShift: '添加班次', titleLabel: '名称', employeeLabel: '员工', startLabel: '开始', endLabel: '结束', delete: '删除', cancel: '取消', save: '保存', invalidDate: '请输入有效日期', invalidTime: '请输入 HH:MM 格式的有效时间', endAfterStart: '结束时间必须晚于开始时间', minShiftDuration: '最小班次时长', defaultShiftTitle: '班次', newShiftTitle: '新班次', helpTitle: '如何使用 WFM', helpMobileHint: '完整功能建议使用桌面端。', help1: '选择视图：日、周或月。', help2: '在上方日期选择器中选择日期。', help3: '通过“添加班次”按钮或双击单元格添加班次（桌面端）。', help4: '双击班次（桌面端）或点击卡片（移动端）进行编辑。', help5: '在桌面端可拖拽班次到任意单元格。', help6: '在桌面端拖动班次左右边缘以调整开始和结束时间。', help7: '可在编辑弹窗中点击“删除”删除班次。', help8: '在周/月视图中，选择日期后会滚动到对应列并高亮表头。', themeAria: '主题选择', themeLabel: '主题', languageLabel: '语言', languageAria: '界面语言选择'},
    ja: {modeDay: '日', modeWeek: '週', modeMonth: '月', periodDay: '日', periodWeek: '週', periodMonth: '月', dateLabel: '日付', addShift: 'シフト追加', employeeHeader: '従業員', noShiftsForDate: '選択した日付にシフトはありません', editShift: 'シフト編集', createShift: 'シフト追加', titleLabel: 'タイトル', employeeLabel: '従業員', startLabel: '開始', endLabel: '終了', delete: '削除', cancel: 'キャンセル', save: '保存', invalidDate: '有効な日付を入力してください', invalidTime: 'HH:MM 形式で有効な時刻を入力してください', endAfterStart: '終了時刻は開始時刻より後である必要があります', minShiftDuration: '最小シフト時間', defaultShiftTitle: 'シフト', newShiftTitle: '新しいシフト', helpTitle: 'WFMの使い方', helpMobileHint: 'フル機能はデスクトップ利用がおすすめです。', help1: '表示を選択: 日・週・月。', help2: '上部の日付ピッカーで日付を選択。', help3: '「シフト追加」ボタン、またはセルをダブルクリックして追加（デスクトップ）。', help4: 'シフトはダブルクリック（デスクトップ）またはカードをタップ（モバイル）で編集。', help5: 'デスクトップではドラッグ&ドロップでシフトを移動。', help6: 'デスクトップでは左右端をドラッグして開始/終了を変更。', help7: '削除は編集モーダルの「削除」ボタンから。', help8: '週/月表示で日付選択時、該当列へスクロールしてヘッダーを強調表示。', themeAria: 'テーマ選択', themeLabel: 'テーマ', languageLabel: '言語', languageAria: '言語選択'},
    ko: {modeDay: '일', modeWeek: '주', modeMonth: '월', periodDay: '일', periodWeek: '주', periodMonth: '월', dateLabel: '날짜', addShift: '근무 추가', employeeHeader: '직원', noShiftsForDate: '선택한 날짜에 근무가 없습니다', editShift: '근무 수정', createShift: '근무 추가', titleLabel: '제목', employeeLabel: '직원', startLabel: '시작', endLabel: '종료', delete: '삭제', cancel: '취소', save: '저장', invalidDate: '올바른 날짜를 입력하세요', invalidTime: 'HH:MM 형식의 올바른 시간을 입력하세요', endAfterStart: '종료 시간은 시작 시간보다 늦어야 합니다', minShiftDuration: '최소 근무 시간', defaultShiftTitle: '근무', newShiftTitle: '새 근무', helpTitle: 'WFM 사용 방법', helpMobileHint: '전체 기능은 데스크톱 사용이 더 좋습니다.', help1: '보기 선택: 일, 주, 월.', help2: '상단 날짜 선택기에서 날짜 선택.', help3: '"근무 추가" 버튼 또는 셀 더블클릭으로 근무 추가(데스크톱).', help4: '근무는 더블클릭(데스크톱) 또는 카드 탭(모바일)으로 수정.', help5: '데스크톱에서 드래그 앤 드롭으로 근무 이동.', help6: '데스크톱에서 좌/우 가장자리를 드래그해 시작/종료 변경.', help7: '삭제는 수정 모달의 "삭제" 버튼에서 가능.', help8: '주/월 보기에서 날짜 선택 시 해당 열로 스크롤하고 헤더를 강조.', themeAria: '테마 선택', themeLabel: '테마', languageLabel: '언어', languageAria: '인터페이스 언어 선택'},
}
const themeOptions: Array<{id: ThemeId; label: string}> = [
    {id: 'aurora', label: 'Aurora'},
    {id: 'sand', label: 'Sand Dune'},
    {id: 'forest', label: 'Forest Mist'},
    {id: 'sunset', label: 'Sunset Glow'},
    {id: 'ocean', label: 'Ocean Breeze'},
    {id: 'citrus', label: 'Citrus Pop'},
    {id: 'slate', label: 'Slate Graphite'},
    {id: 'rose', label: 'Rose Quartz'},
    {id: 'ice', label: 'Ice Crystal'},
    {id: 'earth', label: 'Earth Clay'},
]

const isThemeId = (value: string): value is ThemeId => themeOptions.some((theme) => theme.id === value)
const isLanguageId = (value: string): value is LanguageId => languageOptions.some((lang) => lang.id === value)

const getInitialTheme = (): ThemeId => {
    if (typeof window === 'undefined') return 'aurora'

    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
        if (stored && isThemeId(stored)) {
            return stored
        }
    } catch (error) {
        console.error('Failed to read theme from localStorage:', error)
    }

    return 'aurora'
}

const getInitialLanguage = (): LanguageId => {
    if (typeof window === 'undefined') return 'ru'

    try {
        const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
        if (stored && isLanguageId(stored)) {
            return stored
        }
    } catch (error) {
        console.error('Failed to read language from localStorage:', error)
    }

    return 'ru'
}

const getInitialSelectedDate = (): Date => {
    if (typeof window === 'undefined') return new Date()

    try {
        const stored = window.localStorage.getItem(SELECTED_DATE_STORAGE_KEY)
        if (stored) {
            const parsed = parseDateKey(stored)
            if (parsed) return parsed
        }
    } catch (error) {
        console.error('Failed to read selected date from localStorage:', error)
    }

    return new Date()
}

const initialShifts: Shift[] = [
    {
        id: crypto.randomUUID(),
        employeeId: 'e1',
        dateKey: todayKey,
        title: 'Утро',
        start: 9 * 60,
        end: 13 * 60,
    },
    {
        id: crypto.randomUUID(),
        employeeId: 'e2',
        dateKey: todayKey,
        title: 'День',
        start: 12 * 60,
        end: 18 * 60,
    },
    {
        id: crypto.randomUUID(),
        employeeId: 'e3',
        dateKey: dateToKey(addDays(today, 1)),
        title: 'Вечер',
        start: 15 * 60,
        end: 21 * 60,
    },
]

function App() {
    const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode)
    const [themeId, setThemeId] = useState<ThemeId>(getInitialTheme)
    const [languageId, setLanguageId] = useState<LanguageId>(getInitialLanguage)
    const [selectedDate, setSelectedDate] = useState<Date>(getInitialSelectedDate)
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth <= MOBILE_BREAKPOINT : false,
    )
    const [mobileDateKey, setMobileDateKey] = useState(todayKey)
    const [shifts, setShifts] = useState<Shift[]>(initialShifts)
    const [draggingShiftId, setDraggingShiftId] = useState<string | null>(null)
    const [resizeState, setResizeState] = useState<ResizeState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [modalDraft, setModalDraft] = useState<ModalDraft | null>(null)
    const [highlightedColumnDateKey, setHighlightedColumnDateKey] = useState<string | null>(null)
    const [isStorageReady, setIsStorageReady] = useState(false)
    const [virtualViewport, setVirtualViewport] = useState<VirtualViewport>({
        width: 0,
        height: 0,
        scrollTop: 0,
        scrollLeft: 0,
    })

    const resizingRef = useRef(false)
    const gridViewportRef = useRef<HTMLElement | null>(null)
    const datepickerTargetDateKeyRef = useRef<string | null>(null)
    const highlightTimerRef = useRef<number | null>(null)

    const selectedDateKey = useMemo(() => dateToKey(selectedDate), [selectedDate])

    const visibleDates = useMemo(() => {
        if (viewMode === 'day') return [selectedDate]
        if (viewMode === 'week') return getWeekDates(selectedDate)
        return getMonthDates(selectedDate)
    }, [selectedDate, viewMode])

    const shiftsByEmployeeDate = useMemo(() => {
        const map = new Map<string, Shift[]>()

        for (const shift of shifts) {
            const key = dateCellKey(shift.employeeId, shift.dateKey)
            const list = map.get(key)
            if (list) {
                list.push(shift)
            } else {
                map.set(key, [shift])
            }
        }

        for (const list of map.values()) {
            list.sort((a, b) => a.start - b.start)
        }

        return map
    }, [shifts])

    const getShiftsForCell = (employeeId: string, dateKey: string) => {
        return shiftsByEmployeeDate.get(dateCellKey(employeeId, dateKey)) ?? []
    }

    const columnCount = viewMode === 'day' ? HOURS.length : visibleDates.length
    const employeeColumnWidth =
        virtualViewport.width > 0 && virtualViewport.width <= MOBILE_BREAKPOINT
            ? EMPLOYEE_COLUMN_WIDTH_MOBILE
            : EMPLOYEE_COLUMN_WIDTH_DESKTOP
    const weekAdaptiveColumnWidth =
        viewMode === 'week' && !isMobile && virtualViewport.width > 0
            ? Math.max((virtualViewport.width - employeeColumnWidth) / 7, 1)
            : DATE_CELL_WIDTH
    const columnWidth = viewMode === 'day' ? HOUR_WIDTH : weekAdaptiveColumnWidth
    const dateTimelineHourWidth = Math.max((columnWidth - DATE_CELL_PADDING * 2) / 24, 1)
    const totalTimelineWidth = columnCount * columnWidth
    const totalGridWidth = employeeColumnWidth + totalTimelineWidth
    const totalGridHeight = HEADER_HEIGHT + employees.length * ROW_HEIGHT

    useEffect(() => {
        const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
        const onChange = () => setIsMobile(mediaQuery.matches)

        onChange()
        mediaQuery.addEventListener('change', onChange)

        return () => mediaQuery.removeEventListener('change', onChange)
    }, [])

    useEffect(() => {
        try {
            window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode)
        } catch (error) {
            console.error('Failed to save view mode to localStorage:', error)
        }
    }, [viewMode])

    useEffect(() => {
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, themeId)
        } catch (error) {
            console.error('Failed to save theme to localStorage:', error)
        }
    }, [themeId])

    useEffect(() => {
        try {
            window.localStorage.setItem(LANGUAGE_STORAGE_KEY, languageId)
        } catch (error) {
            console.error('Failed to save language to localStorage:', error)
        }
    }, [languageId])

    useEffect(() => {
        try {
            window.localStorage.setItem(SELECTED_DATE_STORAGE_KEY, dateToKey(selectedDate))
        } catch (error) {
            console.error('Failed to save selected date to localStorage:', error)
        }
    }, [selectedDate])

    useEffect(() => {
        const viewport = gridViewportRef.current
        if (!viewport) return

        const updateViewport = () => {
            setVirtualViewport({
                width: viewport.clientWidth,
                height: viewport.clientHeight,
                scrollTop: viewport.scrollTop,
                scrollLeft: viewport.scrollLeft,
            })
        }

        updateViewport()

        const onScroll = () => {
            setVirtualViewport((prev) => ({
                ...prev,
                scrollTop: viewport.scrollTop,
                scrollLeft: viewport.scrollLeft,
            }))
        }

        viewport.addEventListener('scroll', onScroll, {passive: true})

        const resizeObserver = new ResizeObserver(updateViewport)
        resizeObserver.observe(viewport)

        return () => {
            viewport.removeEventListener('scroll', onScroll)
            resizeObserver.disconnect()
        }
    }, [])

    useEffect(() => {
        const viewport = gridViewportRef.current
        if (!viewport) return

        const maxScrollLeft = Math.max(totalGridWidth - viewport.clientWidth, 0)
        const maxScrollTop = Math.max(totalGridHeight - viewport.clientHeight, 0)

        if (viewport.scrollLeft > maxScrollLeft) {
            viewport.scrollLeft = maxScrollLeft
        }

        if (viewport.scrollTop > maxScrollTop) {
            viewport.scrollTop = maxScrollTop
        }

        setVirtualViewport({
            width: viewport.clientWidth,
            height: viewport.clientHeight,
            scrollTop: viewport.scrollTop,
            scrollLeft: viewport.scrollLeft,
        })
    }, [totalGridHeight, totalGridWidth])

    useEffect(() => {
        if (isMobile) return
        if (viewMode !== 'week' && viewMode !== 'month') return

        const targetDateKey = datepickerTargetDateKeyRef.current
        if (!targetDateKey) return

        const viewport = gridViewportRef.current
        if (!viewport) return

        const targetIndex = visibleDates.findIndex((date) => dateToKey(date) === targetDateKey)
        if (targetIndex < 0) {
            datepickerTargetDateKeyRef.current = null
            return
        }

        const timelineViewportWidth = Math.max(viewport.clientWidth - employeeColumnWidth, columnWidth)
        const targetColumnLeft = targetIndex * columnWidth
        const targetColumnRight = targetColumnLeft + columnWidth
        const currentTimelineLeft = viewport.scrollLeft
        const currentTimelineRight = currentTimelineLeft + timelineViewportWidth

        if (targetColumnLeft >= currentTimelineLeft && targetColumnRight <= currentTimelineRight) {
            datepickerTargetDateKeyRef.current = null
            return
        }

        const maxScrollLeft = Math.max(totalGridWidth - viewport.clientWidth, 0)
        const centeredScrollLeft = clamp(
            targetColumnLeft - Math.max((timelineViewportWidth - columnWidth) / 2, 0),
            0,
            maxScrollLeft,
        )

        viewport.scrollTo({
            left: centeredScrollLeft,
            behavior: 'smooth',
        })

        datepickerTargetDateKeyRef.current = null
    }, [columnWidth, employeeColumnWidth, isMobile, totalGridWidth, viewMode, visibleDates])

    useEffect(() => {
        if (isMobile) return
        if (viewMode !== 'week' && viewMode !== 'month') return
        datepickerTargetDateKeyRef.current = selectedDateKey
    }, [isMobile, selectedDateKey, viewMode])

    useEffect(() => {
        return () => {
            if (highlightTimerRef.current !== null) {
                window.clearTimeout(highlightTimerRef.current)
            }
        }
    }, [])

    const bodyStartPx = Math.max(virtualViewport.scrollTop - HEADER_HEIGHT, 0)
    const bodyEndPx = bodyStartPx + Math.max(virtualViewport.height - HEADER_HEIGHT, 0)

    const timelineStartPx = Math.max(virtualViewport.scrollLeft - employeeColumnWidth, 0)
    const timelineEndPx = timelineStartPx + Math.max(virtualViewport.width - employeeColumnWidth, 0)

    const visibleRowRange = getVirtualRange(
        employees.length,
        ROW_HEIGHT,
        bodyStartPx,
        bodyEndPx,
        ROW_OVERSCAN,
    )
    const visibleColumnRange = getVirtualRange(
        columnCount,
        columnWidth,
        timelineStartPx,
        timelineEndPx,
        COLUMN_OVERSCAN,
    )

    const visibleRowIndexes = useMemo(() => {
        if (visibleRowRange.end < visibleRowRange.start) return []
        const size = visibleRowRange.end - visibleRowRange.start + 1
        return Array.from({length: size}, (_, i) => visibleRowRange.start + i)
    }, [visibleRowRange.end, visibleRowRange.start])

    const visibleColumnIndexes = useMemo(() => {
        if (visibleColumnRange.end < visibleColumnRange.start) return []
        const size = visibleColumnRange.end - visibleColumnRange.start + 1
        return Array.from({length: size}, (_, i) => visibleColumnRange.start + i)
    }, [visibleColumnRange.end, visibleColumnRange.start])

    useEffect(() => {
        let isCancelled = false

        void loadShiftsFromIndexedDb()
            .then((storedShifts) => {
                if (isCancelled) return
                if (storedShifts) {
                    setShifts(storedShifts.map((shift) => ({...shift})))
                }
                setIsStorageReady(true)
            })
            .catch((error) => {
                console.error('Failed to load shifts from IndexedDB:', error)
                if (!isCancelled) {
                    setIsStorageReady(true)
                }
            })

        return () => {
            isCancelled = true
        }
    }, [])

    useEffect(() => {
        if (!isStorageReady) return

        void saveShiftsToIndexedDb(shifts).catch((error) => {
            console.error('Failed to save shifts to IndexedDB:', error)
        })
    }, [isStorageReady, shifts])

    useEffect(() => {
        if (!resizeState) return

        const onPointerMove = (event: PointerEvent) => {
            const deltaPx = event.clientX - resizeState.originX
            const deltaMinutes = snapToStep((deltaPx / resizeState.pixelsPerHour) * 60)

            setShifts((prev) =>
                prev.map((shift) => {
                    if (shift.id !== resizeState.shiftId) return shift

                    if (resizeState.edge === 'left') {
                        const nextStart = clamp(
                            resizeState.originStart + deltaMinutes,
                            0,
                            resizeState.originEnd - MIN_SHIFT_MINUTES,
                        )
                        return {...shift, start: nextStart, end: resizeState.originEnd}
                    }

                    const nextEnd = clamp(
                        resizeState.originEnd + deltaMinutes,
                        resizeState.originStart + MIN_SHIFT_MINUTES,
                        MINUTES_IN_DAY,
                    )
                    return {...shift, start: resizeState.originStart, end: nextEnd}
                }),
            )
        }

        const onPointerUp = () => {
            resizingRef.current = false
            setResizeState(null)
            document.body.style.userSelect = ''
        }

        document.body.style.userSelect = 'none'
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)

        return () => {
            resizingRef.current = false
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
            document.body.style.userSelect = ''
        }
    }, [resizeState])

    const openCreateShiftModal = (employeeId: string, dateKey: string, startMinutes: number) => {
        const snappedStart = snapToStep(startMinutes)
        const defaultEnd = clamp(snappedStart + 4 * 60, snappedStart + MIN_SHIFT_MINUTES, MAX_MODAL_MINUTES)

        setError(null)
        setModalDraft({
            mode: 'create',
            employeeId,
            dateKey,
            title: translations[languageId].newShiftTitle,
            startTime: formatTime(snappedStart),
            endTime: formatTime(defaultEnd),
        })
    }

    const openEditShiftModal = (shift: Shift) => {
        setError(null)
        setModalDraft({
            mode: 'edit',
            shiftId: shift.id,
            employeeId: shift.employeeId,
            dateKey: shift.dateKey,
            title: shift.title,
            startTime: formatTime(shift.start),
            endTime: formatTime(shift.end),
        })
    }

    const closeModal = () => {
        setModalDraft(null)
        setError(null)
    }

    const handleSaveShift = (event: FormEvent) => {
        event.preventDefault()
        if (!modalDraft) return

        if (!parseDateKey(modalDraft.dateKey)) {
            setError(translations[languageId].invalidDate)
            return
        }

        const start = parseTime(modalDraft.startTime)
        const end = parseTime(modalDraft.endTime)

        if (start === null || end === null) {
            setError(translations[languageId].invalidTime)
            return
        }

        const snappedStart = snapToStep(start)
        const snappedEnd = snapToStep(end)

        if (snappedEnd <= snappedStart) {
            setError(translations[languageId].endAfterStart)
            return
        }

        if (snappedEnd - snappedStart < MIN_SHIFT_MINUTES) {
            setError(`${translations[languageId].minShiftDuration} — ${MIN_SHIFT_MINUTES} min`)
            return
        }

        if (modalDraft.mode === 'edit' && modalDraft.shiftId) {
            setShifts((prev) =>
                prev.map((shift) =>
                    shift.id === modalDraft.shiftId
                        ? {
                            ...shift,
                            employeeId: modalDraft.employeeId,
                            dateKey: modalDraft.dateKey,
                            title: modalDraft.title.trim() || translations[languageId].defaultShiftTitle,
                            start: snappedStart,
                            end: snappedEnd,
                        }
                        : shift,
                ),
            )
        } else {
            setShifts((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    employeeId: modalDraft.employeeId,
                    dateKey: modalDraft.dateKey,
                    title: modalDraft.title.trim() || translations[languageId].defaultShiftTitle,
                    start: snappedStart,
                    end: snappedEnd,
                },
            ])
        }

        closeModal()
    }

    const handleDeleteShift = () => {
        if (!modalDraft || modalDraft.mode !== 'edit' || !modalDraft.shiftId) return
        setShifts((prev) => prev.filter((shift) => shift.id !== modalDraft.shiftId))
        closeModal()
    }

    const handleDragStart = (event: DragEvent<HTMLDivElement>, shift: Shift) => {
        if (resizeState || resizingRef.current) {
            event.preventDefault()
            return
        }

        event.dataTransfer.setData('text/plain', shift.id)
        event.dataTransfer.effectAllowed = 'move'
        setDraggingShiftId(shift.id)
    }

    const handleDropOnTimeline = (event: DragEvent<HTMLDivElement>, employeeId: string, dateKey: string) => {
        event.preventDefault()
        const shiftId = event.dataTransfer.getData('text/plain')

        if (!shiftId) return

        const timelineRect = event.currentTarget.getBoundingClientRect()
        const x = clamp(event.clientX - timelineRect.left, 0, timelineRect.width - 1)
        const hourIndex = clamp(Math.floor(x / HOUR_WIDTH), 0, HOURS.length - 1)
        const cellStart = hourIndex * 60

        setShifts((prev) =>
            prev.map((shift) => {
                if (shift.id !== shiftId) return shift

                const duration = shift.end - shift.start
                const nextStart = clamp(cellStart, 0, MINUTES_IN_DAY - duration)

                return {
                    ...shift,
                    employeeId,
                    dateKey,
                    start: nextStart,
                    end: nextStart + duration,
                }
            }),
        )

        setDraggingShiftId(null)
    }

    const handleDropOnDateCell = (event: DragEvent<HTMLDivElement>, employeeId: string, dateKey: string) => {
        event.preventDefault()
        const shiftId = event.dataTransfer.getData('text/plain')

        if (!shiftId) return

        setShifts((prev) =>
            prev.map((shift) => (shift.id === shiftId ? {...shift, employeeId, dateKey} : shift)),
        )

        setDraggingShiftId(null)
    }

    const startResize = (
        event: ReactPointerEvent<HTMLDivElement>,
        shift: Shift,
        edge: 'left' | 'right',
        pixelsPerHour: number,
    ) => {
        event.preventDefault()
        event.stopPropagation()
        resizingRef.current = true
        setDraggingShiftId(null)

        setResizeState({
            shiftId: shift.id,
            edge,
            originX: event.clientX,
            originStart: shift.start,
            originEnd: shift.end,
            pixelsPerHour,
        })
    }

    const onDatepickerChange = (value: string) => {
        const parsed = parseDateKey(value)
        if (!parsed) return

        const parsedDateKey = dateToKey(parsed)
        datepickerTargetDateKeyRef.current = parsedDateKey
        setSelectedDate(parsed)

        if (!isMobile && (viewMode === 'week' || viewMode === 'month')) {
            setHighlightedColumnDateKey(parsedDateKey)

            if (highlightTimerRef.current !== null) {
                window.clearTimeout(highlightTimerRef.current)
            }

            highlightTimerRef.current = window.setTimeout(() => {
                setHighlightedColumnDateKey(null)
                highlightTimerRef.current = null
            }, 2000)
        }
    }

    const handleViewModeChange = (mode: ViewMode) => {
        setViewMode(mode)

        if (!isMobile && (mode === 'week' || mode === 'month')) {
            const targetDateKey = dateToKey(selectedDate)
            datepickerTargetDateKeyRef.current = targetDateKey
            setHighlightedColumnDateKey(targetDateKey)

            if (highlightTimerRef.current !== null) {
                window.clearTimeout(highlightTimerRef.current)
            }

            highlightTimerRef.current = window.setTimeout(() => {
                setHighlightedColumnDateKey(null)
                highlightTimerRef.current = null
            }, 2000)
        }
    }

    const activeLocale = languageOptions.find((lang) => lang.id === languageId)?.locale ?? 'ru-RU'
    const weekdayFormatter = useMemo(() => new Intl.DateTimeFormat(activeLocale, {weekday: 'short'}), [activeLocale])
    const shortDateFormatter = useMemo(() => new Intl.DateTimeFormat(activeLocale, {day: '2-digit', month: '2-digit'}), [activeLocale])
    const fullDateFormatter = useMemo(
        () =>
            new Intl.DateTimeFormat(activeLocale, {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
            }),
        [activeLocale],
    )
    const monthYearFormatter = useMemo(
        () => new Intl.DateTimeFormat(activeLocale, {month: 'long', year: 'numeric'}),
        [activeLocale],
    )
    const t = translations[languageId]

    const periodLabel =
        viewMode === 'day'
            ? `${t.periodDay}: ${fullDateFormatter.format(selectedDate)}`
            : viewMode === 'week'
                ? `${t.periodWeek}: ${shortDateFormatter.format(visibleDates[0])} - ${shortDateFormatter.format(visibleDates[6])}`
                : `${t.periodMonth}: ${monthYearFormatter.format(selectedDate)}`

    const mobileDateOptions = useMemo(
        () => visibleDates.map((date) => ({key: dateToKey(date), date})),
        [visibleDates],
    )
    const fallbackMobileDateKey = mobileDateOptions[0]?.key ?? selectedDateKey
    const effectiveMobileDateKey = mobileDateOptions.some((option) => option.key === mobileDateKey)
        ? mobileDateKey
        : fallbackMobileDateKey
    const mobileActiveDate =
        mobileDateOptions.find((option) => option.key === effectiveMobileDateKey) ?? mobileDateOptions[0]
    const mobileActiveDateKey = mobileActiveDate?.key ?? selectedDateKey
    const toolbarDateKey = isMobile ? mobileActiveDateKey : selectedDateKey

    return (
        <div className={styles.page} data-theme={themeId}>
            <header className={styles.header}>
                <div className={styles.headerTop}>
                    <h1>WFM Scheduler</h1>
                </div>
                <div className={styles.toolbar}>
                    <div className={styles.modeControls}>
                        <div className={styles.viewSwitch}>
                            {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => handleViewModeChange(mode)}
                                    className={`${styles.viewButton} ${viewMode === mode ? styles.activeView : ''}`}
                                >
                                    {mode === 'day' ? t.modeDay : mode === 'week' ? t.modeWeek : t.modeMonth}
                                </button>
                            ))}
                        </div>
                        <div className={styles.periodBadge}>{periodLabel}</div>
                    </div>

                    <div className={styles.dateControls}>
                        <label className={styles.datepickerLabel}>
                            {t.dateLabel}
                            <input
                                type="date"
                                value={selectedDateKey}
                                onChange={(event) => onDatepickerChange(event.target.value)}
                                className={styles.datepicker}
                            />
                        </label>
                        <button
                            type="button"
                            className={styles.toolbarAddButton}
                            onClick={() => openCreateShiftModal(employees[0].id, toolbarDateKey, DEFAULT_SHIFT_START)}
                        >
                            {t.addShift}
                        </button>
                    </div>
                </div>
            </header>

            {isMobile ? (
                <section className={styles.mobileBoard}>
                    <div className={styles.mobileDateRail}>
                        {mobileDateOptions.map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                className={`${styles.mobileDateButton} ${mobileActiveDateKey === option.key ? styles.mobileDateButtonActive : ''}`}
                                onClick={() => setMobileDateKey(option.key)}
                            >
                                <span>{weekdayFormatter.format(option.date)}</span>
                                <strong>{shortDateFormatter.format(option.date)}</strong>
                            </button>
                        ))}
                    </div>

                    <div className={styles.mobileEmployeeList}>
                        {employees.map((employee) => {
                            const dayShifts = getShiftsForCell(employee.id, mobileActiveDateKey)

                            return (
                                <article key={`mobile-${employee.id}`} className={styles.mobileEmployeeCard}>
                                    <div className={styles.mobileEmployeeCardHeader}>
                                        <h3>{employee.name}</h3>
                                        <button
                                            type="button"
                                            className={styles.mobileAddButton}
                                            onClick={() => openCreateShiftModal(employee.id, mobileActiveDateKey, DEFAULT_SHIFT_START)}
                                        >
                                            {t.addShift}
                                        </button>
                                    </div>

                                    {dayShifts.length === 0 ? (
                                        <p className={styles.mobileEmpty}>{t.noShiftsForDate}</p>
                                    ) : (
                                        <div className={styles.mobileShiftList}>
                                            {dayShifts.map((shift) => (
                                                <button
                                                    key={shift.id}
                                                    type="button"
                                                    className={styles.mobileShiftCard}
                                                    onClick={() => openEditShiftModal(shift)}
                                                >
                                                    <strong>{shift.title}</strong>
                                                    <span>
                            {formatTime(shift.start)}-{formatTime(shift.end)}
                          </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </article>
                            )
                        })}
                    </div>
                </section>
            ) : (
                <section className={styles.gridWrapper} ref={gridViewportRef}>
                    <div className={styles.virtualCanvas} style={{width: totalGridWidth, height: totalGridHeight}}>
                        <div className={styles.virtualHeader} style={{height: HEADER_HEIGHT}}>
                            <div className={styles.employeeHeader} style={{width: employeeColumnWidth}}>
                                {t.employeeHeader}
                            </div>

                            <div className={styles.virtualHeaderTimeline} style={{width: totalTimelineWidth}}>
                                {visibleColumnIndexes.map((columnIndex) => {
                                    const left = columnIndex * columnWidth

                                    if (viewMode === 'day') {
                                        const hour = HOURS[columnIndex]

                                        return (
                                            <div key={`header-hour-${hour}`} className={styles.virtualHourHeaderCell}
                                                 style={{left, width: columnWidth}}>
                                                {String(hour).padStart(2, '0')}:00
                                            </div>
                                        )
                                    }

                                    const date = visibleDates[columnIndex]
                                    if (!date) return null
                                    const headerDateKey = dateToKey(date)

                                    return (
                                        <div
                                            key={`header-date-${headerDateKey}`}
                                            className={`${styles.virtualDateHeaderCell} ${headerDateKey === todayKey ? styles.todayDateHeader : ''} ${headerDateKey === highlightedColumnDateKey ? styles.highlightedDateColumn : ''}`}
                                            style={{left, width: columnWidth}}
                                        >
                                            <span>{weekdayFormatter.format(date)}</span>
                                            <strong>{shortDateFormatter.format(date)}</strong>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        {visibleRowIndexes.map((rowIndex) => {
                            const employee = employees[rowIndex]
                            const rowTop = HEADER_HEIGHT + rowIndex * ROW_HEIGHT

                            if (viewMode === 'day') {
                                const employeeShifts = getShiftsForCell(employee.id, selectedDateKey)

                                return (
                                    <div
                                        key={`row-day-${employee.id}`}
                                        className={styles.virtualRow}
                                        style={{top: rowTop, height: ROW_HEIGHT, width: totalGridWidth}}
                                    >
                                        <div className={styles.employeeName} style={{width: employeeColumnWidth}}>
                                            {employee.name}
                                        </div>

                                        <div
                                            className={styles.virtualDayTimeline}
                                            style={{width: totalTimelineWidth}}
                                            onDragOver={(event) => event.preventDefault()}
                                            onDrop={(event) => handleDropOnTimeline(event, employee.id, selectedDateKey)}
                                        >
                                            {visibleColumnIndexes.map((columnIndex) => {
                                                const left = columnIndex * columnWidth
                                                const cellStart = columnIndex * 60

                                                return (
                                                    <div
                                                        key={`day-cell-${employee.id}-${columnIndex}`}
                                                        className={styles.virtualTimelineCell}
                                                        style={{left, width: columnWidth}}
                                                        onDoubleClick={() => openCreateShiftModal(employee.id, selectedDateKey, cellStart)}
                                                    />
                                                )
                                            })}

                                            <div className={styles.shiftsLayer}>
                                                {employeeShifts.map((shift) => {
                                                    const left = (shift.start / 60) * HOUR_WIDTH
                                                    const width = ((shift.end - shift.start) / 60) * HOUR_WIDTH

                                                    return (
                                                        <div
                                                            key={shift.id}
                                                            className={`${styles.shift} ${draggingShiftId === shift.id ? styles.dragging : ''}`}
                                                            draggable={!resizeState}
                                                            onDragStart={(event) => handleDragStart(event, shift)}
                                                            onDragEnd={() => setDraggingShiftId(null)}
                                                            onDoubleClick={(event) => {
                                                                event.stopPropagation()
                                                                openEditShiftModal(shift)
                                                            }}
                                                            style={{left, width}}
                                                        >
                                                            <div
                                                                className={`${styles.resizeHandle} ${styles.left}`}
                                                                onPointerDown={(event) => startResize(event, shift, 'left', HOUR_WIDTH)}
                                                                onDragStart={(event) => event.preventDefault()}
                                                            />

                                                            <div className={styles.shiftContent}>
                                                                <strong>{shift.title}</strong>
                                                                <span>
                                {formatTime(shift.start)}-{formatTime(shift.end)}
                              </span>
                                                            </div>

                                                            <div
                                                                className={`${styles.resizeHandle} ${styles.right}`}
                                                                onPointerDown={(event) => startResize(event, shift, 'right', HOUR_WIDTH)}
                                                                onDragStart={(event) => event.preventDefault()}
                                                            />
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                )
                            }

                            return (
                                <div
                                    key={`row-date-${employee.id}`}
                                    className={styles.virtualRow}
                                    style={{top: rowTop, height: ROW_HEIGHT, width: totalGridWidth}}
                                >
                                    <div className={styles.employeeName} style={{width: employeeColumnWidth}}>
                                        {employee.name}
                                    </div>

                                    <div className={styles.virtualDateTimeline} style={{width: totalTimelineWidth}}>
                                        {visibleColumnIndexes.map((columnIndex) => {
                                            const date = visibleDates[columnIndex]
                                            if (!date) return null

                                            const left = columnIndex * columnWidth
                                            const dateKey = dateToKey(date)
                                            const cellShifts = getShiftsForCell(employee.id, dateKey)
                                            const timelineInnerHeight = ROW_HEIGHT - 12
                                            const shiftCount = Math.max(cellShifts.length, 1)
                                            const availableHeight = Math.max(
                                                timelineInnerHeight - (shiftCount - 1) * DATE_CHIP_GAP,
                                                0,
                                            )
                                            const laneHeight = availableHeight / shiftCount

                                            return (
                                                <div
                                                    key={`date-cell-${employee.id}-${dateKey}`}
                                                    className={styles.virtualDateCell}
                                                    style={{left, width: columnWidth}}
                                                    onDoubleClick={() => openCreateShiftModal(employee.id, dateKey, DEFAULT_SHIFT_START)}
                                                    onDragOver={(event) => event.preventDefault()}
                                                    onDrop={(event) => handleDropOnDateCell(event, employee.id, dateKey)}
                                                >
                                                    <div className={styles.dateTimeline}
                                                         style={{minHeight: ROW_HEIGHT - 12}}>
                                                        {cellShifts.map((shift, index) => {
                                                            const chipLeft = (shift.start / 60) * dateTimelineHourWidth
                                                            const chipWidth = Math.max(((shift.end - shift.start) / 60) * dateTimelineHourWidth, 22)

                                                            return (
                                                                <div
                                                                    key={shift.id}
                                                                    className={`${styles.shiftChip} ${draggingShiftId === shift.id ? styles.dragging : ''}`}
                                                                    draggable={!resizeState}
                                                                    onDragStart={(event) => handleDragStart(event, shift)}
                                                                    onDragEnd={() => setDraggingShiftId(null)}
                                                                    onDoubleClick={(event) => {
                                                                        event.stopPropagation()
                                                                        openEditShiftModal(shift)
                                                                    }}
                                                                    style={{
                                                                        left: chipLeft,
                                                                        width: chipWidth,
                                                                        top: index * (laneHeight + DATE_CHIP_GAP),
                                                                        height: laneHeight,
                                                                    }}
                                                                >
                                                                    <div
                                                                        className={`${styles.resizeHandle} ${styles.left}`}
                                                                        onPointerDown={(event) => startResize(event, shift, 'left', dateTimelineHourWidth)}
                                                                        onDragStart={(event) => event.preventDefault()}
                                                                    />

                                                                    <div className={styles.shiftChipContent}>
                                                                        <strong>{shift.title}</strong>
                                                                        <span>
                                    {formatTime(shift.start)}-{formatTime(shift.end)}
                                  </span>
                                                                    </div>

                                                                    <div
                                                                        className={`${styles.resizeHandle} ${styles.right}`}
                                                                        onPointerDown={(event) => startResize(event, shift, 'right', dateTimelineHourWidth)}
                                                                        onDragStart={(event) => event.preventDefault()}
                                                                    />
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </section>
            )}

            {modalDraft && (
                <div className={styles.modalBackdrop} role="presentation" onClick={closeModal}>
                    <div className={styles.modal} role="dialog" aria-modal="true"
                         onClick={(event) => event.stopPropagation()}>
                        <h2>{modalDraft.mode === 'edit' ? t.editShift : t.createShift}</h2>

                        <form className={styles.modalForm} onSubmit={handleSaveShift}>
                            <label>
                                {t.titleLabel}
                                <input
                                    value={modalDraft.title}
                                    onChange={(event) =>
                                        setModalDraft((prev) => (prev ? {...prev, title: event.target.value} : prev))
                                    }
                                />
                            </label>

                            <label>
                                {t.employeeLabel}
                                <select
                                    value={modalDraft.employeeId}
                                    onChange={(event) =>
                                        setModalDraft((prev) => (prev ? {
                                            ...prev,
                                            employeeId: event.target.value
                                        } : prev))
                                    }
                                >
                                    {employees.map((employee) => (
                                        <option key={employee.id} value={employee.id}>
                                            {employee.name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label>
                                {t.dateLabel}
                                <input
                                    type="date"
                                    value={modalDraft.dateKey}
                                    onChange={(event) =>
                                        setModalDraft((prev) => (prev ? {...prev, dateKey: event.target.value} : prev))
                                    }
                                />
                            </label>

                            <label>
                                {t.startLabel}
                                <input
                                    type="time"
                                    step={SNAP_MINUTES * 60}
                                    value={modalDraft.startTime}
                                    onChange={(event) =>
                                        setModalDraft((prev) => (prev ? {
                                            ...prev,
                                            startTime: event.target.value
                                        } : prev))
                                    }
                                />
                            </label>

                            <label>
                                {t.endLabel}
                                <input
                                    type="time"
                                    step={SNAP_MINUTES * 60}
                                    value={modalDraft.endTime}
                                    onChange={(event) =>
                                        setModalDraft((prev) => (prev ? {...prev, endTime: event.target.value} : prev))
                                    }
                                />
                            </label>

                            {error && <p className={styles.error}>{error}</p>}

                            <div className={styles.modalActions}>
                                <button
                                    type="button"
                                    onClick={handleDeleteShift}
                                    className={styles.dangerButton}
                                    disabled={modalDraft.mode !== 'edit'}
                                >
                                    {t.delete}
                                </button>
                                <button type="button" onClick={closeModal} className={styles.ghostButton}>
                                    {t.cancel}
                                </button>
                                <button type="submit" className={styles.primaryButton}>
                                    {modalDraft.mode === 'edit' ? t.save : t.addShift}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <footer className={styles.helpSection}>
                <h3>{t.helpTitle}</h3>
                <ol>
                    {isMobile && (
                        <li className={styles.mobileDesktopHint}>{t.helpMobileHint}</li>
                    )}
                    <li>{t.help1}</li>
                    <li>{t.help2}</li>
                    <li>{t.help3}</li>
                    <li>{t.help4}</li>
                    <li>{t.help5}</li>
                    <li>{t.help6}</li>
                    <li>{t.help7}</li>
                    <li>{t.help8}</li>
                </ol>
                <div className={styles.footerControls}>
                    <label className={styles.themePickerLabel}>
                        {t.themeLabel}
                        <select
                            value={themeId}
                            onChange={(event) => {
                                const nextTheme = event.target.value
                                if (isThemeId(nextTheme)) {
                                    setThemeId(nextTheme)
                                }
                            }}
                            className={styles.themePicker}
                            aria-label={t.themeAria}
                        >
                            {themeOptions.map((theme) => (
                                <option key={theme.id} value={theme.id}>
                                    {theme.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className={styles.languagePickerLabel}>
                        {t.languageLabel}
                        <select
                            value={languageId}
                            onChange={(event) => {
                                const nextLanguage = event.target.value
                                if (isLanguageId(nextLanguage)) {
                                    setLanguageId(nextLanguage)
                                }
                            }}
                            className={styles.languagePicker}
                            aria-label={t.languageAria}
                        >
                            {languageOptions.map((language) => (
                                <option key={language.id} value={language.id}>
                                    {language.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </footer>
        </div>
    )
}

export default App
