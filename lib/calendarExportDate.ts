import { DateTime } from 'luxon'

/** Export the selected date exactly; never silently reschedule an overdue commitment. */
export function calendarExportDate(date: string, hour: number, minute: number) {
  const parsed = DateTime.fromFormat(date.trim(), 'MM/dd/yyyy')
  if (!parsed.isValid || !Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { dateMmddyyyy: parsed.toFormat('MM/dd/yyyy'), hour, minute }
}

/** Floating wall-clock range: date arithmetic must carry across midnight and year boundaries. */
export function calendarTimedRange(date: string, hour: number, minute: number) {
  const valid = calendarExportDate(date, hour, minute)
  if (!valid) return null
  const start = DateTime.fromFormat(valid.dateMmddyyyy, 'MM/dd/yyyy', { zone: 'UTC' }).set({ hour, minute })
  return {
    kind: 'floating' as const,
    start: start.toFormat("yyyyMMdd'T'HHmmss"),
    end: start.plus({ minutes: 30 }).toFormat("yyyyMMdd'T'HHmmss"),
  }
}
