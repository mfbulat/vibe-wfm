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
const DATE_TIMELINE_WIDTH = DATE_CELL_WIDTH - DATE_CELL_PADDING * 2
const MINI_HOUR_WIDTH = DATE_TIMELINE_WIDTH / 24
const MAX_MODAL_MINUTES = MINUTES_IN_DAY - SNAP_MINUTES
const DEFAULT_SHIFT_START = 9 * 60
const DATE_CHIP_GAP = 4
const VIEW_MODE_STORAGE_KEY = 'vibe-wfm:view-mode'

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

const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', {weekday: 'short'})
const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', {day: '2-digit', month: '2-digit'})
const fullDateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
})
const monthYearFormatter = new Intl.DateTimeFormat('ru-RU', {month: 'long', year: 'numeric'})

const today = new Date()
const todayKey = dateToKey(today)

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
    const [selectedDate, setSelectedDate] = useState<Date>(new Date())
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth <= MOBILE_BREAKPOINT : false,
    )
    const [mobileDateKey, setMobileDateKey] = useState(todayKey)
    const [shifts, setShifts] = useState<Shift[]>(initialShifts)
    const [draggingShiftId, setDraggingShiftId] = useState<string | null>(null)
    const [resizeState, setResizeState] = useState<ResizeState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [modalDraft, setModalDraft] = useState<ModalDraft | null>(null)
    const [isStorageReady, setIsStorageReady] = useState(false)
    const [virtualViewport, setVirtualViewport] = useState<VirtualViewport>({
        width: 0,
        height: 0,
        scrollTop: 0,
        scrollLeft: 0,
    })

    const resizingRef = useRef(false)
    const gridViewportRef = useRef<HTMLElement | null>(null)

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
        if (viewMode !== 'month' || isMobile) return

        const viewport = gridViewportRef.current
        if (!viewport) return

        const targetIndex = visibleDates.findIndex((date) => dateToKey(date) === selectedDateKey)
        if (targetIndex < 0) return

        const timelineViewportWidth = Math.max(viewport.clientWidth - employeeColumnWidth, columnWidth)
        const targetColumnLeft = targetIndex * columnWidth
        const targetColumnRight = targetColumnLeft + columnWidth
        const currentTimelineLeft = viewport.scrollLeft
        const currentTimelineRight = currentTimelineLeft + timelineViewportWidth

        if (targetColumnLeft >= currentTimelineLeft && targetColumnRight <= currentTimelineRight) return

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
    }, [columnWidth, employeeColumnWidth, isMobile, selectedDateKey, totalGridWidth, viewMode, visibleDates])

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
            title: 'Новая смена',
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
            setError('Укажите корректную дату')
            return
        }

        const start = parseTime(modalDraft.startTime)
        const end = parseTime(modalDraft.endTime)

        if (start === null || end === null) {
            setError('Введите корректное время в формате HH:MM')
            return
        }

        const snappedStart = snapToStep(start)
        const snappedEnd = snapToStep(end)

        if (snappedEnd <= snappedStart) {
            setError('Конец смены должен быть позже начала')
            return
        }

        if (snappedEnd - snappedStart < MIN_SHIFT_MINUTES) {
            setError(`Минимальная длительность смены — ${MIN_SHIFT_MINUTES} минут`)
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
                            title: modalDraft.title.trim() || 'Смена',
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
                    title: modalDraft.title.trim() || 'Смена',
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
        if (parsed) setSelectedDate(parsed)
    }

    const periodLabel =
        viewMode === 'day'
            ? `День: ${fullDateFormatter.format(selectedDate)}`
            : viewMode === 'week'
                ? `Неделя: ${shortDateFormatter.format(visibleDates[0])} - ${shortDateFormatter.format(visibleDates[6])}`
                : `Месяц: ${monthYearFormatter.format(selectedDate)}`

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
        <div className={styles.page}>
            <header className={styles.header}>
                <h1>WFM Scheduler</h1>
                <div className={styles.toolbar}>
                    <div className={styles.modeControls}>
                        <div className={styles.viewSwitch}>
                            {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setViewMode(mode)}
                                    className={`${styles.viewButton} ${viewMode === mode ? styles.activeView : ''}`}
                                >
                                    {mode === 'day' ? 'День' : mode === 'week' ? 'Неделя' : 'Месяц'}
                                </button>
                            ))}
                        </div>
                        <div className={styles.periodBadge}>{periodLabel}</div>
                    </div>

                    <div className={styles.dateControls}>
                        <label className={styles.datepickerLabel}>
                            Дата
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
                            Добавить смену
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
                                            Добавить
                                        </button>
                                    </div>

                                    {dayShifts.length === 0 ? (
                                        <p className={styles.mobileEmpty}>На выбранную дату смен нет</p>
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
                                Сотрудник
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
                                            className={`${styles.virtualDateHeaderCell} ${headerDateKey === todayKey ? styles.todayDateHeader : ''}`}
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
                                                            const chipLeft = (shift.start / 60) * MINI_HOUR_WIDTH
                                                            const chipWidth = Math.max(((shift.end - shift.start) / 60) * MINI_HOUR_WIDTH, 22)

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
                                                                        onPointerDown={(event) => startResize(event, shift, 'left', MINI_HOUR_WIDTH)}
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
                                                                        onPointerDown={(event) => startResize(event, shift, 'right', MINI_HOUR_WIDTH)}
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
                        <h2>{modalDraft.mode === 'edit' ? 'Редактировать смену' : 'Добавить смену'}</h2>

                        <form className={styles.modalForm} onSubmit={handleSaveShift}>
                            <label>
                                Название
                                <input
                                    value={modalDraft.title}
                                    onChange={(event) =>
                                        setModalDraft((prev) => (prev ? {...prev, title: event.target.value} : prev))
                                    }
                                />
                            </label>

                            <label>
                                Сотрудник
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
                                Дата
                                <input
                                    type="date"
                                    value={modalDraft.dateKey}
                                    onChange={(event) =>
                                        setModalDraft((prev) => (prev ? {...prev, dateKey: event.target.value} : prev))
                                    }
                                />
                            </label>

                            <label>
                                Начало
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
                                Конец
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
                                    Удалить
                                </button>
                                <button type="button" onClick={closeModal} className={styles.ghostButton}>
                                    Отмена
                                </button>
                                <button type="submit" className={styles.primaryButton}>
                                    {modalDraft.mode === 'edit' ? 'Сохранить' : 'Добавить'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <footer className={styles.helpSection}>
                <h3>Как пользоваться WFM</h3>
                <ol>
                    {isMobile && (
                        <li className={styles.mobileDesktopHint}>Для полного функционала удобнее пользоваться на
                            десктопе.</li>
                    )}
                    <li>Выберите режим: День, Неделя или Месяц.</li>
                    <li>Выберите дату в датапикере сверху.</li>
                    <li>На десктопе: двойной клик по ячейке добавляет смену, drag and drop переносит смену.</li>
                    <li>На десктопе: тяните левый/правый край смены для изменения начала и конца.</li>
                    <li>На мобильном: откройте смену тапом по карточке и измените время в модалке.</li>
                </ol>
            </footer>
        </div>
    )
}

export default App
