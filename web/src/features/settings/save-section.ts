import { useQueryClient } from "@tanstack/react-query"
import type { FieldValues, Path, UseFormReturn } from "react-hook-form"
import { toast } from "sonner"

import { useI18n } from "@/i18n"
import { api, isApiError } from "@/lib/api"
import { toastError } from "@/lib/errors"
import { qk } from "@/lib/queries"
import type { SettingsInput } from "@/lib/types"

/**
 * Saves one settings section (sections are replaced whole). Server
 * validation errors like `server.port` land on the matching form field.
 */
export function useSaveSection() {
  const { t } = useI18n()
  const queryClient = useQueryClient()

  return async function save<V extends FieldValues>(
    patch: SettingsInput,
    form: UseFormReturn<V>,
    fieldPrefix: string,
    /** Server field name -> form field name, where they differ. */
    fieldMap: Record<string, string> = {}
  ) {
    try {
      const res = await api.settings.update(patch)
      queryClient.setQueryData(qk.settings, res)
      toast.success(res.restartRequired ? t("settings.savedRestart") : t("settings.saved"))
      return true
    } catch (error) {
      if (isApiError(error) && error.code === "validation" && error.field) {
        const field = error.field.startsWith(fieldPrefix + ".")
          ? error.field.slice(fieldPrefix.length + 1)
          : error.field
        const name = fieldMap[field] ?? field
        if (name in form.getValues()) {
          form.setError(name as Path<V>, { message: error.message })
          return false
        }
      }
      toastError(error, t)
      return false
    }
  }
}
