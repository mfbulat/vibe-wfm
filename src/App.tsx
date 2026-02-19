import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent, PointerEvent as ReactPointerEvent } from 'react'
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

const HOURS = Array.from({ length: 24 }, (_, i) => i)
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

const employees: Employee[] = [
  { id: 'e1', name: 'Анна' },
  { id: 'e2', name: 'Борис' },
  { id: 'e3', name: 'Светлана' },
  { id: 'e4', name: 'Дмитрий' },
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
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

const getMonthDates = (date: Date) => {
  const y = date.getFullYear()
  const m = date.getMonth()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, i) => new Date(y, m, i + 1))
}

const dateCellKey = (employeeId: string, dateKey: string) => `${employeeId}|${dateKey}`

const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' })
const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })
const fullDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
})

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
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [shifts, setShifts] = useState<Shift[]>(initialShifts)
  const [draggingShiftId, setDraggingShiftId] = useState<string | null>(null)
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modalDraft, setModalDraft] = useState<ModalDraft | null>(null)
  const resizingRef = useRef(false)

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
            return { ...shift, start: nextStart, end: resizeState.originEnd }
          }

          const nextEnd = clamp(
            resizeState.originEnd + deltaMinutes,
            resizeState.originStart + MIN_SHIFT_MINUTES,
            MINUTES_IN_DAY,
          )
          return { ...shift, start: resizeState.originStart, end: nextEnd }
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
      employeeId,
      dateKey,
      title: 'Новая смена',
      startTime: formatTime(snappedStart),
      endTime: formatTime(defaultEnd),
    })
  }

  const closeModal = () => {
    setModalDraft(null)
    setError(null)
  }

  const handleCreateShift = (event: FormEvent) => {
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
      prev.map((shift) => (shift.id === shiftId ? { ...shift, employeeId, dateKey } : shift)),
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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>WFM Scheduler</h1>
        <div className={styles.toolbar}>
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

          <label className={styles.datepickerLabel}>
            Дата
            <input
              type="date"
              value={selectedDateKey}
              onChange={(event) => onDatepickerChange(event.target.value)}
              className={styles.datepicker}
            />
          </label>
        </div>

        <p className={styles.hintText}>
          {viewMode === 'day'
            ? `День: ${fullDateFormatter.format(selectedDate)}. Dblclick по часу для добавления.`
            : viewMode === 'week'
              ? `Неделя от ${shortDateFormatter.format(visibleDates[0])} до ${shortDateFormatter.format(visibleDates[6])}.`
              : `Месяц: ${new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(selectedDate)}.`}
        </p>
      </header>

      {viewMode === 'day' ? (
        <section className={styles.gridWrapper}>
          <div className={styles.gridHeader}>
            <div className={styles.employeeHeader}>Сотрудник</div>
            <div className={styles.hoursHeader}>
              {HOURS.map((hour) => (
                <div key={hour} className={styles.hourCell}>
                  {String(hour).padStart(2, '0')}:00
                </div>
              ))}
            </div>
          </div>

          {employees.map((employee) => {
            const employeeShifts = getShiftsForCell(employee.id, selectedDateKey)

            return (
              <div key={employee.id} className={styles.gridRow}>
                <div className={styles.employeeName}>{employee.name}</div>

                <div
                  className={styles.timeline}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDropOnTimeline(event, employee.id, selectedDateKey)}
                >
                  <div className={styles.cellsLayer}>
                    {HOURS.map((hour) => {
                      const cellStart = hour * 60

                      return (
                        <div
                          key={`${employee.id}-${hour}`}
                          className={styles.timelineCell}
                          onDoubleClick={() => openCreateShiftModal(employee.id, selectedDateKey, cellStart)}
                        />
                      )
                    })}
                  </div>

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
                          style={{ left, width }}
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
          })}
        </section>
      ) : (
        <section className={styles.gridWrapper}>
          <div className={styles.gridHeader}>
            <div className={styles.employeeHeader}>Сотрудник</div>
            <div
              className={styles.dateHeader}
              style={{ gridTemplateColumns: `repeat(${visibleDates.length}, ${DATE_CELL_WIDTH}px)` }}
            >
              {visibleDates.map((date) => {
                const key = dateToKey(date)
                return (
                  <div key={key} className={styles.dateColumnTitle}>
                    <span>{weekdayFormatter.format(date)}</span>
                    <strong>{shortDateFormatter.format(date)}</strong>
                  </div>
                )
              })}
            </div>
          </div>

          {employees.map((employee) => (
            <div key={employee.id} className={styles.gridRow}>
              <div className={styles.employeeName}>{employee.name}</div>

              <div
                className={styles.dateCells}
                style={{ gridTemplateColumns: `repeat(${visibleDates.length}, ${DATE_CELL_WIDTH}px)` }}
              >
                {visibleDates.map((date) => {
                  const dateKey = dateToKey(date)
                  const cellShifts = getShiftsForCell(employee.id, dateKey)

                  return (
                    <div
                      key={`${employee.id}-${dateKey}`}
                      className={styles.dateCell}
                      onDoubleClick={() => openCreateShiftModal(employee.id, dateKey, DEFAULT_SHIFT_START)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDropOnDateCell(event, employee.id, dateKey)}
                    >
                      <div
                        className={styles.dateTimeline}
                        style={{ minHeight: Math.max(30, cellShifts.length * 30) }}
                      >
                        {cellShifts.map((shift, index) => {
                          const left = (shift.start / 60) * MINI_HOUR_WIDTH
                          const width = Math.max(((shift.end - shift.start) / 60) * MINI_HOUR_WIDTH, 22)

                          return (
                            <div
                              key={shift.id}
                              className={`${styles.shiftChip} ${draggingShiftId === shift.id ? styles.dragging : ''}`}
                              draggable={!resizeState}
                              onDragStart={(event) => handleDragStart(event, shift)}
                              onDragEnd={() => setDraggingShiftId(null)}
                              style={{ left, width, top: index * 30 }}
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
          ))}
        </section>
      )}

      {modalDraft && (
        <div className={styles.modalBackdrop} role="presentation" onClick={closeModal}>
          <div className={styles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2>Добавить смену</h2>

            <form className={styles.modalForm} onSubmit={handleCreateShift}>
              <label>
                Название
                <input
                  value={modalDraft.title}
                  onChange={(event) =>
                    setModalDraft((prev) => (prev ? { ...prev, title: event.target.value } : prev))
                  }
                />
              </label>

              <label>
                Дата
                <input
                  type="date"
                  value={modalDraft.dateKey}
                  onChange={(event) =>
                    setModalDraft((prev) => (prev ? { ...prev, dateKey: event.target.value } : prev))
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
                    setModalDraft((prev) => (prev ? { ...prev, startTime: event.target.value } : prev))
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
                    setModalDraft((prev) => (prev ? { ...prev, endTime: event.target.value } : prev))
                  }
                />
              </label>

              {error && <p className={styles.error}>{error}</p>}

              <div className={styles.modalActions}>
                <button type="button" onClick={closeModal} className={styles.ghostButton}>
                  Отмена
                </button>
                <button type="submit" className={styles.primaryButton}>
                  Добавить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
