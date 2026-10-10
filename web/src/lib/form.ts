import type { FieldValues, Path, UseFormReturn } from "react-hook-form"

import type { Translate } from "@/i18n"
import { isApiError } from "@/lib/api"
import { toastError } from "@/lib/errors"

function hasPath(values: unknown, path: string) {
  let cur = values
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(part in cur)) return false
    cur = (cur as Record<string, unknown>)[part]
  }
  return true
}

/**
 * Puts a server validation error on the matching form field (`field` may be
 * renamed through `map`), or shows it as a toast.
 */
export function applyServerError<V extends FieldValues>(
  form: UseFormReturn<V>,
  error: unknown,
  t: Translate,
  map: Record<string, string> = {}
) {
  if (isApiError(error) && error.code === "validation" && error.field) {
    const name = map[error.field] ?? error.field
    if (hasPath(form.getValues(), name)) {
      form.setError(
        name as Path<V>,
        { message: error.message },
        { shouldFocus: true }
      )
      return
    }
  }
  toastError(error, t)
}

/** Reads a user-picked file as text (PEM uploads). */
export function readTextFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}
